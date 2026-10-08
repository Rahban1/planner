import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchQueuedRun } from './agent-queue.server'

const mocks = vi.hoisted(() => ({
  env: { RUNNER_BACKEND: 'docker', GITHUB_ACTIONS_DISPATCH_TOKEN: 'test-token' },
  select: vi.fn(),
  dispatch: vi.fn(),
}))

vi.mock('#/db/index', () => ({
  db: { select: mocks.select },
  runtimeEnv: mocks.env,
  schema: {},
}))
vi.mock('./access.server', () => ({ requireTaskAccess: vi.fn() }))
vi.mock('./github-actions-client', () => ({
  dispatchGitHubActionsRun: mocks.dispatch,
}))

describe('persistent runner dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.env.RUNNER_BACKEND = 'docker'
    mocks.env.GITHUB_ACTIONS_DISPATCH_TOKEN = 'test-token'
  })

  it('keeps Docker runs queued even when a GitHub dispatch token exists', async () => {
    expect(await dispatchQueuedRun('pi-run')).toBeNull()
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('keeps the existing no-token local path', async () => {
    mocks.env.RUNNER_BACKEND = 'github_actions'
    mocks.env.GITHUB_ACTIONS_DISPATCH_TOKEN = ''
    expect(await dispatchQueuedRun('local-run')).toBeNull()
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
