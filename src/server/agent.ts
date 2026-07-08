import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, desc } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type { AgentRun } from '#/db/schema'

const id = () => crypto.randomUUID()

function now() {
  return Date.now()
}

export const giveTaskToAgent = createServerFn({ method: 'POST' })
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const task = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, data.taskId))
      .then((rows) => rows[0])
    if (!task) throw new Error('Task not found')

    const project = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, task.projectId))
      .then((rows) => rows[0])
    if (!project) throw new Error('Project not found')

    // Idempotency: if there's already a queued or running run for this task, return it.
    const existing = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, data.taskId))
      .then((rows) =>
        rows.find((r) => r.status === 'queued' || r.status === 'running'),
      )
    if (existing) return existing as AgentRun

    const runId = id()
    const t = now()
    await db.insert(schema.agentRuns).values({
      id: runId,
      taskId: data.taskId,
      projectId: project.id,
      status: 'queued',
      repoUrl: project.repoUrl,
      logs: JSON.stringify([
        { t, level: 'info', message: 'Run queued. Waiting for agent runner.' },
      ]),
      createdAt: t,
      updatedAt: t,
    })

    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, runId))
    return run as AgentRun
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

export const listAgentRuns = createServerFn({ method: 'GET' })
  .handler(async () => {
    const runs = await db
      .select({
        id: schema.agentRuns.id,
        taskId: schema.agentRuns.taskId,
        projectId: schema.agentRuns.projectId,
        status: schema.agentRuns.status,
        repoUrl: schema.agentRuns.repoUrl,
        branchName: schema.agentRuns.branchName,
        prUrl: schema.agentRuns.prUrl,
        prNumber: schema.agentRuns.prNumber,
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
      status: z.enum(['queued', 'running', 'success', 'error']).optional(),
      branchName: z.string().optional(),
      prUrl: z.string().optional(),
      prNumber: z.number().optional(),
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
        logs,
        errorMessage: data.errorMessage ?? existing.errorMessage,
        updatedAt: now(),
      })
      .where(eq(schema.agentRuns.id, data.id))

    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.id))
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
