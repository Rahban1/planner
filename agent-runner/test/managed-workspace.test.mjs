import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  managedBranchName,
  prepareManagedWorkspace,
} from '../dist/managed-workspace.js'

const exec = promisify(execFile)

test('creates stable safe branch names', () => {
  assert.equal(
    managedBranchName('Fix modal scrollbars!', '907c5523-ad81-42fd'),
    'agent/fix-modal-scrollbars-907c5523ad',
  )
})

test('reuses a mirror and creates isolated repository workspaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planner-managed-workspace-'))
  const source = join(root, 'source')
  const remote = join(root, 'remote.git')
  const cacheRoot = join(root, 'cache')
  await mkdir(source)
  await exec('git', ['init', '-b', 'main'], { cwd: source })
  await exec('git', ['config', 'user.name', 'Test'], { cwd: source })
  await exec('git', ['config', 'user.email', 'test@example.com'], {
    cwd: source,
  })
  await writeFile(join(source, 'README.md'), 'one\n')
  await exec('git', ['add', '.'], { cwd: source })
  await exec('git', ['commit', '-m', 'initial'], { cwd: source })
  await exec('git', ['clone', '--bare', source, remote])

  const sourceControl = {
    provider: 'test',
    gitEnvironment: () => process.env,
  }
  const firstWorkspace = join(root, 'run-1')
  await prepareManagedWorkspace({
    workspace: firstWorkspace,
    repoUrls: [remote],
    cacheRoot,
    sourceControl,
  })
  assert.equal(
    await readFile(join(firstWorkspace, 'repo', 'README.md'), 'utf8'),
    'one\n',
  )

  await writeFile(join(source, 'README.md'), 'two\n')
  await exec('git', ['add', '.'], { cwd: source })
  await exec('git', ['commit', '-m', 'second'], { cwd: source })
  await exec('git', ['push', remote, 'main'], { cwd: source })

  const secondWorkspace = join(root, 'run-2')
  await prepareManagedWorkspace({
    workspace: secondWorkspace,
    repoUrls: [remote],
    cacheRoot,
    sourceControl,
  })
  assert.equal(
    await readFile(join(secondWorkspace, 'repo', 'README.md'), 'utf8'),
    'two\n',
  )
  assert.equal(
    await readFile(join(firstWorkspace, 'repo', 'README.md'), 'utf8'),
    'one\n',
  )
})
