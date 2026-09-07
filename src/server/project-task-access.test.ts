import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from './projects'
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listProjectSummary,
  listTasksForProject,
  uncompleteTask,
  updateTask,
} from './tasks'

const mocks = vi.hoisted(() => ({
  projectAccess: vi.fn(),
  taskAccess: vi.fn(),
  currentUser: vi.fn(),
  projectIds: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  batch: vi.fn(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let inputSchema: { parse: (value: unknown) => unknown } | undefined
    const builder = {
      middleware: () => builder,
      validator: (schema: { parse: (value: unknown) => unknown }) => {
        inputSchema = schema
        return builder
      },
      handler:
        (handler: (args: { data: unknown }) => unknown) =>
        async (input?: { data?: unknown }) =>
          handler({
            data: inputSchema ? inputSchema.parse(input?.data) : input?.data,
          }),
    }
    return builder
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeader: vi.fn() }))
vi.mock('./auth', () => ({ getUserFromCookie: vi.fn() }))
vi.mock('./auth-middleware', () => ({ requireUser: {} }))
vi.mock('./access.server', () => ({
  requireProjectAccess: mocks.projectAccess,
  requireTaskAccess: mocks.taskAccess,
  requireCurrentUser: mocks.currentUser,
  accessibleProjectIds: mocks.projectIds,
}))
vi.mock('#/db/index', async () => ({
  schema: await import('../db/schema'),
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    delete: mocks.delete,
    batch: mocks.batch,
  },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.projectAccess.mockRejectedValue(
    new Error('Project membership required'),
  )
  mocks.taskAccess.mockRejectedValue(new Error('Project membership required'))
  mocks.currentUser.mockRejectedValue(new Error('Unauthorized'))
  mocks.projectIds.mockResolvedValue([])
})

describe('project and task access boundaries', () => {
  const restrictedCalls = [
    ['read project', () => getProject({ data: { id: 'private-project' } })],
    [
      'change project',
      () => updateProject({ data: { id: 'private-project', name: 'Changed' } }),
    ],
    [
      'archive project',
      () => archiveProject({ data: { id: 'private-project' } }),
    ],
    [
      'delete project',
      () => deleteProject({ data: { id: 'private-project' } }),
    ],
    [
      'list project tasks',
      () => listTasksForProject({ data: { projectId: 'private-project' } }),
    ],
    [
      'read project summary',
      () => listProjectSummary({ data: { projectId: 'private-project' } }),
    ],
    [
      'create project task',
      () =>
        createTask({ data: { projectId: 'private-project', title: 'Task' } }),
    ],
    ['read task', () => getTask({ data: { id: 'private-task' } })],
    [
      'change task',
      () => updateTask({ data: { id: 'private-task', title: 'Changed' } }),
    ],
    ['complete task', () => completeTask({ data: { id: 'private-task' } })],
    ['reopen task', () => uncompleteTask({ data: { id: 'private-task' } })],
    ['delete task', () => deleteTask({ data: { id: 'private-task' } })],
  ] as const

  it.each(restrictedCalls)(
    'blocks %s before private data is read or changed',
    async (_name, invoke) => {
      await expect(invoke()).rejects.toThrow('Project membership required')
      expect(mocks.select).not.toHaveBeenCalled()
      expect(mocks.insert).not.toHaveBeenCalled()
      expect(mocks.update).not.toHaveBeenCalled()
      expect(mocks.delete).not.toHaveBeenCalled()
      expect(mocks.batch).not.toHaveBeenCalled()
    },
  )

  it('returns no projects for an account with no memberships', async () => {
    await expect(listProjects()).resolves.toEqual([])
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('rejects a parent in another accessible project before task insertion', async () => {
    mocks.projectAccess.mockResolvedValue({ id: 'project-a' })
    mocks.taskAccess.mockResolvedValue({ id: 'parent', projectId: 'project-b' })
    await expect(
      createTask({
        data: {
          projectId: 'project-a',
          parentId: 'parent',
          title: 'Child task',
        },
      }),
    ).rejects.toThrow('same project')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('requires a signed-in owner when a project is created', async () => {
    await expect(createProject({ data: { name: 'Project' } })).rejects.toThrow(
      'Unauthorized',
    )
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('rejects working rules above 20,000 characters before database changes', async () => {
    await expect(
      updateProject({
        data: { id: 'project', instructions: 'a'.repeat(20_001) },
      }),
    ).rejects.toThrow()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.projectAccess).not.toHaveBeenCalled()
  })
})
