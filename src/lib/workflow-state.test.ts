import { describe, expect, it } from 'vitest'
import type { AgentRunWithRepositories } from '#/db/schema'
import {
  deriveWorkflowState,
  latestMeaningfulRun,
  mergeTrackedRun,
  parseGitHubPullRequest,
} from './workflow-state'

function run(
  id: string,
  kind: AgentRunWithRepositories['kind'],
  status: AgentRunWithRepositories['status'],
  createdAt: number,
  prUrl: string | null = null,
) {
  return {
    id,
    kind,
    status,
    createdAt,
    prUrl,
    repositories: [],
  } as unknown as AgentRunWithRepositories
}

describe('daily task state', () => {
  it('keeps a plan ready after the agent answers a question', () => {
    const state = deriveWorkflowState({ status: 'todo' }, [
      run('plan', 'plan', 'plan_ready', 1),
      run('answer', 'answer', 'success', 2),
    ])
    expect(state.state).toBe('plan_ready')
    expect(state.planRun?.id).toBe('plan')
    expect(state.needsYou).toBe(true)
  })
  it('keeps the current PR visible after a failed question', () => {
    const state = deriveWorkflowState({ status: 'in_progress' }, [
      run(
        'code',
        'implement',
        'success',
        1,
        'https://github.com/owner/repo/pull/1',
      ),
      run('answer', 'answer', 'error', 2),
    ])
    expect(state.state).toBe('review')
    expect(state.reviewRun?.id).toBe('code')
  })
  it('shows an active revision and retains the same PR for review', () => {
    const state = deriveWorkflowState({ status: 'in_progress' }, [
      run(
        'code',
        'implement',
        'success',
        1,
        'https://github.com/owner/repo/pull/1',
      ),
      run(
        'revision',
        'revise',
        'running',
        2,
        'https://github.com/owner/repo/pull/1',
      ),
    ])
    expect(state.state).toBe('building')
    expect(state.reviewRun?.id).toBe('revision')
    expect(state.needsYou).toBe(false)
  })
  it('does not let a superseded implementation complete a task', () => {
    expect(
      latestMeaningfulRun([
        run('code', 'implement', 'merged', 1),
        run('revision', 'revise', 'running', 2),
        run('answer', 'answer', 'success', 3),
      ])?.id,
    ).toBe('revision')
  })
})

describe('GitHub PR identity', () => {
  it('accepts a matching HTTPS repository and PR number', () => {
    expect(
      parseGitHubPullRequest(
        'https://github.com/Owner/repo.git',
        'https://github.com/owner/repo/pull/21',
        21,
      ),
    ).toEqual({ owner: 'Owner', repository: 'repo', number: 21 })
  })
  it.each([
    ['https://github.com/owner/repo', 'https://github.com/other/repo/pull/21'],
    [
      'https://github.com/owner/repo',
      'https://github.com.evil.test/owner/repo/pull/21',
    ],
    [
      'https://github.com/owner/repo',
      'https://github.com/owner/repo/pull/21/files',
    ],
    [
      'https://github.com/owner/repo',
      'https://user:pass@github.com/owner/repo/pull/21',
    ],
  ])('rejects a foreign or ambiguous PR', (repo, pr) => {
    expect(() => parseGitHubPullRequest(repo, pr)).toThrow()
  })
  it('rejects a mismatched saved PR number', () => {
    expect(() =>
      parseGitHubPullRequest(
        'https://github.com/owner/repo',
        'https://github.com/owner/repo/pull/21',
        22,
      ),
    ).toThrow()
  })
})

describe('merge tracking after a revision', () => {
  const original = run(
    'original',
    'implement',
    'success',
    1,
    'https://github.com/owner/repo/pull/1',
  )
  it('keeps the source PR tracked after a failed or stopped revision', () => {
    for (const status of ['error', 'stopped'] as const) {
      const revision = {
        ...run('revision', 'revise', status, 2),
        sourceRunId: original.id,
      }
      expect(mergeTrackedRun([original, revision])?.id).toBe(original.id)
    }
  })
  it('does not complete a source while its revision is active', () => {
    const revision = {
      ...run('revision', 'revise', 'running', 2),
      sourceRunId: original.id,
    }
    expect(mergeTrackedRun([original, revision])).toBeNull()
  })
  it('tracks the successful revision after it replaces the source', () => {
    const revision = {
      ...run('revision', 'revise', 'success', 2),
      sourceRunId: original.id,
    }
    expect(mergeTrackedRun([original, revision])?.id).toBe('revision')
  })
})
