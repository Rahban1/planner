import { describe, expect, it, vi } from 'vitest'
import {
  dispatchGitHubActionsRun,
  shouldFailIncompleteWorkflow,
  shouldIgnoreWorkflowCompletion,
} from './github-actions-client'

const config = {
  owner: 'Rahban1',
  repository: 'planner',
  workflow: 'planner-agent-run.yml',
  ref: 'master',
  token: 'test-token',
}

describe('dispatchGitHubActionsRun', () => {
  it('returns the exact workflow run from the dispatch response', async () => {
    let requestInit: RequestInit | undefined
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestInit = init
      return new Response(
        JSON.stringify({
          workflow_run_id: 123,
          html_url: 'https://github.com/Rahban1/planner/actions/runs/123',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })

    const result = await dispatchGitHubActionsRun(config, 'run-1', {
      fetchImpl,
      sleep: async () => undefined,
    })

    expect(result).toEqual({
      jobId: '123',
      jobUrl: 'https://github.com/Rahban1/planner/actions/runs/123',
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(requestInit?.body).toBe(
      JSON.stringify({ ref: 'master', inputs: { run_id: 'run-1' } }),
    )
  })

  it('supports the legacy empty dispatch response', async () => {
    const result = await dispatchGitHubActionsRun(config, 'run-2', {
      fetchImpl: async () => new Response(null, { status: 204 }),
    })

    expect(result).toEqual({
      jobId: null,
      jobUrl:
        'https://github.com/Rahban1/planner/actions/workflows/planner-agent-run.yml',
    })
  })

  it('retries transient failures and stops after success', async () => {
    const delays: number[] = []
    let attempts = 0
    const result = await dispatchGitHubActionsRun(config, 'run-3', {
      fetchImpl: async () => {
        attempts += 1
        if (attempts < 3) return new Response('busy', { status: 503 })
        return new Response(null, { status: 204 })
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
    })

    expect(result.jobId).toBeNull()
    expect(attempts).toBe(3)
    expect(delays).toEqual([250, 500])
  })

  it('does not retry a permanent authorization failure', async () => {
    let attempts = 0
    await expect(
      dispatchGitHubActionsRun(config, 'run-4', {
        fetchImpl: async () => {
          attempts += 1
          return new Response('Bad credentials', { status: 401 })
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow('401: Bad credentials')
    expect(attempts).toBe(1)
  })
})

describe('shouldFailIncompleteWorkflow', () => {
  it('fails only an active run owned by the reporting workflow', () => {
    expect(shouldFailIncompleteWorkflow('running', 'job-1', 'job-1')).toBe(true)
    expect(shouldFailIncompleteWorkflow('running', 'job-1', 'job-2')).toBe(false)
    expect(shouldFailIncompleteWorkflow('queued', null, 'job-1')).toBe(true)
    expect(shouldFailIncompleteWorkflow('plan_ready', 'job-1', 'job-1')).toBe(
      false,
    )
  })

  it('ignores completion from a duplicate workflow', () => {
    expect(shouldIgnoreWorkflowCompletion('job-1', 'job-2')).toBe(true)
    expect(shouldIgnoreWorkflowCompletion('job-1', 'job-1')).toBe(false)
    expect(shouldIgnoreWorkflowCompletion(null, 'job-1')).toBe(false)
  })
})
