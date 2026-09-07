import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '#/db/index'
import type { AgentRunWithRepositories, Task } from '#/db/schema'
import { deriveWorkflowState } from '#/lib/workflow-state'
import { requireUser } from './auth-middleware'
import {
  accessibleProjectIds,
  requireCurrentUser,
  requireTaskAccess,
} from './access.server'
import { withRunRepositories } from './agent-queue.server'
import { readTaskReview } from './review.server'

export type WorkflowTask = Task &
  ReturnType<typeof deriveWorkflowState> & {
    projectName: string
    projectRepoUrls: string[]
    currentUserId: string
    runs: AgentRunWithRepositories[]
    planHistory: Array<{
      id: string
      version: number
      planMd: string
      feedback: string | null
      createdAt: number
    }>
  }

async function workflowTasks(taskId?: string): Promise<WorkflowTask[]> {
  const user = await requireCurrentUser()
  const ids = await accessibleProjectIds(user)
  if (!ids.length) return []
  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        inArray(schema.tasks.projectId, ids),
        taskId ? eq(schema.tasks.id, taskId) : isNull(schema.tasks.parentId),
      ),
    )
    .orderBy(desc(schema.tasks.updatedAt))
  if (!tasks.length) return []
  const taskIds = tasks.map((task) => task.id)
  const [projects, repositories, allRuns, history] = await Promise.all([
    db.select().from(schema.projects).where(inArray(schema.projects.id, ids)),
    db
      .select()
      .from(schema.projectRepositories)
      .where(inArray(schema.projectRepositories.projectId, ids)),
    db
      .select()
      .from(schema.agentRuns)
      .where(inArray(schema.agentRuns.taskId, taskIds))
      .orderBy(desc(schema.agentRuns.createdAt)),
    taskId
      ? db
          .select()
          .from(schema.planRevisions)
          .innerJoin(
            schema.agentRuns,
            eq(schema.planRevisions.agentRunId, schema.agentRuns.id),
          )
          .where(eq(schema.agentRuns.taskId, taskId))
          .orderBy(desc(schema.planRevisions.createdAt))
      : Promise.resolve([]),
  ])
  const withRepos = await withRunRepositories(allRuns)
  return tasks.flatMap((task) => {
    const project = projects.find((row) => row.id === task.projectId)
    if (!project || (!taskId && project.archived)) return []
    const runs = withRepos.filter((run) => run.taskId === task.id)
    const repoUrls = repositories
      .filter((repo) => repo.projectId === project.id)
      .sort((a, b) => a.position - b.position)
      .map((repo) => repo.url)
    return [
      {
        ...task,
        ...deriveWorkflowState(task, runs),
        projectName: project.name,
        projectRepoUrls: repoUrls.length
          ? repoUrls
          : project.repoUrl
            ? [project.repoUrl]
            : [],
        currentUserId: user.id,
        runs,
        planHistory: history.map((row) => row.plan_revisions),
      },
    ]
  })
}

export const listWorkflowTasks = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(() => workflowTasks())

export const getTaskWorkflow = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireTaskAccess(data.taskId)
    const [task] = await workflowTasks(data.taskId)
    if (!task) throw new Error('Task not found')
    return task
  })

export const getTaskReview = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string().min(1) }))
  .handler(({ data }) => readTaskReview(data.taskId))
