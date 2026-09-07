import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db, runtimeEnv as env, schema } from '#/db/index'
import type {
  AgentRun,
  AgentRunRepository,
  AgentRunWithRepositories,
} from '#/db/schema'
import { requireTaskAccess } from './access.server'
import { dispatchGitHubActionsRun } from './github-actions-client'
import {
  approveQueuedPlanSql,
  approveRunGuardSql,
  queueRunInsertSql,
  triggerActionGuardSql,
  implementationSourceGuardSql,
} from '#/lib/workflow-queue'

export async function withRunRepositories<T extends { id: string }>(
  runs: T[],
): Promise<Array<T & { repositories: AgentRunRepository[] }>> {
  if (runs.length === 0) return []
  const ids = new Set(runs.map((run) => run.id))
  const rows = await db
    .select()
    .from(schema.agentRunRepositories)
    .where(inArray(schema.agentRunRepositories.agentRunId, [...ids]))
    .orderBy(asc(schema.agentRunRepositories.position))
  return runs.map((run) => ({
    ...run,
    repositories: rows.filter(
      (row) => row.agentRunId === run.id && ids.has(row.agentRunId),
    ),
  }))
}

export async function dispatchQueuedRun(runId: string) {
  if (!env.GITHUB_ACTIONS_DISPATCH_TOKEN) return null
  const [run] = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, runId))
  if (!run || run.status !== 'queued') return null
  const t = Date.now()
  try {
    const result = await dispatchGitHubActionsRun(
      {
        owner: env.GITHUB_ACTIONS_OWNER,
        repository: env.GITHUB_ACTIONS_REPOSITORY,
        workflow: env.GITHUB_ACTIONS_WORKFLOW,
        ref: env.GITHUB_ACTIONS_REF,
        token: env.GITHUB_ACTIONS_DISPATCH_TOKEN,
      },
      runId,
    )
    await db
      .update(schema.agentRuns)
      .set({
        runnerBackend: 'github_actions',
        runnerJobId: result.jobId,
        runnerJobUrl: result.jobUrl,
        dispatchAttempts: run.dispatchAttempts + 1,
        dispatchedAt: t,
        updatedAt: t,
      })
      .where(
        and(
          eq(schema.agentRuns.id, runId),
          eq(schema.agentRuns.status, 'queued'),
        ),
      )
    return null
  } catch {
    const message = 'Could not start the agent runner. Retry this run.'
    await db
      .update(schema.agentRuns)
      .set({
        status: 'error',
        errorMessage: message,
        runnerBackend: 'github_actions',
        dispatchAttempts: run.dispatchAttempts + 1,
        updatedAt: t,
      })
      .where(
        and(
          eq(schema.agentRuns.id, runId),
          eq(schema.agentRuns.status, 'queued'),
        ),
      )
    await db
      .update(schema.tasks)
      .set({ lifecycleState: 'failed', nextAction: message, updatedAt: t })
      .where(eq(schema.tasks.id, run.taskId))
    return message
  }
}

export type QueueRunOptions = {
  triggerMessageId?: string | null
  sourceRunId?: string | null
  approvedByUserId?: string | null
  approveVersion?: number
  retry?: boolean
  planSnapshot?: {
    planMd: string | null
    feedback: string | null
    version: number
  }
}

export async function queueWorkflowRun(
  taskId: string,
  kind: AgentRun['kind'],
  options: QueueRunOptions = {},
): Promise<AgentRunWithRepositories & { dispatchError: string | null }> {
  const task = await requireTaskAccess(taskId)
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, task.projectId))
  const projectRepos = await db
    .select()
    .from(schema.projectRepositories)
    .where(eq(schema.projectRepositories.projectId, task.projectId))
    .orderBy(asc(schema.projectRepositories.position))
  let repositories: Array<{
    repoUrl: string
    branchName?: string | null
    prUrl?: string | null
    prNumber?: number | null
  }> = projectRepos.length
    ? projectRepos.map((row) => ({ repoUrl: row.url }))
    : project.repoUrl
      ? [{ repoUrl: project.repoUrl }]
      : []
  if (!repositories.length && kind !== 'answer')
    throw new Error('Add a repository to this project first')
  if (!options.triggerMessageId) {
    const [message] = await db
      .select()
      .from(schema.taskMessages)
      .where(
        and(
          eq(schema.taskMessages.taskId, taskId),
          eq(schema.taskMessages.authorType, 'user'),
        ),
      )
      .orderBy(
        desc(schema.taskMessages.createdAt),
        desc(schema.taskMessages.id),
      )
      .limit(1)
    options = { ...options, triggerMessageId: message?.id }
  }
  if (options.sourceRunId) {
    const [source] = await db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.id, options.sourceRunId),
          eq(schema.agentRuns.taskId, taskId),
        ),
      )
    if (!source) throw new Error('Source run does not belong to this task')
    if (kind === 'revise' || kind === 'answer') {
      const [sourceWithRepos] = await withRunRepositories([source])
      repositories = sourceWithRepos.repositories.filter(
        (row) => row.prUrl && row.branchName && row.prNumber,
      )
      if (
        !repositories.length &&
        source.prUrl &&
        source.branchName &&
        source.prNumber &&
        source.repoUrl
      )
        repositories = [
          {
            repoUrl: source.repoUrl,
            branchName: source.branchName,
            prUrl: source.prUrl,
            prNumber: source.prNumber,
          },
        ]
      if (!repositories.length)
        throw new Error('This task has no pull request to review')
    }
  }
  if (options.triggerMessageId) {
    const [message] = await db
      .select()
      .from(schema.taskMessages)
      .where(
        and(
          eq(schema.taskMessages.id, options.triggerMessageId),
          eq(schema.taskMessages.taskId, taskId),
        ),
      )
    if (!message) throw new Error('Message does not belong to this task')
  }
  const prior = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.taskId, taskId))
    .orderBy(desc(schema.agentRuns.createdAt))
  const sameAction = prior.find((run) =>
    kind === 'implement' && options.sourceRunId
      ? run.sourceRunId === options.sourceRunId && run.kind === kind
      : options.triggerMessageId
        ? run.triggerMessageId === options.triggerMessageId && run.kind === kind
        : false,
  )
  if (sameAction && !options.retry)
    return {
      ...(await withRunRepositories([sameAction]))[0],
      dispatchError: sameAction.errorMessage,
    }
  if (prior.some((run) => run.status === 'queued' || run.status === 'running'))
    throw new Error('Wait for the current agent run to finish')
  const runId = crypto.randomUUID()
  const t = Date.now()
  const first = repositories[0]
  const statusMessage =
    kind === 'plan'
      ? 'Plan queued. The agent will read the repositories.'
      : kind === 'answer'
        ? 'Question queued. The agent will explain the code.'
        : kind === 'revise'
          ? 'Code changes queued for the current pull request.'
          : 'Plan approved. Implementation queued.'
  const values: unknown[] = [
    runId,
    taskId,
    task.projectId,
    kind,
    first?.repoUrl ?? null,
    kind === 'revise' ? (first?.branchName ?? null) : null,
    kind === 'revise' ? (first?.prUrl ?? null) : null,
    kind === 'revise' ? (first?.prNumber ?? null) : null,
    options.triggerMessageId ?? null,
    options.sourceRunId ?? null,
    options.approvedByUserId ?? null,
    JSON.stringify([{ t, level: 'info', message: statusMessage }]),
    t,
    t,
    taskId,
  ]
  let guard = ''
  if (options.approveVersion !== undefined) {
    guard = approveRunGuardSql
    values.push(options.sourceRunId, taskId, options.approveVersion)
  }
  if (!options.retry && kind === 'implement' && options.sourceRunId) {
    guard += implementationSourceGuardSql
    values.push(taskId, options.sourceRunId)
  } else if (!options.retry && options.triggerMessageId) {
    guard += triggerActionGuardSql
    values.push(taskId, kind, options.triggerMessageId)
  }
  // D1 executes the complete batch in one transaction. The INSERT predicate is
  // the task lock, so two requests cannot queue different jobs for one task.
  const statements = [env.DB.prepare(queueRunInsertSql + guard).bind(...values)]
  if (options.planSnapshot)
    statements.push(
      env.DB.prepare(
        'UPDATE agent_runs SET plan_md=?,plan_feedback=?,plan_version=? WHERE id=?',
      ).bind(
        options.planSnapshot.planMd,
        options.planSnapshot.feedback,
        options.planSnapshot.version,
        runId,
      ),
    )
  for (const [position, repo] of repositories.entries())
    statements.push(
      env.DB.prepare(
        "INSERT INTO agent_run_repositories (id,agent_run_id,repo_url,position,status,branch_name,pr_url,pr_number,created_at,updated_at) SELECT ?,?,?,?,'pending',?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_runs WHERE id=?)",
      ).bind(
        crypto.randomUUID(),
        runId,
        repo.repoUrl,
        position,
        repo.branchName ?? null,
        repo.prUrl ?? null,
        repo.prNumber ?? null,
        t,
        t,
        runId,
      ),
    )
  if (options.approveVersion !== undefined)
    statements.push(
      env.DB.prepare(approveQueuedPlanSql).bind(
        options.approvedByUserId ?? null,
        t,
        options.sourceRunId,
        runId,
      ),
    )
  if (kind !== 'answer')
    statements.push(
      env.DB.prepare(
        'UPDATE tasks SET lifecycle_state=?,next_action=?,updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM agent_runs WHERE id=?)',
      ).bind(
        kind === 'plan' ? 'planning' : 'running',
        statusMessage,
        t,
        taskId,
        runId,
      ),
    )
  const result = await env.DB.batch(statements)
  if (!result[0].meta.changes) {
    const [duplicate] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.taskId, taskId))
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(1)
    if (
      duplicate &&
      duplicate.kind === kind &&
      ((options.triggerMessageId &&
        duplicate.triggerMessageId === options.triggerMessageId) ||
        (options.sourceRunId && duplicate.sourceRunId === options.sourceRunId))
    )
      return {
        ...(await withRunRepositories([duplicate]))[0],
        dispatchError: duplicate.errorMessage,
      }
    throw new Error(
      options.approveVersion !== undefined
        ? 'The plan changed or another run started. Reload the task.'
        : 'Another agent run has started. Reload the task.',
    )
  }
  const dispatchError = await dispatchQueuedRun(runId)
  const [run] = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, runId))
  return { ...(await withRunRepositories([run]))[0], dispatchError }
}
