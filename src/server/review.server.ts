import { and, desc, eq } from 'drizzle-orm'
import { db, runtimeEnv, schema } from '#/db/index'
import { parseGitHubPullRequest, patchContainsLine } from '#/lib/workflow-state'
import { requireTaskAccess } from './access.server'
import { withRunRepositories } from './agent-queue.server'

export type ReviewSelection = {
  repoUrl?: string
  path?: string
  line?: number
  side?: 'LEFT' | 'RIGHT'
  headSha?: string
}
export type TaskReviewRepository = {
  repoUrl: string
  branchName: string | null
  prUrl: string
  prNumber: number
  title: string
  body: string
  state: string
  merged: boolean
  draft: boolean
  headSha: string
  mergeable: boolean | null
  additions: number
  deletions: number
  files: Array<{
    path: string
    status: string
    additions: number
    deletions: number
    patch: string | null
  }>
  checks: Array<{
    name: string
    status: string
    conclusion: string | null
    url: string | null
  }>
  comments: Array<{
    id: number
    author: string
    body: string
    path: string | null
    line: number | null
    url: string
  }>
  truncated: boolean
  error: string | null
}

type GitHubPr = {
  number: number
  title: string
  body: string | null
  state: string
  merged: boolean
  draft: boolean
  head: { sha: string; ref: string; repo: { full_name: string } | null }
  base: { ref: string; repo: { full_name: string } }
  mergeable: boolean | null
  additions: number
  deletions: number
  changed_files: number
}
type GitHubComment = {
  id: number
  user: { login: string } | null
  body: string
  path?: string
  line?: number
  html_url: string
}

async function github<T>(path: string): Promise<T> {
  const token = runtimeEnv.GITHUB_ACTIONS_DISPATCH_TOKEN
  if (!token)
    throw new Error(
      'GitHub review access is not configured. Open the pull request in GitHub.',
    )
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'planner',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok)
    throw new Error(
      response.status === 403 || response.status === 404
        ? 'GitHub access is not available for this pull request. Open it in GitHub.'
        : `GitHub review is not available (${response.status}). Try again.`,
    )
  return response.json() as Promise<T>
}

export async function reviewSource(taskId: string, requestedRunId?: string) {
  await requireTaskAccess(taskId)
  const runs = await db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.taskId, taskId)))
    .orderBy(desc(schema.agentRuns.createdAt))
  const withRepos = await withRunRepositories(runs)
  const source = withRepos.find(
    (run) =>
      (run.kind === 'implement' || run.kind === 'revise') &&
      (run.prUrl || run.repositories.some((repo) => repo.prUrl)),
  )
  if (!source) return null
  if (requestedRunId && source.id !== requestedRunId)
    throw new Error('The pull request changed. Reload the current review.')
  const repositories = source.repositories
    .filter((repo) => repo.prUrl && repo.prNumber && repo.branchName)
    .map((repo) => ({
      repoUrl: repo.repoUrl,
      branchName: repo.branchName,
      prUrl: repo.prUrl!,
      prNumber: repo.prNumber!,
      status: repo.status,
    }))
  if (
    !repositories.length &&
    source.repoUrl &&
    source.prUrl &&
    source.prNumber &&
    source.branchName
  )
    repositories.push({
      repoUrl: source.repoUrl,
      prUrl: source.prUrl,
      prNumber: source.prNumber,
      branchName: source.branchName,
      status: source.status === 'merged' ? 'merged' : 'success',
    })
  for (const repo of repositories)
    parseGitHubPullRequest(repo.repoUrl, repo.prUrl, repo.prNumber)
  return { source, repositories }
}

export async function readTaskReview(taskId: string) {
  const source = await reviewSource(taskId)
  if (!source)
    return { sourceRunId: null, repositories: [] as TaskReviewRepository[] }
  const repositories = await Promise.all(
    source.repositories.map(async (repo): Promise<TaskReviewRepository> => {
      const parsed = parseGitHubPullRequest(
        repo.repoUrl,
        repo.prUrl,
        repo.prNumber,
      )
      const base = `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}`
      const result: TaskReviewRepository = {
        ...repo,
        title: `Pull request #${repo.prNumber}`,
        body: '',
        state: 'unknown',
        merged: false,
        draft: false,
        headSha: '',
        mergeable: null,
        additions: 0,
        deletions: 0,
        files: [],
        checks: [],
        comments: [],
        truncated: false,
        error: null,
      }
      try {
        const pr = await github<GitHubPr>(`${base}/pulls/${parsed.number}`)
        if (
          pr.number !== repo.prNumber ||
          pr.head.ref !== repo.branchName ||
          pr.base.repo.full_name.toLowerCase() !==
            `${parsed.owner}/${parsed.repository}`.toLowerCase()
        )
          throw new Error('The saved pull request no longer matches this task.')
        Object.assign(result, {
          title: pr.title,
          body: (pr.body ?? '').slice(0, 30_000),
          state: pr.state,
          merged: pr.merged,
          draft: pr.draft,
          headSha: pr.head.sha,
          mergeable: pr.mergeable,
          additions: pr.additions,
          deletions: pr.deletions,
        })
        const [files, checks, statuses, issueComments, reviewComments] =
          await Promise.allSettled([
            github<
              Array<{
                filename: string
                status: string
                additions: number
                deletions: number
                patch?: string
              }>
            >(`${base}/pulls/${parsed.number}/files?per_page=100`),
            github<{
              check_runs: Array<{
                name: string
                status: string
                conclusion: string | null
                html_url: string | null
              }>
              total_count: number
            }>(
              `${base}/commits/${encodeURIComponent(pr.head.sha)}/check-runs?per_page=100`,
            ),
            github<{
              statuses: Array<{
                context: string
                state: string
                target_url: string | null
              }>
              total_count: number
            }>(
              `${base}/commits/${encodeURIComponent(pr.head.sha)}/status?per_page=100`,
            ),
            github<GitHubComment[]>(
              `${base}/issues/${parsed.number}/comments?per_page=100&sort=created&direction=desc`,
            ),
            github<GitHubComment[]>(
              `${base}/pulls/${parsed.number}/comments?per_page=100&sort=created&direction=desc`,
            ),
          ])
        if (files.status === 'fulfilled') {
          result.files = files.value.map((file) => ({
            path: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            patch: file.patch?.slice(0, 60_000) ?? null,
          }))
          result.truncated =
            pr.changed_files > result.files.length ||
            files.value.some((file) => (file.patch?.length ?? 0) > 60_000)
        }
        if (checks.status === 'fulfilled')
          result.checks.push(
            ...checks.value.check_runs.map((check) => ({
              name: check.name,
              status: check.status,
              conclusion: check.conclusion,
              url: check.html_url,
            })),
          )
        if (statuses.status === 'fulfilled')
          result.checks.push(
            ...statuses.value.statuses.map((status) => ({
              name: status.context,
              status: status.state === 'pending' ? 'in_progress' : 'completed',
              conclusion: status.state,
              url: status.target_url,
            })),
          )
        for (const comments of [issueComments, reviewComments])
          if (comments.status === 'fulfilled')
            result.comments.push(
              ...comments.value.map((comment) => ({
                id: comment.id,
                author: comment.user?.login ?? 'GitHub user',
                body: comment.body.slice(0, 20_000),
                path: comment.path ?? null,
                line: comment.line ?? null,
                url: comment.html_url,
              })),
            )
        result.truncated ||=
          (checks.status === 'fulfilled' && checks.value.total_count > 100) ||
          (statuses.status === 'fulfilled' &&
            statuses.value.total_count > 100) ||
          (issueComments.status === 'fulfilled' &&
            issueComments.value.length === 100) ||
          (reviewComments.status === 'fulfilled' &&
            reviewComments.value.length === 100)
        if (
          [files, checks, statuses, issueComments, reviewComments].some(
            (item) => item.status === 'rejected',
          )
        )
          result.error =
            'Some review data could not load. Open GitHub for the full review.'
      } catch (error) {
        result.error =
          error instanceof Error
            ? error.message
            : 'Could not load this pull request.'
      }
      return result
    }),
  )
  return { sourceRunId: source.source.id, repositories }
}

export async function validateReviewAction(
  taskId: string,
  sourceRunId: string | undefined,
  mode: 'question' | 'change',
  context?: ReviewSelection,
) {
  const source = await reviewSource(taskId, sourceRunId)
  if (!source) throw new Error('This task has no pull request')
  if (
    context?.repoUrl &&
    !source.repositories.some((repo) => repo.repoUrl === context.repoUrl)
  )
    throw new Error('Select a repository from this task')
  if (
    context?.path &&
    (!context.repoUrl ||
      context.path.startsWith('/') ||
      context.path.split('/').includes('..'))
  )
    throw new Error('Select a file from this pull request')
  const repositories = await Promise.all(
    source.repositories.map(async (repo) => {
      const parsed = parseGitHubPullRequest(
        repo.repoUrl,
        repo.prUrl,
        repo.prNumber,
      )
      const pr = await github<GitHubPr>(
        `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/pulls/${parsed.number}`,
      )
      if (pr.head.ref !== repo.branchName)
        throw new Error('The pull request branch changed. Reload the review.')
      if (
        mode === 'change' &&
        !pr.merged &&
        pr.state === 'open' &&
        (pr.head.repo?.full_name.toLowerCase() !==
          `${parsed.owner}/${parsed.repository}`.toLowerCase() ||
          pr.head.ref === pr.base.ref)
      )
        throw new Error('The change request cannot write to this branch')
      if (
        context?.repoUrl === repo.repoUrl &&
        context.headSha &&
        context.headSha !== pr.head.sha
      )
        throw new Error(
          'The code changed. Reload the review before sending this request.',
        )
      if (
        mode === 'change' &&
        context?.repoUrl === repo.repoUrl &&
        (pr.merged || pr.state !== 'open')
      )
        throw new Error(
          'The selected pull request is closed. Select an open pull request.',
        )
      if (context?.repoUrl === repo.repoUrl && context.path) {
        const files = await github<Array<{ filename: string; patch?: string }>>(
          `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}/pulls/${parsed.number}/files?per_page=100`,
        )
        const file = files.find((entry) => entry.filename === context.path)
        if (!file)
          throw new Error('This file is not in the current pull request review')
        if (
          context.line !== undefined &&
          (!context.side ||
            !file.patch ||
            !patchContainsLine(file.patch, context.line, context.side))
        )
          throw new Error(
            'This line is not in the current diff. Reload the review.',
          )
      }
      return {
        ...repo,
        headSha: pr.head.sha,
        open: !pr.merged && pr.state === 'open',
      }
    }),
  )
  if (mode === 'change' && !repositories.some((repo) => repo.open))
    throw new Error('No open pull request is available for changes')
  return { sourceRunId: source.source.id, repositories, context }
}
