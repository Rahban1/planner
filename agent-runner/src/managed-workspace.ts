import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { repositoryWorkspaces } from './repository-workspaces.js'
import type { SourceControlAdapter } from './source-control.js'

const execFileAsync = promisify(execFile)
const LOCK_WAIT_MS = 30_000
const STALE_LOCK_MS = 10 * 60_000

export interface ManagedWorkspaceOptions {
  workspace: string
  repoUrls: string[]
  cacheRoot: string
  sourceControl: SourceControlAdapter
}

export function managedBranchName(taskTitle: string, runId: string): string {
  const task = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36)
  const run = runId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10)
  return `agent/${task || 'task'}-${run || Date.now()}`
}

export async function prepareManagedWorkspace({
  workspace,
  repoUrls,
  cacheRoot,
  sourceControl,
}: ManagedWorkspaceOptions): Promise<void> {
  await mkdir(cacheRoot, { recursive: true })
  for (const repository of repositoryWorkspaces(workspace, repoUrls)) {
    const key = createHash('sha256')
      .update(repository.repoUrl)
      .digest('hex')
      .slice(0, 24)
    const mirrorDir = join(cacheRoot, `${key}.git`)
    const lockDir = join(cacheRoot, `${key}.lock`)

    await withDirectoryLock(lockDir, async () => {
      await updateMirror(
        repository.repoUrl,
        mirrorDir,
        sourceControl.gitEnvironment(repository.repoUrl),
      )
    })

    await mkdir(dirname(repository.repoDir), { recursive: true })
    await git(['clone', mirrorDir, repository.repoDir])
    await git([
      '-C',
      repository.repoDir,
      'remote',
      'set-url',
      'origin',
      repository.repoUrl,
    ])
    await git([
      '-C',
      repository.repoDir,
      'config',
      'user.name',
      'Planner Agent',
    ])
    await git([
      '-C',
      repository.repoDir,
      'config',
      'user.email',
      'agent@planner.local',
    ])
  }
}

async function updateMirror(
  repoUrl: string,
  mirrorDir: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const defaultRef = await remoteDefaultRef(repoUrl, env)
  try {
    await stat(mirrorDir)
    await git(['-C', mirrorDir, 'remote', 'set-url', 'origin', repoUrl])
    await git(['-C', mirrorDir, 'remote', 'update', '--prune'], env)
  } catch (error) {
    if (await pathExists(mirrorDir)) throw error
    const temporaryMirror = `${mirrorDir}.tmp-${process.pid}`
    await rm(temporaryMirror, { recursive: true, force: true })
    try {
      await git(['clone', '--mirror', repoUrl, temporaryMirror], env)
      await rename(temporaryMirror, mirrorDir)
    } finally {
      await rm(temporaryMirror, { recursive: true, force: true })
    }
  }
  if (defaultRef) {
    await git(['-C', mirrorDir, 'symbolic-ref', 'HEAD', defaultRef])
  }
}

async function remoteDefaultRef(
  repoUrl: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-remote', '--symref', repoUrl, 'HEAD'],
    {
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: 1024 * 1024,
    },
  )
  const match = stdout.match(/^ref:\s+(refs\/heads\/[^\s]+)\s+HEAD$/m)
  return match?.[1] ?? null
}

async function withDirectoryLock<T>(
  lockDir: string,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  while (true) {
    try {
      await mkdir(lockDir)
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
      const lock = await stat(lockDir).catch(() => null)
      if (lock && Date.now() - lock.mtimeMs > STALE_LOCK_MS) {
        await rm(lockDir, { recursive: true, force: true })
        continue
      }
      if (Date.now() - startedAt > LOCK_WAIT_MS) {
        throw new Error(
          `Timed out while waiting for repository cache lock ${lockDir}`,
        )
      }
      await sleep(200)
    }
  }

  try {
    return await action()
  } finally {
    await rm(lockDir, { recursive: true, force: true })
  }
}

async function git(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await execFileAsync('git', args, {
    env: { ...env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 10 * 1024 * 1024,
  })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
