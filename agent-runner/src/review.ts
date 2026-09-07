import { execFile } from 'node:child_process'
import { mkdir, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  getPullRequestDetails,
  githubJson,
  parsePrUrl,
  parseRepoUrl,
} from './github.js'
import type { PullRequestDetails } from './github.js'
import { repositoryWorkspaces } from './repository-workspaces.js'
import type { RepositoryRunStatus } from './repository-status.js'

export interface ReviewRepository {
  repoUrl: string
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  headSha?: string | null
  position?: number
  status?: RepositoryRunStatus
}

export interface ReviewContext {
  sourceRunId: string
  instruction: string
  repositories: ReviewRepository[]
  context?: {
    repoUrl?: string
    path?: string
    line?: number
    side?: 'LEFT' | 'RIGHT'
    headSha?: string
  }
}

export interface PreparedReviewRepository extends ReviewRepository {
  position: number
  repoDir: string
  expectedHeadSha: string | null
  status: RepositoryRunStatus
  writable: boolean
}

type Git = (repoDir: string, args: string[], token?: string) => Promise<string>
type ReadPr = typeof getPullRequestDetails

const execFileAsync = promisify(execFile)

export const reviewGit: Git = async (repoDir, args, token = '') => {
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64')
  try {
    const result = await execFileAsync(
      'git',
      ['-c', 'core.hooksPath=/dev/null', ...args],
      {
        cwd: repoDir,
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
          GIT_CONFIG_VALUE_0: token ? `AUTHORIZATION: basic ${auth}` : '',
        },
      },
    )
    return result.stdout.trim()
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Review Git operation failed: ${raw
        .replaceAll(auth, '<REDACTED>')
        .replaceAll(token || '\0', '<REDACTED>')
        .slice(0, 600)}`,
    )
  }
}

function requireRepositoryIdentity(
  repository: ReviewRepository,
  details: PullRequestDetails,
) {
  const repo = parseRepoUrl(repository.repoUrl)
  const pr = repository.prUrl ? parsePrUrl(repository.prUrl) : null
  if (
    !repo ||
    !pr ||
    `${repo.owner}/${repo.repo}`.toLowerCase() !==
      `${pr.owner}/${pr.repo}`.toLowerCase()
  ) {
    throw new Error('The pull request does not belong to its saved repository.')
  }
  if (
    details.number !== pr.number ||
    (repository.prNumber != null && repository.prNumber !== pr.number)
  ) {
    throw new Error('The pull request number changed. Open the review again.')
  }
  if (details.headRef !== repository.branchName) {
    throw new Error('The pull request branch changed. Open the review again.')
  }
  return `${repo.owner}/${repo.repo}`
}

export function assertRevisionTarget(
  repository: ReviewRepository,
  details: PullRequestDetails,
  expectedHeadSha?: string | null,
) {
  const fullName = requireRepositoryIdentity(repository, details).toLowerCase()
  if (details.state !== 'open' || details.merged)
    throw new Error('This pull request is no longer open.')
  if (
    details.headRepo?.toLowerCase() !== fullName ||
    details.baseRepo?.toLowerCase() !== fullName
  ) {
    throw new Error(
      'Revision requires a pull request branch in the saved repository. Fork branches are not supported.',
    )
  }
  if (details.headRef === details.baseRef)
    throw new Error('Revision cannot push to the pull request base branch.')
  if (!/^[a-f0-9]{40,64}$/i.test(details.headSha))
    throw new Error('The pull request has an invalid head commit.')
  if (expectedHeadSha && details.headSha !== expectedHeadSha) {
    throw new Error(
      'The pull request changed after review. Refresh the changes and submit the request again.',
    )
  }
}

export async function prepareRevisionRepositories(
  review: ReviewContext,
  workspace: string,
  token: string,
  deps: { readPr?: ReadPr; git?: Git } = {},
): Promise<PreparedReviewRepository[]> {
  if (!token)
    throw new Error('GITHUB_TOKEN is required to revise pull requests.')
  if (!review.instruction.trim())
    throw new Error('A change request is required.')
  const readPr = deps.readPr ?? getPullRequestDetails
  const git = deps.git ?? reviewGit
  const workspaces = repositoryWorkspaces(
    workspace,
    review.repositories.map((r) => r.repoUrl),
  )
  const results: PreparedReviewRepository[] = []
  for (const [index, repository] of review.repositories.entries()) {
    const result: PreparedReviewRepository = {
      ...repository,
      ...workspaces[index],
      position: repository.position ?? index,
      expectedHeadSha: null,
      status: repository.status ?? 'skipped',
      writable: false,
    }
    if (!repository.prUrl || !repository.branchName) {
      results.push(result)
      continue
    }
    const details = await readPr(repository.prUrl, token)
    requireRepositoryIdentity(repository, details)
    if (details.merged || details.state === 'closed') {
      result.status = details.merged ? 'merged' : 'closed'
      results.push(result)
      continue
    }
    const expected =
      repository.headSha ??
      (review.context?.repoUrl === repository.repoUrl
        ? review.context.headSha
        : undefined)
    assertRevisionTarget(repository, details, expected)
    const canonicalUrl = `https://github.com/${details.owner}/${details.repo}.git`
    await mkdir(dirname(result.repoDir), { recursive: true })
    await git(
      workspace,
      ['clone', '--no-checkout', '--', canonicalUrl, result.repoDir],
      token,
    )
    await git(result.repoDir, ['check-ref-format', '--branch', details.headRef])
    await git(result.repoDir, [
      'checkout',
      '-b',
      details.headRef,
      `refs/remotes/origin/${details.headRef}`,
    ])
    const clonedSha = await git(result.repoDir, ['rev-parse', 'HEAD'])
    if (clonedSha !== details.headSha)
      throw new Error(
        'The pull request changed while its branch was loaded. Refresh the review.',
      )
    await git(result.repoDir, ['config', 'user.name', 'Planner Agent'])
    await git(result.repoDir, ['config', 'user.email', 'agent@planner.local'])
    // The runner owns the final push and supplies a verified explicit URL.
    await git(result.repoDir, [
      'remote',
      'set-url',
      '--push',
      'origin',
      'disabled://planner-review',
    ])
    results.push({
      ...result,
      expectedHeadSha: details.headSha,
      status: 'success',
      writable: true,
    })
  }
  if (!results.some((r) => r.writable))
    throw new Error(
      'No open pull request is available for this change request.',
    )
  return results
}

export async function pushRevisionRepository(
  repository: PreparedReviewRepository,
  token: string,
  deps: { readPr?: ReadPr; git?: Git; verifyPath?: boolean } = {},
): Promise<{ changed: boolean; headSha: string }> {
  if (
    !repository.writable ||
    !repository.prUrl ||
    !repository.branchName ||
    !repository.expectedHeadSha
  ) {
    throw new Error('This repository is not an open revision target.')
  }
  const git = deps.git ?? reviewGit
  const readPr = deps.readPr ?? getPullRequestDetails
  if (deps.verifyPath !== false) {
    if (
      (await realpath(repository.repoDir)) !== repository.repoDir ||
      (await realpath(join(repository.repoDir, '.git'))) !==
        join(repository.repoDir, '.git')
    ) {
      throw new Error(
        'The revision workspace contains an unexpected repository link.',
      )
    }
  }
  const branch = await git(repository.repoDir, ['branch', '--show-current'])
  if (branch !== repository.branchName)
    throw new Error('The agent changed branches. The revision was not pushed.')
  if (await git(repository.repoDir, ['status', '--porcelain']))
    throw new Error(
      'The agent left changes without a commit. The revision was not pushed.',
    )
  const headSha = await git(repository.repoDir, ['rev-parse', 'HEAD'])
  if (!/^[a-f0-9]{40,64}$/i.test(headSha))
    throw new Error('The revision has an invalid commit.')
  // Both the ancestry check and lease are required. A lease alone can discard commits.
  await git(repository.repoDir, [
    'merge-base',
    '--is-ancestor',
    repository.expectedHeadSha,
    headSha,
  ])
  const current = await readPr(repository.prUrl, token)
  assertRevisionTarget(repository, current, repository.expectedHeadSha)
  if (headSha === repository.expectedHeadSha) return { changed: false, headSha }
  const url = `https://github.com/${current.owner}/${current.repo}.git`
  await git(
    repository.repoDir,
    [
      'push',
      `--force-with-lease=refs/heads/${repository.branchName}:${repository.expectedHeadSha}`,
      url,
      `${headSha}:refs/heads/${repository.branchName}`,
    ],
    token,
  )
  const pushed = await readPr(repository.prUrl, token)
  assertRevisionTarget(repository, pushed, headSha)
  return { changed: true, headSha }
}

export async function loadReviewSnapshot(
  review: ReviewContext,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!token)
    throw new Error('GITHUB_TOKEN is required to read pull request changes.')
  const snapshots: string[] = []
  let remaining = 100_000
  for (const repository of review.repositories) {
    if (!repository.prUrl || !repository.branchName) continue
    const details = await getPullRequestDetails(
      repository.prUrl,
      token,
      fetchImpl,
    )
    requireRepositoryIdentity(repository, details)
    if (remaining <= 0) {
      snapshots.push(
        'Remaining repositories were omitted because the context limit was reached.',
      )
      break
    }
    const files = await githubJson<
      Array<{ filename: string; patch?: string; status: string }>
    >(
      `https://api.github.com/repos/${details.owner}/${details.repo}/pulls/${details.number}/files?per_page=100`,
      token,
      undefined,
      fetchImpl,
    )
    const focus =
      review.context?.repoUrl === repository.repoUrl
        ? review.context.path
        : undefined
    const sorted = [...files].sort(
      (a, b) => Number(b.filename === focus) - Number(a.filename === focus),
    )
    const parts = [
      `PR: ${repository.prUrl}\nBranch: ${details.headRef}\nHead commit: ${details.headSha}\nState: ${details.merged ? 'merged' : details.state}\nDescription:\n${details.body.slice(0, 6_000)}`,
    ]
    let readFiles = 0
    for (const file of sorted) {
      parts.push(
        `File: ${file.filename} (${file.status})\nDiff:\n${file.patch ?? '[Patch unavailable: binary, large, or omitted by GitHub]'}`,
      )
      if (file.status !== 'removed' && readFiles < 6) {
        readFiles += 1
        const path = file.filename.split('/').map(encodeURIComponent).join('/')
        try {
          const content = await githubJson<{
            content?: string
            encoding?: string
            size?: number
          }>(
            `https://api.github.com/repos/${details.owner}/${details.repo}/contents/${path}?ref=${details.headSha}`,
            token,
            undefined,
            fetchImpl,
          )
          if (
            content.encoding === 'base64' &&
            content.content &&
            (content.size ?? 0) <= 100_000
          ) {
            const decoded = Buffer.from(content.content, 'base64').toString(
              'utf8',
            )
            if (!decoded.includes('\0'))
              parts.push(
                `Current file at ${details.headSha}:\n${decoded.slice(0, 16_000)}${decoded.length > 16_000 ? '\n[File truncated]' : ''}`,
              )
          }
        } catch {
          parts.push(
            '[Current file could not be read; use only the supplied diff.]',
          )
        }
      }
    }
    if (files.length === 100)
      parts.push('[Only the first 100 changed files are included.]')
    const text = parts.join('\n\n')
    snapshots.push(
      text.slice(0, remaining) +
        (text.length > remaining ? '\n[Repository context truncated.]' : ''),
    )
    remaining -= text.length
  }
  if (snapshots.length === 0)
    throw new Error(
      'No pull request is available to answer this review question.',
    )
  return snapshots.join('\n\n---\n\n')
}
