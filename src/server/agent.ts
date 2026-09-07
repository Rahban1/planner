import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, desc, and, isNotNull, lt, inArray } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type {
  AgentRun,
  AgentRunRepository,
  AgentRunWithRepositories,
} from '#/db/schema'
import { requireUser } from './auth-middleware'
import {
  accessibleProjectIds,
  isRunnerRequest,
  requireCurrentUser,
  requireRunAccess,
  requireRunnerAccess,
  requireTaskAccess,
} from './access.server'
import {
  dispatchQueuedRun,
  queueWorkflowRun,
  withRunRepositories as addRunRepositories,
} from './agent-queue.server'
import { latestMeaningfulRun, mergeTrackedRun } from '#/lib/workflow-state'
import { revisePlanSql } from '#/lib/workflow-queue'
import { validateReviewAction } from './review.server'
import {
  shouldFailIncompleteWorkflow,
  shouldIgnoreWorkflowCompletion,
} from './github-actions-client'

const id = () => crypto.randomUUID()

function now() {
  return Date.now()
}

const GITHUB_ACTIONS_STALE_AFTER_MS = 40 * 60 * 1000

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

async function appendTaskMessage(
  taskId: string,
  kind: 'progress' | 'plan' | 'pr' | 'error',
  body: string,
  metadata?: Record<string, unknown>,
) {
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
  await db
    .update(schema.tasks)
    .set({ lastMessageAt: t, updatedAt: t })
    .where(eq(schema.tasks.id, taskId))
}

export const giveTaskToAgent = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    await requireTaskAccess(data.taskId)
    const [plan] = await db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.taskId, data.taskId),
          eq(schema.agentRuns.kind, 'plan'),
          eq(schema.agentRuns.status, 'approved'),
        ),
      )
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(1)
    if (!plan) throw new Error('Approve a plan before implementation')
    return queueWorkflowRun(data.taskId, 'implement', { sourceRunId: plan.id })
  })

export const planTask = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({ taskId: z.string(), triggerMessageId: z.string().optional() }),
  )
  .handler(async ({ data }) =>
    queueWorkflowRun(data.taskId, 'plan', {
      triggerMessageId: data.triggerMessageId,
    }),
  )

export const askAgentQuestion = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      taskId: z.string(),
      triggerMessageId: z.string().optional(),
      sourceRunId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => queueWorkflowRun(data.taskId, 'answer', data))

export const approvePlan = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      runId: z.string(),
      expectedVersion: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const run = await requireRunAccess(data.runId)
    if (run.kind !== 'plan' || !run.planMd)
      throw new Error('Plan is not ready for review')
    const [latest] = await db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.taskId, run.taskId),
          eq(schema.agentRuns.kind, 'plan'),
        ),
      )
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(1)
    if (
      latest?.id !== run.id ||
      (data.expectedVersion !== undefined &&
        data.expectedVersion !== run.planVersion)
    )
      throw new Error(
        'The plan changed. Reload the current version before approval.',
      )
    const user = isRunnerRequest() ? null : await requireCurrentUser()
    return queueWorkflowRun(run.taskId, 'implement', {
      sourceRunId: run.id,
      approveVersion: data.expectedVersion ?? run.planVersion,
      approvedByUserId: user?.id,
    })
  })

export const requestPlanChanges = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      runId: z.string(),
      feedback: z.string().trim().min(1).max(20_000),
      expectedVersion: z.number().int().positive(),
    }),
  )
  .handler(async ({ data }) => {
    const run = await requireRunAccess(data.runId)
    if (run.kind !== 'plan' || run.status !== 'plan_ready')
      throw new Error('Plan is not ready for review')
    if (
      data.expectedVersion !== undefined &&
      data.expectedVersion !== run.planVersion
    )
      throw new Error('The plan changed. Reload it before sending feedback.')
    const { runtimeEnv } = await import('#/db/index')
    const t = now()
    // This predicate and approval use the same D1 transaction boundary.
    const result = await runtimeEnv.DB.prepare(revisePlanSql)
      .bind(data.feedback, t, run.id, data.expectedVersion ?? run.planVersion)
      .run()
    if (!result.meta.changes)
      throw new Error(
        'The plan changed or another run started. Reload the task.',
      )
    await appendTaskMessage(
      run.taskId,
      'progress',
      `Plan changes requested: ${data.feedback}`,
      { runId: run.id, version: run.planVersion },
    )
    await db
      .update(schema.tasks)
      .set({
        lifecycleState: 'planning',
        nextAction: 'The agent is updating the plan',
        updatedAt: t,
      })
      .where(eq(schema.tasks.id, run.taskId))
    const dispatchError = await dispatchQueuedRun(run.id)
    const [updated] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, run.id))
    return { ...(await addRunRepositories([updated]))[0], dispatchError }
  })

export const retryAgentRun = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ runId: z.string() }))
  .handler(async ({ data }) => {
    const run = await requireRunAccess(data.runId)
    if (run.status !== 'error' && run.status !== 'stopped')
      throw new Error('Only failed or stopped runs can be retried')
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, run.taskId))
      .orderBy(desc(schema.agentRuns.createdAt))
    if (runs[0]?.id !== run.id)
      throw new Error('A newer run exists. Open the current task state.')
    let sourceRunId = run.sourceRunId
    let triggerMessageId = run.triggerMessageId
    if (
      (run.kind === 'revise' || run.kind === 'answer') &&
      run.sourceRunId &&
      run.triggerMessageId
    ) {
      const [trigger] = await db
        .select()
        .from(schema.taskMessages)
        .where(eq(schema.taskMessages.id, run.triggerMessageId))
      if (!trigger) throw new Error('The original request is missing')
      const metadata = trigger.metadata
        ? (JSON.parse(trigger.metadata) as {
            review?: {
              context?: {
                repoUrl?: string
                path?: string
                line?: number
                side?: 'LEFT' | 'RIGHT'
              }
            }
          })
        : null
      const oldContext = metadata?.review?.context
      const context = oldContext
        ? {
            repoUrl: oldContext.repoUrl,
            path: oldContext.path,
            line: oldContext.line,
            side: oldContext.side,
          }
        : undefined
      const review = await validateReviewAction(
        run.taskId,
        undefined,
        run.kind === 'revise' ? 'change' : 'question',
        context,
      )
      const user = await requireCurrentUser()
      const retryMessageId = id()
      const clientMessageId = `retry:${run.id}`
      await db
        .insert(schema.taskMessages)
        .values({
          id: retryMessageId,
          taskId: run.taskId,
          authorType: 'user',
          authorUserId: user.id,
          kind: 'text',
          body: trigger.body,
          metadata: JSON.stringify({
            mode: run.kind === 'revise' ? 'change' : 'question',
            review,
            retryOf: run.id,
          }),
          clientMessageId,
          createdAt: now(),
          updatedAt: now(),
        })
        .onConflictDoNothing()
      const [message] = await db
        .select()
        .from(schema.taskMessages)
        .where(
          and(
            eq(schema.taskMessages.taskId, run.taskId),
            eq(schema.taskMessages.clientMessageId, clientMessageId),
          ),
        )
      sourceRunId = review.sourceRunId
      triggerMessageId = message.id
    }
    return queueWorkflowRun(run.taskId, run.kind, {
      sourceRunId,
      triggerMessageId,
      approvedByUserId: run.approvedByUserId,
      retry: true,
      planSnapshot:
        run.kind === 'plan'
          ? {
              planMd: run.planMd,
              feedback: run.planFeedback,
              version: run.planVersion,
            }
          : undefined,
    })
  })

export const getLatestApprovedPlan = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    await requireTaskAccess(data.taskId)
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, data.taskId))
      .orderBy(schema.agentRuns.createdAt)
    return (
      (runs
        .filter((r) => r.kind === 'plan' && r.status === 'approved')
        .pop() as AgentRun | null) ?? null
    )
  })

export const getLatestPlanRun = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    await requireTaskAccess(data.taskId)
    const runs = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, data.taskId))
      .orderBy(schema.agentRuns.createdAt)
    return (
      (runs.filter((r) => r.kind === 'plan').pop() as AgentRun | null) ?? null
    )
  })

export const getAgentRunForTask = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    await requireTaskAccess(data.taskId)
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
    await requireRunAccess(data.id)
    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.id))
    return run ? (await addRunRepositories([run as AgentRun]))[0] : null
  })

export const listQueuedAgentRuns = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => {
    requireRunnerAccess()
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
    requireRunnerAccess()
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
    requireRunnerAccess()
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
    requireRunnerAccess()
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
    requireRunnerAccess()
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
    const allRuns = await db.select().from(schema.agentRuns)
    const current = runs.filter(
      (run) =>
        mergeTrackedRun(allRuns.filter((row) => row.taskId === run.taskId))
          ?.id === run.id,
    )
    return addRunRepositories(current as AgentRun[])
  })

export const listAgentRuns = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => {
    const projectIds = await accessibleProjectIds()
    if (!projectIds.length) return []
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
      .where(inArray(schema.agentRuns.projectId, projectIds))
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
    requireRunnerAccess()
    const [existing] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, data.id))
    if (!existing) throw new Error('Agent run not found')
    if (
      existing.status === 'stopped' ||
      ((existing.status === 'error' ||
        existing.status === 'merged' ||
        existing.status === 'closed') &&
        data.status &&
        data.status !== existing.status)
    )
      return (await addRunRepositories([existing]))[0]
    const taskRuns = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, existing.taskId))
    const isCurrent =
      latestMeaningfulRun(taskRuns)?.id === existing.id ||
      (['merged', 'closed'].includes(data.status ?? '') &&
        mergeTrackedRun(taskRuns)?.id === existing.id)

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

    const lifecycleState =
      data.status === 'plan_ready'
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
    if (lifecycleState && isCurrent && existing.kind !== 'answer') {
      await db
        .update(schema.tasks)
        .set({
          lifecycleState,
          nextAction:
            lifecycleState === 'plan_ready'
              ? 'Review the agent plan'
              : lifecycleState === 'pr_open'
                ? 'Review the pull request'
                : null,
          updatedAt,
        })
        .where(eq(schema.tasks.id, existing.taskId))
    }
    const importantLogs = (data.appendLogs ?? []).filter(
      (entry) =>
        entry.level !== 'info' ||
        /pull request|plan|error|merged|proof/i.test(entry.message),
    )
    for (const entry of importantLogs) {
      const kind =
        entry.level === 'error'
          ? 'error'
          : /pull request/i.test(entry.message)
            ? 'pr'
            : 'progress'
      await appendTaskMessage(existing.taskId, kind, entry.message, {
        runId: existing.id,
      })
    }
    if (data.planMd && existing.kind === 'plan') {
      await db
        .insert(schema.planRevisions)
        .values({
          id: id(),
          agentRunId: existing.id,
          version: existing.planVersion,
          planMd: data.planMd,
          feedback: existing.planFeedback,
          createdAt: updatedAt,
        })
        .onConflictDoNothing()
      if (data.planMd !== existing.planMd)
        await appendTaskMessage(existing.taskId, 'plan', data.planMd, {
          runId: existing.id,
          version: existing.planVersion,
        })
    }

    // When a run's PR is merged, automatically complete the task.
    if (
      data.status === 'merged' &&
      existing.status !== 'merged' &&
      isCurrent &&
      existing.kind !== 'answer' &&
      (data.repositories
        ?.filter((repo) => repo.prUrl)
        .every((repo) => repo.status === 'merged') ??
        true)
    ) {
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
    await requireRunAccess(data.runId)
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
