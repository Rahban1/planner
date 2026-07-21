import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, desc, and, isNotNull } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type { AgentRun } from '#/db/schema'

const id = () => crypto.randomUUID()

function now() {
  return Date.now()
}

async function queueRun(taskId: string, kind: 'implement' | 'plan') {
  const task = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .then((rows) => rows[0])
  if (!task) throw new Error('Task not found')

  const project = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, task.projectId))
    .then((rows) => rows[0])
  if (!project) throw new Error('Project not found')

  // Idempotency: if there's already a queued or running run of this kind
  // for the task, return it.
  const existing = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.taskId, taskId))
    .then((rows) =>
      rows.find(
        (r) => r.kind === kind && (r.status === 'queued' || r.status === 'running'),
      ),
    )
  if (existing) return existing as AgentRun

  const runId = id()
  const t = now()
  await db.insert(schema.agentRuns).values({
    id: runId,
    taskId,
    projectId: project.id,
    status: 'queued',
    kind,
    repoUrl: project.repoUrl,
    logs: JSON.stringify([
      {
        t,
        level: 'info',
        message:
          kind === 'plan'
            ? 'Plan run queued. Waiting for agent runner.'
            : 'Run queued. Waiting for agent runner.',
      },
    ]),
    createdAt: t,
    updatedAt: t,
  })

  const [run] = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, runId))
  return run as AgentRun
}

export const giveTaskToAgent = createServerFn({ method: 'POST' })
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => queueRun(data.taskId, 'implement'))

export const planTask = createServerFn({ method: 'POST' })
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => queueRun(data.taskId, 'plan'))

export const approvePlan = createServerFn({ method: 'POST' })
  .validator(z.object({ runId: z.string() }))
  .handler(async ({ data }) => {
    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.runId))
    if (!run) throw new Error('Agent run not found')
    if (run.kind !== 'plan') throw new Error('Not a plan run')
    if (run.status !== 'plan_ready') throw new Error('Plan is not ready for review')

    await db
      .update(schema.agentRuns)
      .set({ status: 'approved', updatedAt: now() })
      .where(eq(schema.agentRuns.id, data.runId))

    // Auto-start implementation; the runner picks up the approved plan
    // through the task-context endpoint.
    return queueRun(run.taskId, 'implement')
  })

export const requestPlanChanges = createServerFn({ method: 'POST' })
  .validator(z.object({ runId: z.string(), feedback: z.string().min(1) }))
  .handler(async ({ data }) => {
    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.runId))
    if (!run) throw new Error('Agent run not found')
    if (run.kind !== 'plan') throw new Error('Not a plan run')
    if (run.status !== 'plan_ready') throw new Error('Plan is not ready for review')

    await db
      .update(schema.agentRuns)
      .set({
        status: 'queued',
        planFeedback: data.feedback,
        planVersion: run.planVersion + 1,
        updatedAt: now(),
      })
      .where(eq(schema.agentRuns.id, data.runId))

    const [updated] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.runId))
    return updated as AgentRun
  })

export const getLatestApprovedPlan = createServerFn({ method: 'GET' })
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, data.taskId))
      .orderBy(schema.agentRuns.createdAt)
    return runs.filter((r) => r.kind === 'plan' && r.status === 'approved').pop() as
      | AgentRun
      | undefined
  })

export const getLatestPlanRun = createServerFn({ method: 'GET' })
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, data.taskId))
      .orderBy(schema.agentRuns.createdAt)
    return runs.filter((r) => r.kind === 'plan').pop() as AgentRun | undefined
  })

export const getAgentRunForTask = createServerFn({ method: 'GET' })
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, data.taskId))
      .orderBy(schema.agentRuns.createdAt)
    return runs[runs.length - 1] as AgentRun | undefined
  })

export const getAgentRun = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.id))
    return run as AgentRun | undefined
  })

export const listQueuedAgentRuns = createServerFn({ method: 'GET' })
  .handler(async () => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.status, 'queued'))
      .orderBy(schema.agentRuns.createdAt)
    return runs as AgentRun[]
  })

export const listAwaitingMergeRuns = createServerFn({ method: 'GET' })
  .handler(async () => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(and(eq(schema.agentRuns.status, 'success'), isNotNull(schema.agentRuns.prUrl)))
      .orderBy(schema.agentRuns.createdAt)
    return runs as AgentRun[]
  })

export const listAgentRuns = createServerFn({ method: 'GET' })
  .handler(async () => {
    const runs = await db
      .select({
        id: schema.agentRuns.id,
        taskId: schema.agentRuns.taskId,
        projectId: schema.agentRuns.projectId,
        status: schema.agentRuns.status,
        kind: schema.agentRuns.kind,
        repoUrl: schema.agentRuns.repoUrl,
        branchName: schema.agentRuns.branchName,
        prUrl: schema.agentRuns.prUrl,
        prNumber: schema.agentRuns.prNumber,
        planVersion: schema.agentRuns.planVersion,
        logs: schema.agentRuns.logs,
        errorMessage: schema.agentRuns.errorMessage,
        createdAt: schema.agentRuns.createdAt,
        updatedAt: schema.agentRuns.updatedAt,
        taskTitle: schema.tasks.title,
        projectName: schema.projects.name,
      })
      .from(schema.agentRuns)
      .leftJoin(schema.tasks, eq(schema.agentRuns.taskId, schema.tasks.id))
      .leftJoin(schema.projects, eq(schema.agentRuns.projectId, schema.projects.id))
      .orderBy(desc(schema.agentRuns.createdAt))
    return runs
  })

const logSchema = z.object({
  t: z.number(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
})

export const updateAgentRun = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      status: z
        .enum(['queued', 'running', 'success', 'error', 'merged', 'closed', 'plan_ready', 'approved'])
        .optional(),
      branchName: z.string().optional(),
      prUrl: z.string().optional(),
      prNumber: z.number().optional(),
      planMd: z.string().optional(),
      logs: z.array(logSchema).optional(),
      appendLogs: z.array(logSchema).optional(),
      errorMessage: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const [existing] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.id))
    if (!existing) throw new Error('Agent run not found')

    let logs = existing.logs
    if (data.logs !== undefined) {
      logs = JSON.stringify(data.logs)
    } else if (data.appendLogs !== undefined && data.appendLogs.length > 0) {
      const current = parseLogs(existing.logs)
      logs = JSON.stringify([...current, ...data.appendLogs])
    }

    await db
      .update(schema.agentRuns)
      .set({
        status: data.status ?? existing.status,
        branchName: data.branchName ?? existing.branchName,
        prUrl: data.prUrl ?? existing.prUrl,
        prNumber: data.prNumber ?? existing.prNumber,
        planMd: data.planMd ?? existing.planMd,
        logs,
        errorMessage: data.errorMessage ?? existing.errorMessage,
        updatedAt: now(),
      })
      .where(eq(schema.agentRuns.id, data.id))

    // When a run's PR is merged, automatically complete the task.
    if (data.status === 'merged' && existing.status !== 'merged') {
      const t = now()
      await db
        .update(schema.tasks)
        .set({ status: 'done', completedAt: t, updatedAt: t })
        .where(eq(schema.tasks.id, existing.taskId))
    }

    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.id))
    return run as AgentRun
  })

export const stopAgentRun = createServerFn({ method: 'POST' })
  .validator(z.object({ runId: z.string() }))
  .handler(async ({ data }) => {
    const [existing] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.runId))
    if (!existing) throw new Error('Agent run not found')

    if (existing.status !== 'queued' && existing.status !== 'running') {
      throw new Error('Run is not active')
    }

    const t = now()
    const currentLogs = parseLogs(existing.logs)
    const appendLogs = [
      ...currentLogs,
      { t, level: 'warn' as const, message: 'Run stopped by user.' },
    ]

    await db
      .update(schema.agentRuns)
      .set({
        status: 'stopped',
        logs: JSON.stringify(appendLogs),
        updatedAt: t,
      })
      .where(eq(schema.agentRuns.id, data.runId))

    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.runId))
    return run as AgentRun
  })

function parseLogs(raw: string | null): Array<z.infer<typeof logSchema>> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // ignore
  }
  return []
}
