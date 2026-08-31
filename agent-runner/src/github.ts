// Minimal GitHub REST client for checking pull request merge state.

export interface PullRequestState {
  state: string // 'open' | 'closed'
  merged: boolean
  mergedAt: string | null
}

export interface ParsedPrUrl {
  owner: string
  repo: string
  number: number
}

export interface ParsedRepoUrl {
  owner: string
  repo: string
}

export interface PullRequestDetails extends ParsedPrUrl {
  url: string
  body: string
  draft: boolean
  headSha: string
  headRef: string
  baseRef: string
}

export interface CreatePullRequestInput {
  head: string
  title: string
  body: string
  draft?: boolean
}

export interface CreatedPullRequest {
  number: number
  url: string
}

type FetchImpl = typeof fetch

export function parsePrUrl(prUrl: string): ParsedPrUrl | null {
  const match = prUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

export function parseRepoUrl(repoUrl: string): ParsedRepoUrl | null {
  const https = repoUrl.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#]+?)(?:\.git)?\/?$/i)
  if (https) return { owner: https[1], repo: https[2] }

  const ssh = repoUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i)
  if (ssh) return { owner: ssh[1], repo: ssh[2] }
  return null
}

export async function getPullRequestState(
  prUrl: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<PullRequestState | null> {
  const parsed = parsePrUrl(prUrl)
  if (!parsed) return null

  const res = await fetchImpl(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'planner-agent-runner',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API ${res.status} for PR ${parsed.owner}/${parsed.repo}#${parsed.number}: ${text.slice(0, 200)}`)
  }

  const body = (await res.json()) as {
    state?: string
    merged?: boolean
    merged_at?: string | null
  }
  return {
    state: body.state ?? 'open',
    merged: body.merged === true,
    mergedAt: body.merged_at ?? null,
  }
}


export async function getPullRequestDetails(
  prUrl: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<PullRequestDetails> {
  const parsed = requirePrUrl(prUrl)
  const body = await githubJson<{
    number?: number
    html_url?: string
    body?: string | null
    draft?: boolean
    head?: { sha?: string; ref?: string }
    base?: { ref?: string }
  }>(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
    token,
    undefined,
    fetchImpl,
  )

  if (!body.head?.sha || !body.head.ref || !body.base?.ref) {
    throw new Error(`GitHub PR response is missing head or base details for ${prUrl}`)
  }

  return {
    ...parsed,
    number: body.number ?? parsed.number,
    url: body.html_url ?? prUrl,
    body: body.body ?? '',
    draft: body.draft === true,
    headSha: body.head.sha,
    headRef: body.head.ref,
    baseRef: body.base.ref,
  }
}

export async function listPullRequestCommitShas(
  prUrl: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string[]> {
  const parsed = requirePrUrl(prUrl)
  const shas: string[] = []
  let page = 1

  while (true) {
    const pageQuery = page === 1 ? '' : `&page=${page}`
    const commits = await githubJson<Array<{ sha?: string }>>(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}/commits?per_page=100${pageQuery}`,
      token,
      undefined,
      fetchImpl,
    )
    shas.push(...commits.map((commit) => commit.sha).filter((sha): sha is string => !!sha))
    if (commits.length < 100) break
    page += 1
  }

  return [...new Set(shas)]
}

export async function listPullRequestFilePaths(
  prUrl: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string[]> {
  const parsed = requirePrUrl(prUrl)
  const paths: string[] = []
  let page = 1

  while (true) {
    const pageQuery = page === 1 ? '' : `&page=${page}`
    const files = await githubJson<Array<{ filename?: string }>>(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}/files?per_page=100${pageQuery}`,
      token,
      undefined,
      fetchImpl,
    )
    paths.push(...files.map((file) => file.filename).filter((path): path is string => !!path))
    if (files.length < 100) break
    page += 1
  }

  return [...new Set(paths)]
}

export async function updatePullRequestBody(
  prUrl: string,
  token: string,
  body: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const parsed = requirePrUrl(prUrl)
  await githubJson(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
    token,
    { method: 'PATCH', body: JSON.stringify({ body }) },
    fetchImpl,
  )
}

export async function createPullRequestForBranch(
  repoUrl: string,
  token: string,
  input: CreatePullRequestInput,
  fetchImpl: FetchImpl = fetch,
): Promise<CreatedPullRequest> {
  const repo = parseRepoUrl(repoUrl)
  if (!repo) throw new Error(`Unsupported GitHub repository URL: ${repoUrl}`)

  const metadata = await githubJson<{ default_branch?: string }>(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}`,
    token,
    undefined,
    fetchImpl,
  )
  if (!metadata.default_branch) {
    throw new Error(`GitHub repository response has no default branch for ${repo.owner}/${repo.repo}`)
  }

  const created = await githubJson<{ number?: number; html_url?: string }>(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: metadata.default_branch,
        draft: input.draft ?? false,
      }),
    },
    fetchImpl,
  )
  if (!created.number || !created.html_url) {
    throw new Error(`GitHub did not return the created pull request for ${repo.owner}/${repo.repo}`)
  }
  return { number: created.number, url: created.html_url }
}

function requirePrUrl(prUrl: string): ParsedPrUrl {
  const parsed = parsePrUrl(prUrl)
  if (!parsed) throw new Error(`Invalid GitHub pull request URL: ${prUrl}`)
  return parsed
}

async function githubJson<T>(
  url: string,
  token: string,
  init: RequestInit | undefined,
  fetchImpl: FetchImpl,
): Promise<T> {
  const res = await fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'planner-agent-runner',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 500)}`)
  }
  return (await res.json()) as T
}
