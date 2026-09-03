import { mkdir, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { OpenHandsClient } from './openhands.js'
import { getPullRequestState } from './github.js'
import type { TerminalExecutionStatus } from './polling.js'
import {
  getTerminalExecutionStatus,
  hasExceededIdleLimit,
  shouldStopPolling,
} from './polling.js'
import {
  buildPrompt,
  buildAnswerPrompt,
  buildPlanPrompt,
  buildPlanRevisionPrompt,
} from './prompt.js'
import { createPlannerFetch } from './planner-client.js'
import { publishProofToPullRequest } from './handoff.js'
import { createResilientAppend } from './run-log.js'
import type { AppendFn, LogEntry } from './run-log.js'
import {
  readRepositoryHandoffs,
  uniqueRepoUrls,
} from './repository-workspaces.js'
import { aggregateRepositoryStatus } from './repository-status.js'
import type { RepositoryRunStatus } from './repository-status.js'

interface AgentRunRepository {
  repoUrl: string
  position: number
  status: RepositoryRunStatus
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  errorMessage: string | null
}

interface AgentRun {
  id: string
  taskId: string
  projectId: string
  status: string
  kind: 'answer' | 'implement' | 'plan'
  repoUrl: string | null
  branchName: string | null
  prUrl: string | null
  planMd: string | null
  planFeedback: string | null
  planVersion: number
  logs: string | null
  repositories?: AgentRunRepository[]
}

interface TaskContext {
  title: string
  notes: string | null
  projectName: string
  repoUrl: string
  repoUrls?: string[]
  priority: string
  approvedPlanMd: string | null
  attachments: { id: string; name: string; mimeType: string; path: string }[]
  messages?: {
    authorType: string
    kind: string
    body: string
    createdAt: number
  }[]
}

const POLL_INTERVAL_MS = 3000
const WORKSPACE_ROOT = process.env.RUNNER_WORKSPACE ?? '/tmp/agent-workspace'
const PLANNER_BASE_URL =
  process.env.PLANNER_BASE_URL ?? 'http://host.docker.internal:3000'
const OPENHANDS_BASE_URL =
  process.env.OPENHANDS_BASE_URL ?? 'http://openhands-agent-server:8000'
const LLM_MODEL = process.env.LLM_MODEL ?? 'openai/kimi-k2.6'
const LLM_API_KEY = process.env.LLM_API_KEY ?? ''
const LLM_API_BASE = process.env.LLM_API_BASE ?? 'https://opencode.ai/zen/go/v1'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? ''
const RUNNER_API_TOKEN = process.env.RUNNER_API_TOKEN ?? ''
const RUNNER_RUN_ID = process.env.RUNNER_RUN_ID?.trim() ?? ''
const RUNNER_JOB_ID = process.env.RUNNER_JOB_ID?.trim() ?? ''
const RUNNER_JOB_URL = process.env.RUNNER_JOB_URL?.trim() ?? ''
const RUNNER_MERGE_CHECK_ONLY = process.env.RUNNER_MERGE_CHECK_ONLY === '1'
const MAX_RUNTIME_MS = 15 * 60 * 1000 // 15 minutes
const MAX_IDLE_MS = 5 * 60 * 1000 // 5 minutes without an agent event
const MERGE_CHECK_INTERVAL_MS = 15_000
const plannerFetch = createPlannerFetch({
  baseUrl: PLANNER_BASE_URL,
  token: RUNNER_API_TOKEN,
})

async function main() {
  console.log('[runner] starting')
  console.log('[runner] planner:', PLANNER_BASE_URL)

  if (RUNNER_MERGE_CHECK_ONLY) {
    const expired = await plannerFetch<{ expired: number }>(
      '/api/runner/expire-stale',
      { method: 'POST', body: '{}' },
    )
    console.log(`[runner] expired stale runs: ${expired.expired}`)
    console.log('[runner] checking pull-request states once')
    await checkMerges()
    return
  }

  console.log('[runner] openhands:', OPENHANDS_BASE_URL)
  console.log('[runner] model:', LLM_MODEL)

  if (!LLM_API_KEY) {
    console.warn(
      '[runner] LLM_API_KEY is not set. OpenHands will fail to call the LLM.',
    )
  }

  const openhands = new OpenHandsClient({
    baseUrl: OPENHANDS_BASE_URL,
    llmModel: LLM_MODEL,
    llmApiKey: LLM_API_KEY,
    llmApiBase: LLM_API_BASE,
    timeoutMs: MAX_RUNTIME_MS,
  })

  // Wait for OpenHands Agent Server to be ready
  while (!(await openhands.checkAlive())) {
    console.log('[runner] waiting for OpenHands Agent Server...')
    await sleep(3000)
  }
  console.log('[runner] OpenHands Agent Server is alive')

  if (RUNNER_RUN_ID) {
    const run = await claimRun(RUNNER_RUN_ID)
    if (!run) {
      console.log(
        `[runner] run ${RUNNER_RUN_ID} was already claimed or is no longer queued`,
      )
      return
    }
    console.log(`[runner] claimed exact run ${run.id}`)
    await processRun(run, openhands)
    return
  }

  let lastMergeCheckAt = 0

  while (true) {
    try {
      if (Date.now() - lastMergeCheckAt >= MERGE_CHECK_INTERVAL_MS) {
        lastMergeCheckAt = Date.now()
        await checkMerges()
      }

      const runs = await plannerFetch<AgentRun[]>('/api/runner/queue')
      const queued = runs.filter((r) => r.status === 'queued')

      if (queued.length === 0) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      // Process one run at a time for simplicity
      const run = await claimRun(queued[0].id)
      if (run) await processRun(run, openhands)
    } catch (err) {
      console.error('[runner] poll error:', err)
      await sleep(POLL_INTERVAL_MS)
    }
  }
}

async function claimRun(runId: string): Promise<AgentRun | null> {
  const result = await plannerFetch<{
    claimed: boolean
    run: AgentRun | null
  }>('/api/runner/claim', {
    method: 'POST',
    body: JSON.stringify({
      runId,
      jobId: RUNNER_JOB_ID || undefined,
      jobUrl: RUNNER_JOB_URL || undefined,
    }),
  })
  return result.claimed ? result.run : null
}

function makeAppend(run: AgentRun, logs: LogEntry[]): AppendFn {
  return createResilientAppend({
    runId: run.id,
    logs,
    updateStatus: (entry) =>
      updateRun(run.id, { status: 'running', appendLogs: [entry] }),
  })
}

// Poll the planner for a user-initiated stop ('stopped' status set by the UI)
// and flip the provided flag. Returns an unwatch function.
function watchForUserStop(runId: string, onStop: () => void): () => void {
  const interval = setInterval(() => {
    plannerFetch<AgentRun>(`/api/runner/runs/${runId}`)
      .then((run) => {
        if (run?.status === 'stopped') onStop()
      })
      .catch(() => {
        // ignore transient planner errors
      })
  }, 5000)
  return () => clearInterval(interval)
}

async function driveConversation(
  openhands: OpenHandsClient,
  conversationId: string,
  append: AppendFn,
  startedAt: number,
  isTimedOut: () => boolean,
  extraShouldStop?: () => boolean,
  onMessage?: (text: string) => void,
): Promise<boolean> {
  const seenEventKeys = new Set<string>()
  let lastEventAt = Date.now()
  let idleTimedOut = false
  let terminalStatus: TerminalExecutionStatus | null = null

  await openhands.pollEvents(conversationId, {
    onEvent: (event) => {
      lastEventAt = Date.now()
      const text = eventMessage(event)
      if (text) {
        if (event.kind === 'MessageEvent') onMessage?.(text)
        const key = `${event.kind}:${event.id}:${text.slice(0, 80)}`
        if (!seenEventKeys.has(key)) {
          seenEventKeys.add(key)
          const level =
            event.kind === 'ConversationErrorEvent' ? 'error' : 'info'
          void append(text, level)
        }
      }
    },
    onPoll: async (newEventCount) => {
      if (newEventCount > 0) return
      try {
        const convo = await openhands.getConversation(conversationId)
        terminalStatus = getTerminalExecutionStatus(convo.execution_status)
      } catch {
        // ignore
      }
      idleTimedOut =
        terminalStatus === null &&
        hasExceededIdleLimit({
          lastEventAt,
          now: Date.now(),
          maxIdleMs: MAX_IDLE_MS,
        })
    },
    shouldStop: () => {
      if (extraShouldStop?.()) return true
      if (idleTimedOut) return true
      return shouldStopPolling({
        timedOut: isTimedOut(),
        startedAt,
        now: Date.now(),
        maxRuntimeMs: MAX_RUNTIME_MS,
        terminalStatus,
      })
    },
    intervalMs: 3000,
  })

  if (terminalStatus === 'error' || terminalStatus === 'stuck') {
    await append(`Agent session ended with status: ${terminalStatus}`, 'warn')
  }
  return idleTimedOut
}

async function postTaskMessage(taskId: string, body: string, kind: string) {
  await plannerFetch('/api/runner/task-message', {
    method: 'POST',
    body: JSON.stringify({ taskId, body, kind }),
  })
}

async function processAnswerRun(run: AgentRun, openhands: OpenHandsClient) {
  const logs: LogEntry[] = [
    {
      t: Date.now(),
      level: 'info',
      message: 'Agent runner picked up question.',
    },
  ]
  const append = makeAppend(run, logs)
  let answer = ''
  try {
    await updateRun(run.id, { status: 'running', logs })
    const task = await fetchTaskContext(run)
    const workspace = await prepareWorkspace(run.id)
    const conversation = await openhands.startConversation(
      buildAnswerPrompt(withAttachmentUrls(task)),
      workspace,
    )
    await openhands.runConversation(conversation.id)
    const idleTimedOut = await driveConversation(
      openhands,
      conversation.id,
      append,
      Date.now(),
      () => false,
      undefined,
      (text) => {
        answer = text
      },
    )
    if (idleTimedOut) throw new Error('Agent produced no events for 5 minutes')
    if (!answer) answer = 'The agent finished without an answer.'
    await postTaskMessage(run.taskId, answer, 'answer')
    await updateRun(run.id, { status: 'success' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await append(`Error: ${message}`, 'error')
    await updateRun(run.id, { status: 'error', errorMessage: message })
    await postTaskMessage(
      run.taskId,
      `The agent could not answer: ${message}`,
      'error',
    ).catch(() => undefined)
  }
}

async function prepareWorkspace(runId: string): Promise<string> {
  const workspace = join(WORKSPACE_ROOT, runId)
  if (existsSync(workspace)) {
    await rm(workspace, { recursive: true, force: true })
  }
  await mkdir(workspace, { recursive: true })
  return workspace
}

async function fetchTaskContext(run: AgentRun): Promise<TaskContext> {
  const task = await plannerFetch<TaskContext>(
    `/api/runner/task-context/${run.taskId}`,
  )
  if (!task) throw new Error('Task context not found')
  const snapshotUrls =
    run.repositories?.map((repository) => repository.repoUrl) ?? []
  if (snapshotUrls.length === 0) return task
  return { ...task, repoUrl: snapshotUrls[0], repoUrls: snapshotUrls }
}

async function appendRepositoryContext(task: TaskContext, append: AppendFn) {
  const repoUrls = uniqueRepoUrls(task.repoUrl, task.repoUrls)
  for (const repoUrl of repoUrls) {
    await append(`Writable repository: ${repoUrl}`)
  }
}

function withAttachmentUrls(task: TaskContext) {
  return {
    ...task,
    attachments: task.attachments.map((a) => ({
      ...a,
      url: `${PLANNER_BASE_URL}${a.path}`,
    })),
  }
}

async function finishWithError(
  run: AgentRun,
  logs: LogEntry[],
  fallback: string,
) {
  const lastError = logs.filter((l) => l.level === 'error').pop()
  const inferredError = inferErrorMessage(logs)
  if (lastError) {
    await updateRun(run.id, {
      status: 'error',
      errorMessage: lastError.message,
    })
    return
  }
  if (inferredError) {
    await updateRun(run.id, { status: 'error', errorMessage: inferredError })
    return
  }
  await updateRun(run.id, { status: 'error', errorMessage: fallback })
}

async function processPlanRun(run: AgentRun, openhands: OpenHandsClient) {
  const logs: LogEntry[] = [
    {
      t: Date.now(),
      level: 'info',
      message: 'Agent runner picked up task (plan mode).',
    },
  ]
  const append = makeAppend(run, logs)

  const startedAt = Date.now()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
  }, MAX_RUNTIME_MS)
  let userStopped = false
  const unwatchStop = watchForUserStop(run.id, () => {
    userStopped = true
  })

  try {
    await updateRun(run.id, { status: 'running', logs })

    const task = await fetchTaskContext(run)
    await append(`Task: ${task.title}`)
    await appendRepositoryContext(task, append)

    const workspace = await prepareWorkspace(run.id)
    const isRevision = !!(run.planMd && run.planFeedback)
    const prompt = isRevision
      ? buildPlanRevisionPrompt(
          withAttachmentUrls(task),
          run.planMd!,
          run.planFeedback!,
        )
      : buildPlanPrompt(withAttachmentUrls(task))

    await append(
      isRevision
        ? `Revising plan (v${run.planVersion}) based on reviewer feedback...`
        : 'Starting plan session (read-only)...',
    )

    const conversation = await openhands.startConversation(prompt, workspace)
    await append(`Conversation started: ${conversation.id}`)

    await openhands.runConversation(conversation.id)
    const idleTimedOut = await driveConversation(
      openhands,
      conversation.id,
      append,
      startedAt,
      () => timedOut,
      () => userStopped,
    )

    clearTimeout(timeout)
    unwatchStop()

    if (userStopped) {
      await append('Stopped by user.', 'warn')
      return
    }

    if (idleTimedOut) {
      await append('Stopped: no agent activity for 5 minutes.', 'warn')
      await updateRun(run.id, {
        status: 'error',
        errorMessage: 'Agent produced no events for 5 minutes',
      })
      return
    }

    if (timedOut) {
      await append('Stopped: reached 15 minute time limit.', 'warn')
      await updateRun(run.id, {
        status: 'error',
        errorMessage: 'Timeout: 15 minute limit reached',
      })
      return
    }

    const planMd = await extractPlan(workspace)
    if (planMd) {
      await append(`Plan v${run.planVersion} ready for review.`)
      await updateRun(run.id, { status: 'plan_ready', planMd })
      return
    }

    await append('Agent finished but no plan file was found.', 'warn')
    await finishWithError(run, logs, 'No plan file found after agent run')
  } catch (err) {
    clearTimeout(timeout)
    unwatchStop()
    const message = err instanceof Error ? err.message : String(err)
    await append(`Error: ${message}`, 'error')
    await updateRun(run.id, { status: 'error', errorMessage: message })
  }
}

async function processRun(run: AgentRun, openhands: OpenHandsClient) {
  if (run.kind === 'answer') return processAnswerRun(run, openhands)
  if (run.kind === 'plan') return processPlanRun(run, openhands)

  const logs: LogEntry[] = [
    { t: Date.now(), level: 'info', message: 'Agent runner picked up task.' },
  ]
  const append = makeAppend(run, logs)

  const startedAt = Date.now()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
  }, MAX_RUNTIME_MS)
  let userStopped = false
  const unwatchStop = watchForUserStop(run.id, () => {
    userStopped = true
  })

  try {
    await updateRun(run.id, { status: 'running', logs })

    const task = await fetchTaskContext(run)
    await append(`Task: ${task.title}`)
    await appendRepositoryContext(task, append)

    const workspace = await prepareWorkspace(run.id)
    const prompt = buildPrompt(withAttachmentUrls(task), { runId: run.id })
    await append('Starting OpenHands agent session...')

    const conversation = await openhands.startConversation(prompt, workspace)
    await append(`Conversation started: ${conversation.id}`)

    await openhands.runConversation(conversation.id)
    const idleTimedOut = await driveConversation(
      openhands,
      conversation.id,
      append,
      startedAt,
      () => timedOut,
      () => userStopped,
    )

    clearTimeout(timeout)
    unwatchStop()

    if (userStopped) {
      await append('Stopped by user.', 'warn')
      return
    }

    if (idleTimedOut) {
      await append(
        'No agent activity for 5 minutes. Checking every repository for a pushed branch or PR.',
        'warn',
      )
    }

    if (timedOut) {
      await append(
        'Reached the 15 minute limit. Checking every repository for a pushed branch or PR.',
        'warn',
      )
    }

    const repoUrls = uniqueRepoUrls(task.repoUrl, task.repoUrls)
    const repositoryHandoffs = await readRepositoryHandoffs(workspace, repoUrls)
    if (repositoryHandoffs.length === 1 && !repositoryHandoffs[0].prUrl) {
      repositoryHandoffs[0].prUrl = extractPrUrlFromLogs(logs)
    }
    const repositoryResults: RunRepositoryUpdate[] = []

    for (const repository of repositoryHandoffs) {
      if (!repository.prUrl && !repository.branchName) {
        repositoryResults.push({
          repoUrl: repository.repoUrl,
          position: repository.position,
          status: 'skipped',
        })
        continue
      }

      try {
        const handoff = await publishProofToPullRequest({
          repoUrl: repository.repoUrl,
          prUrl: repository.prUrl,
          branchName: repository.branchName,
          workspace,
          repoDir: repository.repoDir,
          runId: run.id,
          taskTitle: task.title,
          token: GITHUB_TOKEN,
        })

        if (handoff.createdFallback) {
          await append(
            `Runner created a ready fallback PR for ${repository.repoUrl}: ${handoff.prUrl}`,
            'warn',
          )
        }
        await append(
          `Verification proof for ${repository.repoUrl}: ${handoff.proof.state.toUpperCase()} (${handoff.proof.errors.length} validation problem${handoff.proof.errors.length === 1 ? '' : 's'}).`,
          handoff.proof.state === 'pass' ? 'info' : 'warn',
        )

        repositoryResults.push({
          repoUrl: repository.repoUrl,
          position: repository.position,
          status: handoff.prUrl ? 'success' : 'error',
          prUrl: handoff.prUrl,
          branchName: handoff.branchName,
          prNumber: handoff.prNumber,
          errorMessage:
            handoff.proof.state === 'incomplete'
              ? handoff.proof.errors.join(' ')
              : null,
        })
        if (handoff.prUrl) {
          await append(
            `Pull request created for ${repository.repoUrl}: ${handoff.prUrl}`,
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await append(
          `Proof publishing failed for ${repository.repoUrl}: ${message}`,
          'error',
        )
        repositoryResults.push({
          repoUrl: repository.repoUrl,
          position: repository.position,
          status: repository.prUrl ? 'success' : 'error',
          prUrl: repository.prUrl,
          branchName: repository.branchName,
          errorMessage: `Proof publishing failed: ${message}`,
        })
      }
    }

    const pullRequests = repositoryResults.filter(
      (repository) => repository.status === 'success' && repository.prUrl,
    )
    if (pullRequests.length > 0) {
      const primaryResult = pullRequests[0]
      const proofErrors = repositoryResults
        .map((repository) => repository.errorMessage)
        .filter((message): message is string => !!message)
      await updateRun(run.id, {
        status: 'success',
        prUrl: primaryResult.prUrl ?? undefined,
        branchName: primaryResult.branchName,
        prNumber: primaryResult.prNumber ?? undefined,
        repositories: repositoryResults,
        errorMessage:
          proofErrors.length > 0 ? proofErrors.join(' ') : undefined,
      })
      return
    }

    await append('Agent finished without a usable PR or pushed branch.', 'warn')
    await updateRun(run.id, {
      status: 'error',
      repositories: repositoryResults,
      errorMessage: timedOut
        ? 'Timeout: no pull request or pushed branch was available after 15 minutes'
        : 'No PR URL or pushed branch found after agent run',
    })
  } catch (err) {
    clearTimeout(timeout)
    unwatchStop()
    const message = err instanceof Error ? err.message : String(err)
    await append(`Error: ${message}`, 'error')
    await updateRun(run.id, { status: 'error', errorMessage: message })
  }
}

// Poll GitHub for PRs of successful runs: flip to 'merged' (planner then
// auto-completes the task) or 'closed' when the PR is closed without merging.
async function checkMerges() {
  if (!GITHUB_TOKEN) return
  try {
    const runs = await plannerFetch<AgentRun[]>('/api/runner/awaiting-merge')
    for (const run of runs) {
      if (
        run.repositories &&
        run.repositories.some((repository) => repository.prUrl)
      ) {
        const repositories: RunRepositoryUpdate[] = run.repositories.map(
          (repository) => ({
            repoUrl: repository.repoUrl,
            position: repository.position,
            status: repository.status,
            branchName: repository.branchName,
            prUrl: repository.prUrl,
            prNumber: repository.prNumber,
            errorMessage: repository.errorMessage,
          }),
        )
        const appendLogs: LogEntry[] = []

        for (const repository of repositories) {
          if (repository.status !== 'success' || !repository.prUrl) continue
          try {
            const pr = await getPullRequestState(repository.prUrl, GITHUB_TOKEN)
            if (!pr) continue
            if (pr.merged) {
              repository.status = 'merged'
              appendLogs.push({
                t: Date.now(),
                level: 'info',
                message: `PR merged for ${repository.repoUrl}: ${repository.prUrl}`,
              })
            } else if (pr.state === 'closed') {
              repository.status = 'closed'
              appendLogs.push({
                t: Date.now(),
                level: 'warn',
                message: `PR closed without merging for ${repository.repoUrl}: ${repository.prUrl}`,
              })
            }
          } catch (err) {
            console.warn(
              `[merge-watch] failed to check ${repository.repoUrl} for run ${run.id}:`,
              err instanceof Error ? err.message : err,
            )
          }
        }

        if (appendLogs.length === 0) continue
        const status = aggregateRepositoryStatus(
          repositories.map((repository) => repository.status),
        )
        if (status === 'merged') {
          appendLogs.push({
            t: Date.now(),
            level: 'info',
            message: 'All repository PRs merged — task marked done.',
          })
        }
        await updateRun(run.id, { status, repositories, appendLogs })
        console.log(`[merge-watch] run ${run.id}: ${status}`)
        continue
      }

      if (!run.prUrl) continue
      try {
        const pr = await getPullRequestState(run.prUrl, GITHUB_TOKEN)
        if (!pr) continue
        if (pr.merged) {
          await updateRun(run.id, {
            status: 'merged',
            appendLogs: [
              {
                t: Date.now(),
                level: 'info',
                message: 'PR merged — task marked done.',
              },
            ],
          })
          console.log(`[merge-watch] run ${run.id}: PR merged`)
        } else if (pr.state === 'closed') {
          await updateRun(run.id, {
            status: 'closed',
            appendLogs: [
              {
                t: Date.now(),
                level: 'warn',
                message: 'PR was closed without merging.',
              },
            ],
          })
          console.log(`[merge-watch] run ${run.id}: PR closed without merging`)
        }
      } catch (err) {
        console.warn(
          `[merge-watch] failed to check run ${run.id}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
  } catch (err) {
    console.warn(
      '[merge-watch] poll error:',
      err instanceof Error ? err.message : err,
    )
  }
}

interface RunRepositoryUpdate {
  repoUrl: string
  position: number
  status: RepositoryRunStatus
  branchName?: string | null
  prUrl?: string | null
  prNumber?: number | null
  errorMessage?: string | null
}

async function updateRun(
  id: string,
  patch: {
    status?: string
    logs?: LogEntry[]
    appendLogs?: LogEntry[]
    errorMessage?: string
    prUrl?: string
    branchName?: string | null
    prNumber?: number
    planMd?: string
    repositories?: RunRepositoryUpdate[]
  },
) {
  await plannerFetch(`/api/runner/update-run`, {
    method: 'POST',
    body: JSON.stringify({ id, ...patch }),
  })
}

function eventMessage(event: {
  kind: string
  message?: string
  content?: string
  code?: string
  detail?: string
  summary?: string
  action?: { command?: string; path?: string; summary?: string; kind?: string }
  observation?: {
    command?: string
    content?: Array<{ type?: string; text?: string }> | string
    exit_code?: number
    metadata?: { exit_code?: number }
    extra_content?: string
  }
  llm_message?: {
    role?: string
    content?: Array<{ type?: string; text?: string }> | string
  }
}): string | null {
  if (event.kind === 'MessageEvent') {
    const text = event.message ?? extractText(event.llm_message?.content)
    if (text) return text.slice(0, 400)
  }
  if (event.kind === 'ActionEvent') {
    const summary = event.summary ?? event.action?.summary ?? event.action?.kind
    const command = event.action?.command ?? event.action?.path
    const text = summary
      ? command
        ? `${summary}: ${command.slice(0, 120)}`
        : summary
      : command
        ? `Action: ${command.slice(0, 200)}`
        : event.message
          ? `Action: ${event.message.slice(0, 200)}`
          : null
    return text
  }
  if (event.kind === 'ObservationEvent') {
    const command = event.observation?.command
    const exitCode =
      event.observation?.exit_code ?? event.observation?.metadata?.exit_code
    const output =
      extractText(event.observation?.content) ??
      event.observation?.extra_content
    let text = 'Observation'
    if (command) text += `: ${command.slice(0, 120)}`
    if (typeof exitCode === 'number') text += ` (exit ${exitCode})`
    if (output) {
      const out = output.trim().slice(0, 300)
      if (out) text += ` -> ${out}`
    }
    return text === 'Observation' ? null : text
  }
  if (event.kind === 'ConversationErrorEvent') {
    const text = [event.code, event.message, event.detail]
      .filter(Boolean)
      .join(' - ')
    return text ? `Error: ${text.slice(0, 400)}` : null
  }
  return null
}

function extractText(
  content: Array<{ type?: string; text?: string }> | string | undefined,
): string | null {
  if (!content) return null
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (
      content
        .map((c) => c.text ?? '')
        .filter(Boolean)
        .join('\n') || null
    )
  }
  return null
}

async function extractPlan(workspace: string): Promise<string | null> {
  for (const dir of [workspace, join(workspace, 'repo')]) {
    try {
      const marker = join(dir, '.agent-plan-md')
      if (existsSync(marker)) {
        const content = (await readFile(marker, 'utf-8')).trim()
        if (content.length > 0) return content
      }
    } catch {
      // ignore
    }
  }
  return null
}

const ERROR_PATTERNS = [
  {
    pattern: /remote:\s*Repository not found/i,
    message: 'Repository not found or bot account lacks access.',
  },
  {
    pattern: /fatal:\s*repository.*not found/i,
    message: 'Repository not found or bot account lacks access.',
  },
  {
    pattern: /fatal:\s*Could not resolve host/i,
    message:
      'Could not resolve repository host. Check the repo URL and network.',
  },
  {
    pattern: /fatal:\s*Authentication failed/i,
    message: 'Git authentication failed. Check GITHUB_TOKEN permissions.',
  },
  {
    pattern: /HTTP 403/i,
    message: 'Received HTTP 403 from GitHub. Check GITHUB_TOKEN permissions.',
  },
  {
    pattern: /HTTP 404/i,
    message: 'Received HTTP 404 from GitHub. Repository may not exist.',
  },
  {
    pattern: /gh:\s*Not logged into/i,
    message: 'GitHub CLI (gh) is not authenticated. Check GITHUB_TOKEN.',
  },
  {
    pattern: /LLMBadRequestError/i,
    message:
      'LLM request failed. Check LLM_MODEL / LLM_API_BASE / LLM_API_KEY.',
  },
  {
    pattern: /LLM.*Error/i,
    message:
      'LLM request failed. Check LLM_MODEL / LLM_API_BASE / LLM_API_KEY.',
  },
]

function inferErrorMessage(logs: LogEntry[]): string | null {
  for (const entry of logs) {
    for (const { pattern, message } of ERROR_PATTERNS) {
      if (pattern.test(entry.message)) return message
    }
  }
  return null
}

function extractPrUrlFromLogs(logs: LogEntry[]): string | null {
  // Match GitHub pull request URLs in log messages, preferring the last one.
  const prUrlRegex = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/g
  for (let i = logs.length - 1; i >= 0; i--) {
    const matches = logs[i].message.match(prUrlRegex)
    if (matches && matches.length > 0) return matches[matches.length - 1]
  }
  return null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('[runner] fatal:', err)
  process.exit(1)
})
