import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { z } from 'zod'
import { eq, desc, and, isNotNull, asc, lt } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type {
  AgentRun,
  AgentRunRepository,
  AgentRunWithRepositories,
} from '#/db/schema'
import { requireUser } from './auth-middleware'
import {
  dispatchGitHubActionsRun,
  shouldFailIncompleteWorkflow,
  shouldIgnoreWorkflowCompletion,
} from './github-actions-client'

const id = () => crypto.randomUUID()

function now() {
  return Date.now()
}

const GITHUB_ACTIONS_STALE_AFTER_MS = 40 * 60 * 1000

async function dispatchQueuedRun(runId: string): Promise<void> {
  const token = env.GITHUB_ACTIONS_DISPATCH_TOKEN
  if (!token) return

  const [existing] = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, runId))
  if (!existing || existing.status !== 'queued') return

  const dispatchedAt = now()
  try {
    const result = await dispatchGitHubActionsRun(
      {
        owner: env.GITHUB_ACTIONS_OWNER,
        repository: env.GITHUB_ACTIONS_REPOSITORY,
        workflow: env.GITHUB_ACTIONS_WORKFLOW,
        ref: env.GITHUB_ACTIONS_REF,
        token,
      },
      runId,
    )
    const logs = [
      ...parseLogs(existing.logs),
      {
        t: dispatchedAt,
        level: 'info' as const,
        message: `GitHub Actions runner dispatched: ${result.jobUrl}`,
      },
    ]
    await db
      .update(schema.agentRuns)
      .set({
        runnerBackend: 'github_actions',
        runnerJobId: result.jobId,
        runnerJobUrl: result.jobUrl,
        dispatchAttempts: existing.dispatchAttempts + 1,
        dispatchedAt,
        logs: JSON.stringify(logs),
        updatedAt: dispatchedAt,
      })
      .where(
        and(
          eq(schema.agentRuns.id, runId),
          eq(schema.agentRuns.status, 'queued'),
        ),
      )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const logs = [
      ...parseLogs(existing.logs),
      {
        t: dispatchedAt,
        level: 'error' as const,
        message: `Runner dispatch failed: ${message}`,
      },
    ]
    const failed = await db
      .update(schema.agentRuns)
      .set({
        status: 'error',
        runnerBackend: 'github_actions',
        dispatchAttempts: existing.dispatchAttempts + 1,
        errorMessage: `Could not start GitHub Actions runner: ${message}`,
        logs: JSON.stringify(logs),
        updatedAt: dispatchedAt,
      })
      .where(
        and(
          eq(schema.agentRuns.id, runId),
          eq(schema.agentRuns.status, 'queued'),
        ),
      )
      .returning({ id: schema.agentRuns.id })
    if (failed.length > 0) {
      await db
        .update(schema.tasks)
        .set({ lifecycleState: 'failed', updatedAt: dispatchedAt })
        .where(eq(schema.tasks.id, existing.taskId))
      throw error
    }
  }
}

async function addRunRepositories<T extends { id: string }>(
  runs: T[],
): Promise<Array<T & { repositories: AgentRunRepository[] }>> {
  if (runs.length === 0) return []

  const runIds = new Set(runs.map((run) => run.id))
  const repositoryRows = (
    await db
      .select()
      .from(schema.agentRunRepositories)
      .orderBy(asc(schema.agentRunRepositories.position))
  ).filter((repository) => runIds.has(repository.agentRunId))
  const repositoriesByRun = new Map<string, AgentRunRepository[]>()

  for (const repository of repositoryRows) {
    const repositories = repositoriesByRun.get(repository.agentRunId) ?? []
    repositories.push(repository)
    repositoriesByRun.set(repository.agentRunId, repositories)
  }

  return runs.map((run) => ({
    ...run,
    repositories: repositoriesByRun.get(run.id) ?? [],
  }))
}

async function replaceRunRepositories(
  agentRunId: string,
  repositories: Array<{
    repoUrl: string
    position: number
    status: AgentRunRepository['status']
    branchName?: string | null
    prUrl?: string | null
    prNumber?: number | null
    errorMessage?: string | null
  }>,
  updatedAt: number,
) {
  const removeExisting = db
    .delete(schema.agentRunRepositories)
    .where(eq(schema.agentRunRepositories.agentRunId, agentRunId))

  if (repositories.length === 0) {
    await removeExisting
    return
  }

  const insertRepositories = db.insert(schema.agentRunRepositories).values(
    repositories.map((repository) => ({
      id: id(),
      agentRunId,
      repoUrl: repository.repoUrl,
      position: repository.position,
      status: repository.status,
      branchName: repository.branchName ?? null,
      prUrl: repository.prUrl ?? null,
      prNumber: repository.prNumber ?? null,
      errorMessage: repository.errorMessage ?? null,
      createdAt: updatedAt,
      updatedAt,
    })),
  )
  await db.batch([removeExisting, insertRepositories])
}

async function appendTaskMessage(taskId: string, kind: 'progress' | 'plan' | 'pr' | 'error', body: string, metadata?: Record<string, unknown>) {
  const t = now()
  await db.insert(schema.taskMessages).values({
    id: id(),
    taskId,
    authorType: 'agent',
    authorUserId: null,
    kind,
    body,
    metadata: metadata ? JSON.stringify(metadata) : null,
    clientMessageId: null,
    createdAt: t,
    updatedAt: t,
  })
  await db.update(schema.tasks).set({ lastMessageAt: t, updatedAt: t }).where(eq(schema.tasks.id, taskId))
}

async function queueRun(taskId: string, kind: 'answer' | 'implement' | 'plan') {
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

  const repositoryRows = await db
    .select()
    .from(schema.projectRepositories)
    .where(eq(schema.projectRepositories.projectId, project.id))
    .orderBy(asc(schema.projectRepositories.position))
  const repoUrls =
    repositoryRows.length > 0
      ? repositoryRows.map((repository) => repository.url)
      : project.repoUrl
        ? [project.repoUrl]
        : []
  if (repoUrls.length === 0 && kind !== 'answer') throw new Error('Project has no repositories')

  // Idempotency: if there's already a queued or running run of this kind
  // for the task, return it.
  const existing = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.taskId, taskId))
    .then((rows) =>
      rows.find(
        (r) =>
          r.kind === kind && (r.status === 'queued' || r.status === 'running'),
      ),
    )
  if (existing) return (await addRunRepositories([existing as AgentRun]))[0]

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
            : kind === 'answer'
              ? 'Question queued. Waiting for agent runner.'
              : 'Run queued. Waiting for agent runner.',
      },
    ]),
    createdAt: t,
    updatedAt: t,
  })
  await db.insert(schema.agentRunRepositories).values(
    repoUrls.map((repoUrl, position) => ({
      id: id(),
      agentRunId: runId,
      repoUrl,
      position,
      status: 'pending' as const,
      createdAt: t,
      updatedAt: t,
    })),
  )

  await dispatchQueuedRun(runId)

  const [run] = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, runId))
  return (await addRunRepositories([run as AgentRun]))[0]
}

export const giveTaskToAgent = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => queueRun(data.taskId, 'implement'))

export const planTask = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => queueRun(data.taskId, 'plan'))

export const askAgentQuestion = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => queueRun(data.taskId, 'answer'))

export const approvePlan = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ runId: z.string() }))
  .handler(async ({ data }) => {
    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.runId))
    if (!run) throw new Error('Agent run not found')
    if (run.kind !== 'plan') throw new Error('Not a plan run')
    if (run.status !== 'plan_ready')
      throw new Error('Plan is not ready for review')

    await db
      .update(schema.agentRuns)
      .set({ status: 'approved', updatedAt: now() })
      .where(eq(schema.agentRuns.id, data.runId))

    // Auto-start implementation; the runner picks up the approved plan
    // through the task-context endpoint.
    return queueRun(run.taskId, 'implement')
  })

export const requestPlanChanges = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ runId: z.string(), feedback: z.string().min(1) }))
  .handler(async ({ data }) => {
    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.runId))
    if (!run) throw new Error('Agent run not found')
    if (run.kind !== 'plan') throw new Error('Not a plan run')
    if (run.status !== 'plan_ready')
      throw new Error('Plan is not ready for review')

    await db
      .update(schema.agentRuns)
      .set({
        status: 'queued',
        planFeedback: data.feedback,
        planVersion: run.planVersion + 1,
        updatedAt: now(),
      })
      .where(eq(schema.agentRuns.id, data.runId))

    await dispatchQueuedRun(data.runId)

    const [updated] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.runId))
    return updated as AgentRun
  })

export const getLatestApprovedPlan = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, data.taskId))
      .orderBy(schema.agentRuns.createdAt)
    return (
      runs
        .filter((r) => r.kind === 'plan' && r.status === 'approved')
        .pop() as AgentRun | null
    ) ?? null
  })

export const getLatestPlanRun = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, data.taskId))
      .orderBy(schema.agentRuns.createdAt)
    return (runs.filter((r) => r.kind === 'plan').pop() as AgentRun | null) ?? null
  })

export const getAgentRunForTask = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, data.taskId))
      .orderBy(schema.agentRuns.createdAt)
    const run = runs[runs.length - 1] as AgentRun | undefined
    return run ? (await addRunRepositories([run]))[0] : null
  })

export const getAgentRun = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.id))
    return run ? (await addRunRepositories([run as AgentRun]))[0] : null
  })

export const listQueuedAgentRuns = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.status, 'queued'))
      .orderBy(schema.agentRuns.createdAt)
    return addRunRepositories(runs as AgentRun[])
  })

export const claimAgentRun = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      runId: z.string().min(1),
      jobId: z.string().min(1).optional(),
      jobUrl: z.string().url().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const claimedAt = now()
    const claimed = await db
      .update(schema.agentRuns)
      .set({
        status: 'running',
        runnerBackend: data.jobId ? 'github_actions' : 'local',
        runnerJobId: data.jobId,
        runnerJobUrl: data.jobUrl,
        dispatchedAt: data.jobId ? claimedAt : undefined,
        updatedAt: claimedAt,
      })
      .where(
        and(
          eq(schema.agentRuns.id, data.runId),
          eq(schema.agentRuns.status, 'queued'),
        ),
      )
      .returning()
    if (claimed.length === 0) return { claimed: false, run: null }
    const [run] = await addRunRepositories([claimed[0] as AgentRun])
    return { claimed: true, run }
  })

export const completeAgentWorkflow = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      runId: z.string().min(1),
      outcome: z.enum(['success', 'failure', 'cancelled']),
      jobId: z.string().min(1),
      jobUrl: z.string().url(),
    }),
  )
  .handler(async ({ data }) => {
    const [existing] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.runId))
    if (!existing) throw new Error('Agent run not found')

    if (shouldIgnoreWorkflowCompletion(existing.runnerJobId, data.jobId)) {
      return { ok: true, changedToError: false, ignored: true }
    }

    const completedAt = now()
    const shouldFail = shouldFailIncompleteWorkflow(
      existing.status,
      existing.runnerJobId,
      data.jobId,
    )
    const failureMessage =
      data.outcome === 'success'
        ? 'GitHub Actions finished, but the runner did not report a final state.'
        : `GitHub Actions ${data.outcome} before the agent run finished.`
    const logs = shouldFail
      ? [
          ...parseLogs(existing.logs),
          { t: completedAt, level: 'error' as const, message: failureMessage },
        ]
      : parseLogs(existing.logs)

    await db
      .update(schema.agentRuns)
      .set({
        status: shouldFail ? 'error' : existing.status,
        runnerBackend: 'github_actions',
        runnerJobId: data.jobId,
        runnerJobUrl: data.jobUrl,
        errorMessage: shouldFail ? failureMessage : existing.errorMessage,
        logs: JSON.stringify(logs),
        updatedAt: completedAt,
      })
      .where(eq(schema.agentRuns.id, data.runId))

    if (shouldFail) {
      await db
        .update(schema.tasks)
        .set({ lifecycleState: 'failed', updatedAt: completedAt })
        .where(eq(schema.tasks.id, existing.taskId))
    }
    return { ok: true, changedToError: shouldFail, ignored: false }
  })

export const expireStaleAgentRuns = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .handler(async () => {
    const expiredAt = now()
    const cutoff = expiredAt - GITHUB_ACTIONS_STALE_AFTER_MS
    const staleRuns = await db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.runnerBackend, 'github_actions'),
          isNotNull(schema.agentRuns.dispatchedAt),
          lt(schema.agentRuns.dispatchedAt, cutoff),
        ),
      )
    const activeRuns = staleRuns.filter(
      (run) => run.status === 'queued' || run.status === 'running',
    )
    let expiredCount = 0

    for (const run of activeRuns) {
      const message =
        'GitHub Actions did not finish within 40 minutes. Start a new run.'
      const expired = await db
        .update(schema.agentRuns)
        .set({
          status: 'error',
          errorMessage: message,
          logs: JSON.stringify([
            ...parseLogs(run.logs),
            { t: expiredAt, level: 'error' as const, message },
          ]),
          updatedAt: expiredAt,
        })
        .where(
          and(
            eq(schema.agentRuns.id, run.id),
            eq(schema.agentRuns.status, run.status),
          ),
        )
        .returning({ id: schema.agentRuns.id })
      if (expired.length === 0) continue
      expiredCount += 1
      await db
        .update(schema.tasks)
        .set({ lifecycleState: 'failed', updatedAt: expiredAt })
        .where(eq(schema.tasks.id, run.taskId))
    }

    return { expired: expiredCount }
  })

export const listAwaitingMergeRuns = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => {
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.status, 'success'),
          isNotNull(schema.agentRuns.prUrl),
        ),
      )
      .orderBy(schema.agentRuns.createdAt)
    return addRunRepositories(runs as AgentRun[])
  })

export const listAgentRuns = createServerFn({ method: 'GET' })
  .middleware([requireUser])
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
        runnerBackend: schema.agentRuns.runnerBackend,
        runnerJobId: schema.agentRuns.runnerJobId,
        runnerJobUrl: schema.agentRuns.runnerJobUrl,
        dispatchAttempts: schema.agentRuns.dispatchAttempts,
        dispatchedAt: schema.agentRuns.dispatchedAt,
        createdAt: schema.agentRuns.createdAt,
        updatedAt: schema.agentRuns.updatedAt,
        taskTitle: schema.tasks.title,
        projectName: schema.projects.name,
      })
      .from(schema.agentRuns)
      .leftJoin(schema.tasks, eq(schema.agentRuns.taskId, schema.tasks.id))
      .leftJoin(
        schema.projects,
        eq(schema.agentRuns.projectId, schema.projects.id),
      )
      .orderBy(desc(schema.agentRuns.createdAt))
    return addRunRepositories(runs)
  })

const logSchema = z.object({
  t: z.number(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
})

const runRepositorySchema = z.object({
  repoUrl: z.string().url(),
  position: z.number().int().min(0),
  status: z.enum([
    'pending',
    'skipped',
    'success',
    'merged',
    'closed',
    'error',
  ]),
  branchName: z.string().nullable().optional(),
  prUrl: z.string().url().nullable().optional(),
  prNumber: z.number().int().positive().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
})

export const updateAgentRun = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      id: z.string(),
      status: z
        .enum([
          'queued',
          'running',
          'success',
          'error',
          'merged',
          'closed',
          'plan_ready',
          'approved',
        ])
        .optional(),
      branchName: z.string().nullable().optional(),
      prUrl: z.string().optional(),
      prNumber: z.number().optional(),
      repositories: z.array(runRepositorySchema).max(8).optional(),
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

    const updatedAt = now()
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
        updatedAt,
      })
      .where(eq(schema.agentRuns.id, data.id))

    if (data.repositories !== undefined) {
      await replaceRunRepositories(data.id, data.repositories, updatedAt)
    }

    const lifecycleState = data.status === 'plan_ready'
      ? 'plan_ready'
      : data.status === 'running'
        ? 'running'
        : data.status === 'success'
          ? 'pr_open'
          : data.status === 'error'
            ? 'failed'
            : data.status === 'merged'
              ? 'done'
              : data.status === 'approved'
                ? 'approved'
                : undefined
    if (lifecycleState) {
      await db.update(schema.tasks).set({ lifecycleState, nextAction: lifecycleState === 'plan_ready' ? 'Review the agent plan' : lifecycleState === 'pr_open' ? 'Review the pull request' : null, updatedAt }).where(eq(schema.tasks.id, existing.taskId))
    }
    const importantLogs = (data.appendLogs ?? []).filter((entry) => entry.level !== 'info' || /pull request|plan|error|merged|proof/i.test(entry.message))
    for (const entry of importantLogs) {
      const kind = entry.level === 'error' ? 'error' : /pull request/i.test(entry.message) ? 'pr' : 'progress'
      await appendTaskMessage(existing.taskId, kind, entry.message, { runId: existing.id })
    }
    if (data.planMd) await appendTaskMessage(existing.taskId, 'plan', data.planMd, { runId: existing.id, version: existing.planVersion })

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
    return (
      await addRunRepositories([run as AgentRun])
    )[0] as AgentRunWithRepositories
  })

export const stopAgentRun = createServerFn({ method: 'POST' })
  .middleware([requireUser])
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
