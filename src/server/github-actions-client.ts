export interface GitHubActionsDispatchConfig {
  owner: string
  repository: string
  workflow: string
  ref: string
  token: string
}

export interface GitHubActionsDispatchResult {
  jobId: string | null
  jobUrl: string
}

export function shouldFailIncompleteWorkflow(
  status: string,
  claimedJobId: string | null,
  reportingJobId: string,
): boolean {
  const active = status === 'queued' || status === 'running'
  const ownsRun = claimedJobId === null || claimedJobId === reportingJobId
  return active && ownsRun
}

export function shouldIgnoreWorkflowCompletion(
  claimedJobId: string | null,
  reportingJobId: string,
): boolean {
  return claimedJobId !== null && claimedJobId !== reportingJobId
}

interface DispatchResponse {
  workflow_run_id?: number | string
  html_url?: string
  run_url?: string
}

interface DispatchOptions {
  fetchImpl?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
  maxAttempts?: number
}

const API_VERSION = '2026-03-10'

class PermanentDispatchError extends Error {}

export async function dispatchGitHubActionsRun(
  config: GitHubActionsDispatchConfig,
  runId: string,
  options: DispatchOptions = {},
): Promise<GitHubActionsDispatchResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const maxAttempts = options.maxAttempts ?? 3
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`
  const workflowUrl = `https://github.com/${config.owner}/${config.repository}/actions/workflows/${config.workflow}`

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'planner-worker',
          'X-GitHub-Api-Version': API_VERSION,
        },
        body: JSON.stringify({ ref: config.ref, inputs: { run_id: runId } }),
      })

      if (response.ok) {
        if (response.status === 204) {
          return { jobId: null, jobUrl: workflowUrl }
        }
        const body = (await response.json()) as DispatchResponse
        return {
          jobId: body.workflow_run_id ? String(body.workflow_run_id) : null,
          jobUrl: body.html_url ?? body.run_url ?? workflowUrl,
        }
      }

      const detail = (await response.text()).slice(0, 500)
      const message =
        `GitHub workflow dispatch failed with ${response.status}${detail ? `: ${detail}` : ''}`
      const error = new Error(message)
      if (response.status !== 429 && response.status < 500) {
        throw new PermanentDispatchError(message)
      }
      lastError = error
    } catch (error) {
      if (error instanceof PermanentDispatchError) throw error
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === maxAttempts) break
    }

    if (attempt < maxAttempts) await sleep(250 * 2 ** (attempt - 1))
  }

  throw lastError ?? new Error('GitHub workflow dispatch failed')
}
