// Normalize Bitbucket responses for the existing review components.
export type BitbucketConfig = { baseUrl: string; token: string }
type Ref = {
  displayId: string
  latestCommit: string
  repository: { slug: string; project: { key: string } }
}
type PullRequest = {
  id: number
  title: string
  description?: string
  state: string
  draft?: boolean
  fromRef: Ref
  toRef: Ref
  links?: { self?: Array<{ href: string }> }
}
type Change = { path: { toString: string }; type: string }
export function bitbucketRepositoryUrl(
  base: string,
  project: string,
  repo: string,
) {
  return `${base.replace(/\/$/, '')}/scm/${encodeURIComponent(project)}/${encodeURIComponent(repo)}.git`
}
export function parseBitbucketIdentity(
  repoUrl: string,
  prUrl: string,
  baseUrl: string,
  number?: number | null,
) {
  const base = new URL(baseUrl)
  const repo = new URL(repoUrl)
  const pr = new URL(prUrl)
  const prefix = base.pathname.replace(/\/$/, '')
  const repository = repo.pathname
    .slice(prefix.length)
    .match(/^\/scm\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  const pull = pr.pathname
    .slice(prefix.length)
    .match(
      /^\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)(?:\/overview)?\/?$/,
    )
  if (
    base.protocol !== 'https:' ||
    repo.origin !== base.origin ||
    pr.origin !== base.origin ||
    repo.username ||
    repo.password ||
    pr.username ||
    pr.password ||
    !repo.pathname.startsWith(`${prefix}/`) ||
    !pr.pathname.startsWith(`${prefix}/`) ||
    !repository ||
    !pull ||
    repository[1].toLowerCase() !== pull[1].toLowerCase() ||
    repository[2].toLowerCase() !== pull[2].toLowerCase() ||
    (number && Number(pull[3]) !== number)
  ) {
    throw new Error(
      'Pull request does not match the configured Bitbucket repository',
    )
  }
  return {
    owner: decodeURIComponent(repository[1]),
    repository: decodeURIComponent(repository[2]),
    number: Number(pull[3]),
  }
}

export async function bitbucketReviewJson<T>(
  config: BitbucketConfig,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const base = config.baseUrl.replace(/\/$/, '')
  if (!config.token || new URL(base).protocol !== 'https:')
    throw new Error('Configure Bitbucket HTTPS and its token')
  async function request<TResult>(suffix: string): Promise<TResult> {
    const response = await fetchImpl(`${base}${suffix}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
    if (!response.ok)
      throw new Error(`Bitbucket request failed (${response.status})`)
    return response.json() as Promise<TResult>
  }
  async function pages<TResult>(suffix: string): Promise<TResult[]> {
    const values: TResult[] = []
    let start = 0
    for (let page = 0; page < 100; page++) {
      const data = await request<{
        values: TResult[]
        isLastPage: boolean
        nextPageStart?: number
      }>(`${suffix}${suffix.includes('?') ? '&' : '?'}limit=100&start=${start}`)
      values.push(...data.values)
      if (data.isLastPage) return values
      if (data.nextPageStart === undefined || data.nextPageStart <= start)
        throw new Error('Invalid Bitbucket page cursor')
      start = data.nextPageStart
    }
    throw new Error('Bitbucket result exceeds the page limit')
  }
  const parsed = new URL(path, 'https://review.invalid')
  const match = parsed.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/(.+)$/)
  if (!match) throw new Error('Invalid review API path')
  const [, project, repo, action] = match
  const root = `/rest/api/latest/projects/${project}/repos/${repo}`
  const pull = action.match(/^(?:pulls|issues)\/(\d+)(.*)$/)
  let result: unknown
  if (pull) {
    const [, number, tail] = pull
    const prRoot = `${root}/pull-requests/${number}`
    if (!tail) {
      const pr = await request<PullRequest>(prRoot)
      const name = (ref: Ref) =>
        `${ref.repository.project.key}/${ref.repository.slug}`
      result = {
        number: pr.id,
        html_url: pr.links?.self?.[0]?.href,
        title: pr.title,
        body: pr.description ?? '',
        state: pr.state === 'OPEN' ? 'open' : 'closed',
        merged: pr.state === 'MERGED',
        draft: pr.draft ?? false,
        head: {
          sha: pr.fromRef.latestCommit,
          ref: pr.fromRef.displayId,
          repo: { full_name: name(pr.fromRef) },
        },
        base: { ref: pr.toRef.displayId, repo: { full_name: name(pr.toRef) } },
        mergeable: null,
        additions: 0,
        deletions: 0,
        changed_files: 0,
      }
    } else if (tail === '/files') {
      const changes = await pages<Change>(`${prRoot}/changes`)
      // A complete diff can be very large. Fetch it once and respect Bitbucket's truncation flags.
      type Diff = {
        destination?: { toString: string }
        source?: { toString: string }
        truncated?: boolean
        hunks?: Array<{
          sourceLine: number
          sourceSpan: number
          destinationLine: number
          destinationSpan: number
          truncated?: boolean
          segments: Array<{
            type: string
            truncated?: boolean
            lines: Array<{ line: string; truncated?: boolean }>
          }>
        }>
      }
      const diff = await request<{ diffs: Diff[]; truncated?: boolean }>(
        `${prRoot}/diff?contextLines=3`,
      )
      result = changes.map((change) => {
        const file = diff.diffs.find(
          (d) =>
            (d.destination?.toString ?? d.source?.toString) ===
            change.path.toString,
        )
        let additions = 0
        let deletions = 0
        const truncated =
          diff.truncated ||
          file?.truncated ||
          file?.hunks?.some(
            (h) =>
              h.truncated ||
              h.segments.some(
                (s) => s.truncated || s.lines.some((l) => l.truncated),
              ),
          )
        const patch =
          file && !truncated && file.hunks?.length
            ? file.hunks
                .map((h) => {
                  const lines = h.segments.flatMap((segment) =>
                    segment.lines.map((line) => {
                      if (segment.type === 'ADDED') additions++
                      if (segment.type === 'REMOVED') deletions++
                      return `${segment.type === 'ADDED' ? '+' : segment.type === 'REMOVED' ? '-' : ' '}${line.line}`
                    }),
                  )
                  return [
                    `@@ -${h.sourceLine},${h.sourceSpan} +${h.destinationLine},${h.destinationSpan} @@`,
                    ...lines,
                  ].join('\n')
                })
                .join('\n')
            : undefined
        return {
          filename: change.path.toString,
          status:
            (
              { ADD: 'added', DELETE: 'removed', MOVE: 'renamed' } as Record<
                string,
                string
              >
            )[change.type] ?? 'modified',
          additions,
          deletions,
          patch,
        }
      })
    } else if (tail === '/comments') {
      // Bitbucket exposes all comments through activities. Avoid duplicate results.
      if (action.startsWith('issues/')) result = []
      else {
        type Comment = {
          id: number
          text: string
          author?: { displayName?: string }
          comments?: Comment[]
        }
        const activities = await pages<{
          comment?: Comment
          commentAnchor?: { path?: string; line?: number }
        }>(`${prRoot}/activities`)
        result = activities.flatMap((entry) => {
          const output: Array<{
            id: number
            user: { login: string }
            body: string
            path?: string
            line?: number
            html_url: string
          }> = []
          function add(comment: Comment) {
            output.push({
              id: comment.id,
              user: { login: comment.author?.displayName ?? 'Bitbucket user' },
              body: comment.text,
              path: entry.commentAnchor?.path,
              line: entry.commentAnchor?.line,
              html_url: `${base}/projects/${project}/repos/${repo}/pull-requests/${number}/overview?commentId=${comment.id}`,
            })
            for (const child of comment.comments ?? []) add(child)
          }
          if (entry.comment) add(entry.comment)
          return output
        })
      }
    } else throw new Error('Unsupported Bitbucket review operation')
  } else if (/^commits\/[^/]+\/check-runs$/.test(action)) {
    result = { check_runs: [], total_count: 0 }
  } else if (/^commits\/[^/]+\/status$/.test(action)) {
    const sha = action.split('/')[1]
    const statuses = await pages<{ name: string; state: string; url: string }>(
      `/rest/build-status/latest/commits/${sha}`,
    )
    result = {
      total_count: statuses.length,
      statuses: statuses.map((s) => ({
        context: s.name,
        state:
          (
            {
              SUCCESSFUL: 'success',
              FAILED: 'failure',
              INPROGRESS: 'pending',
              STOPPED: 'error',
            } as Record<string, string>
          )[s.state] ?? 'error',
        target_url: s.url,
      })),
    }
  } else if (action.startsWith('contents/')) {
    const ref = parsed.searchParams.get('ref')
    if (!ref || !/^[a-f0-9]{40,64}$/i.test(ref))
      throw new Error('Invalid file commit')
    const response = await fetchImpl(
      `${base}${root}/raw/${action.slice(9)}?at=${ref}`,
      {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      },
    )
    if (!response.ok) throw new Error('Bitbucket file request failed')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length > 100_000) return { size: bytes.length } as T
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    result = { content: btoa(binary), encoding: 'base64', size: bytes.length }
  } else throw new Error('Unsupported Bitbucket review operation')
  return result as T
}
