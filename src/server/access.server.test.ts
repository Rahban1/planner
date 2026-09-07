// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accessibleProjectIds,
  isRunnerRequest,
  requireProjectAccess,
  requireTaskAccess,
} from './access.server'

const state = vi.hoisted(() => ({
  request: new Request('https://planner.example/_serverFn/test'),
  token: 'machine-token',
  projects: [{ id: 'project' }],
  members: [] as Array<{ projectId: string }>,
  tasks: [{ id: 'task', projectId: 'project' }],
  user: { id: 'user', email: 'owner@example.test' },
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => state.request,
}))
vi.mock('./auth', () => ({
  getUserFromCookie: () => Promise.resolve(state.user),
}))
vi.mock('#/db/index', () => {
  const projects = { id: 'project-id' }
  const projectMembers = {
    id: 'member-id',
    projectId: 'member-project-id',
    email: 'member-email',
  }
  const tasks = { id: 'task-id' }
  return {
    runtimeEnv: {
      get RUNNER_API_TOKEN() {
        return state.token
      },
    },
    schema: { projects, projectMembers, tasks },
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () =>
            Promise.resolve(
              table === projects
                ? state.projects
                : table === projectMembers
                  ? state.members
                  : state.tasks,
            ),
        }),
      }),
    },
  }
})

beforeEach(() => {
  state.request = new Request('https://planner.example/_serverFn/test')
  state.token = 'machine-token'
  state.members = []
})

describe('workflow access boundary', () => {
  it('rejects a known project ID when there are no membership rows', async () => {
    await expect(requireProjectAccess('project')).rejects.toThrow(
      'Project membership required',
    )
  })
  it('rejects a known task ID without membership', async () => {
    await expect(requireTaskAccess('task')).rejects.toThrow(
      'Project membership required',
    )
  })
  it('allows a project member and scopes project lists to memberships', async () => {
    state.members = [{ projectId: 'project' }]
    await expect(requireTaskAccess('task')).resolves.toMatchObject({
      id: 'task',
    })
    await expect(accessibleProjectIds()).resolves.toEqual(['project'])
  })
  it('does not trust a runner path without its machine token', async () => {
    state.request = new Request('https://planner.example/api/runner/runs/task')
    expect(isRunnerRequest()).toBe(false)
    await expect(requireTaskAccess('task')).rejects.toThrow(
      'Project membership required',
    )
  })
  it('accepts a runner request only with the matching token', async () => {
    state.request = new Request(
      'https://planner.example/api/runner/runs/task',
      { headers: { 'X-Runner-Token': 'machine-token' } },
    )
    expect(isRunnerRequest()).toBe(true)
    await expect(requireTaskAccess('task')).resolves.toMatchObject({
      id: 'task',
    })
  })
  it('does not open production runner access when no token is configured', () => {
    state.token = ''
    state.request = new Request('https://planner.example/api/runner/queue')
    expect(isRunnerRequest()).toBe(false)
    state.request = new Request('http://localhost:3000/api/runner/queue')
    expect(isRunnerRequest()).toBe(true)
  })
})
