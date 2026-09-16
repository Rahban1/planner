import { spawn } from 'node:child_process'
import type {
  CreatedReview,
  ReviewDetails,
  ReviewState,
  SourceControlAdapter,
} from './source-control.js'

export interface ParsedBitbucketRepository {
  projectKey: string
  repositorySlug: string
}

export interface ParsedBitbucketPullRequest extends ParsedBitbucketRepository {
  number: number
}

interface BitbucketAdapterOptions {
  baseUrl: string
  token: string
  fetchImpl?: typeof fetch
}

interface BitbucketPage<T> {
  values?: T[]
  isLastPage?: boolean
  nextPageStart?: number
}

interface BitbucketPullRequest {
  id?: number
  version?: number
  title?: string
  description?: string | null
  draft?: boolean
  state?: string
  open?: boolean
  closed?: boolean
  closedDate?: number
  fromRef?: {
    id?: string
    displayId?: string
    latestCommit?: string
    [key: string]: unknown
  }
  toRef?: {
    id?: string
    displayId?: string
    [key: string]: unknown
  }
  reviewers?: unknown[]
  links?: { self?: Array<{ href?: string }> }
}

export function parseBitbucketDataCenterRepoUrl(
  repoUrl: string,
): ParsedBitbucketRepository | null {
  try {
    const url = new URL(repoUrl)
    const https = url.pathname.match(/\/scm\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
    if (https) {
      return {
        projectKey: decodeURIComponent(https[1]),
        repositorySlug: decodeURIComponent(https[2]),
      }
    }
    const ssh = url.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
    if (url.protocol === 'ssh:' && ssh) {
      return {
        projectKey: decodeURIComponent(ssh[1]),
        repositorySlug: decodeURIComponent(ssh[2]),
      }
    }
  } catch {
    const scp = repoUrl.match(/^[^@\s]+@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/)
    if (scp) {
      return {
        projectKey: scp[1],
        repositorySlug: scp[2],
      }
    }
  }
  return null
}

export function parseBitbucketDataCenterPullRequestUrl(
  reviewUrl: string,
): ParsedBitbucketPullRequest | null {
  try {
    const url = new URL(reviewUrl)
    const match = url.pathname.match(
      /\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)/i,
    )
    if (!match) return null
    return {
      projectKey: decodeURIComponent(match[1]),
      repositorySlug: decodeURIComponent(match[2]),
      number: Number(match[3]),
    }
  } catch {
    return null
  }
}

export function createBitbucketDataCenterAdapter({
  baseUrl,
  token,
  fetchImpl = fetch,
}: BitbucketAdapterOptions): SourceControlAdapter {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  if (!normalizedBaseUrl) {
    throw new Error('BITBUCKET_BASE_URL is required for Bitbucket Data Center.')
  }
  if (!token) {
    throw new Error('SCM_TOKEN is required for Bitbucket Data Center.')
  }

  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    if (!response.ok) {
      const detail = (await response.text()).replaceAll(token, '<REDACTED>')
      throw new Error(
        `Bitbucket Data Center ${response.status}: ${detail.slice(0, 500)}`,
      )
    }
    return (await response.json()) as T
  }

  const reviewPath = (reviewUrl: string) => {
    const parsed = requirePullRequest(reviewUrl)
    return {
      parsed,
      path: `/rest/api/latest/projects/${encodeURIComponent(parsed.projectKey)}/repos/${encodeURIComponent(parsed.repositorySlug)}/pull-requests/${parsed.number}`,
    }
  }

  const getPullRequest = async (reviewUrl: string) => {
    const { path } = reviewPath(reviewUrl)
    return request<BitbucketPullRequest>(path)
  }

  return {
    provider: 'bitbucket_data_center',

    gitEnvironment() {
      return {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `http.${normalizedBaseUrl}/.extraheader`,
        GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
      }
    },

    async pushBranch(repoDir, branchName) {
      await runGit(
        repoDir,
        ['push', '--set-upstream', 'origin', `HEAD:refs/heads/${branchName}`],
        this.gitEnvironment(''),
        token,
      )
    },

    async getReviewState(reviewUrl): Promise<ReviewState> {
      const pullRequest = await getPullRequest(reviewUrl)
      const state = pullRequest.state?.toUpperCase() ?? 'OPEN'
      const merged = state === 'MERGED'
      const closed = merged || pullRequest.closed === true || state !== 'OPEN'
      return {
        state: closed ? 'closed' : 'open',
        merged,
        mergedAt: pullRequest.closedDate
          ? new Date(pullRequest.closedDate).toISOString()
          : null,
      }
    },

    async getReviewDetails(reviewUrl): Promise<ReviewDetails> {
      const pullRequest = await getPullRequest(reviewUrl)
      const parsed = requirePullRequest(reviewUrl)
      if (
        !pullRequest.id ||
        !pullRequest.fromRef?.latestCommit ||
        !pullRequest.fromRef.displayId ||
        !pullRequest.toRef?.displayId
      ) {
        throw new Error(
          `Bitbucket pull request response is missing head or base details for ${reviewUrl}`,
        )
      }
      return {
        number: pullRequest.id ?? parsed.number,
        url: pullRequestUrl(pullRequest) ?? reviewUrl,
        body: pullRequest.description ?? '',
        draft: pullRequest.draft === true,
        headSha: pullRequest.fromRef.latestCommit,
        headRef: pullRequest.fromRef.displayId,
        baseRef: pullRequest.toRef.displayId,
      }
    },

    async listReviewCommitShas(reviewUrl) {
      const { path } = reviewPath(reviewUrl)
      return pagedValues<{ id?: string }>(request, `${path}/commits`).then(
        (values) => [
          ...new Set(
            values.map((commit) => commit.id).filter(isNonEmptyString),
          ),
        ],
      )
    },

    async listReviewFilePaths(reviewUrl) {
      const { path } = reviewPath(reviewUrl)
      return pagedValues<{ path?: { toString?: string } }>(
        request,
        `${path}/changes`,
      ).then((values) => [
        ...new Set(
          values
            .map((change) => change.path?.toString)
            .filter(isNonEmptyString),
        ),
      ])
    },

    reviewFileUrl(reviewUrl, commitSha, path, raw = false) {
      const parsed = requirePullRequest(reviewUrl)
      const encodedPath = path.split('/').map(encodeURIComponent).join('/')
      const view = raw ? 'raw' : 'browse'
      return `${normalizedBaseUrl}/projects/${encodeURIComponent(parsed.projectKey)}/repos/${encodeURIComponent(parsed.repositorySlug)}/${view}/${encodedPath}?at=${encodeURIComponent(commitSha)}`
    },

    async updateReviewBody(reviewUrl, body) {
      const { path } = reviewPath(reviewUrl)
      const current = await getPullRequest(reviewUrl)
      if (
        current.version === undefined ||
        !current.title ||
        !current.fromRef ||
        !current.toRef
      ) {
        throw new Error(
          `Bitbucket pull request response cannot be updated for ${reviewUrl}`,
        )
      }
      await request(path, {
        method: 'PUT',
        body: JSON.stringify({
          version: current.version,
          title: current.title,
          description: body,
          fromRef: current.fromRef,
          toRef: current.toRef,
          reviewers: current.reviewers ?? [],
        }),
      })
    },

    async createReviewForBranch(repoUrl, input): Promise<CreatedReview> {
      const repo = requireRepository(repoUrl)
      const repoPath = `/rest/api/latest/projects/${encodeURIComponent(repo.projectKey)}/repos/${encodeURIComponent(repo.repositorySlug)}`
      const defaultBranch = await request<{ id?: string }>(
        `${repoPath}/default-branch`,
      )
      if (!defaultBranch.id) {
        throw new Error(
          `Bitbucket repository response has no default branch for ${repo.projectKey}/${repo.repositorySlug}`,
        )
      }
      const created = await request<BitbucketPullRequest>(
        `${repoPath}/pull-requests`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: input.title,
            description: input.body,
            fromRef: { id: `refs/heads/${input.head}` },
            toRef: { id: defaultBranch.id },
          }),
        },
      )
      if (!created.id) {
        throw new Error(
          `Bitbucket did not return the created pull request for ${repo.projectKey}/${repo.repositorySlug}`,
        )
      }
      return {
        number: created.id,
        url:
          pullRequestUrl(created) ??
          `${normalizedBaseUrl}/projects/${encodeURIComponent(repo.projectKey)}/repos/${encodeURIComponent(repo.repositorySlug)}/pull-requests/${created.id}`,
      }
    },
  }
}

async function pagedValues<T>(
  request: <TResult>(path: string, init?: RequestInit) => Promise<TResult>,
  path: string,
): Promise<T[]> {
  const values: T[] = []
  let start = 0
  while (true) {
    const separator = path.includes('?') ? '&' : '?'
    const page = await request<BitbucketPage<T>>(
      `${path}${separator}limit=1000&start=${start}`,
    )
    values.push(...(page.values ?? []))
    if (page.isLastPage !== false || page.nextPageStart === undefined) break
    start = page.nextPageStart
  }
  return values
}

function requireRepository(repoUrl: string): ParsedBitbucketRepository {
  const parsed = parseBitbucketDataCenterRepoUrl(repoUrl)
  if (!parsed) {
    throw new Error(
      `Unsupported Bitbucket Data Center repository URL: ${repoUrl}`,
    )
  }
  return parsed
}

function requirePullRequest(reviewUrl: string): ParsedBitbucketPullRequest {
  const parsed = parseBitbucketDataCenterPullRequestUrl(reviewUrl)
  if (!parsed) {
    throw new Error(
      `Invalid Bitbucket Data Center pull request URL: ${reviewUrl}`,
    )
  }
  return parsed
}

function pullRequestUrl(pullRequest: BitbucketPullRequest): string | null {
  return (
    pullRequest.links?.self?.map((link) => link.href).find(isNonEmptyString) ??
    null
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

async function runGit(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  token: string,
): Promise<void> {
  const result = await new Promise<{
    code: number | null
    stderr: string
    timedOut: boolean
  }>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, 60_000)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 8_000) stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      resolve({ code, stderr, timedOut })
    })
  })
  if (result.code !== 0) {
    const safeError = result.stderr.replaceAll(token, '<REDACTED>').trim()
    throw new Error(
      result.timedOut
        ? 'Bitbucket git push timed out after 60 seconds.'
        : `Bitbucket git push failed with exit ${result.code ?? 'unknown'}: ${safeError.slice(0, 500)}`,
    )
  }
}
