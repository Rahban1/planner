import { mkdir, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { OpenHandsClient } from './openhands.js'
import { buildPrompt } from './prompt.js'

interface LogEntry {
  t: number
  level: 'info' | 'warn' | 'error'
  message: string
}

interface AgentRun {
  id: string
  taskId: string
  projectId: string
  status: string
  repoUrl: string | null
  branchName: string | null
  prUrl: string | null
  logs: string | null
}

interface TaskContext {
  title: string
  notes: string | null
  projectName: string
  repoUrl: string
  priority: string
  attachments: { id: string; name: string; mimeType: string; path: string }[]
}

const POLL_INTERVAL_MS = 3000
const WORKSPACE_ROOT = process.env.RUNNER_WORKSPACE ?? '/tmp/agent-workspace'
const PLANNER_BASE_URL = process.env.PLANNER_BASE_URL ?? 'http://host.docker.internal:3000'
const OPENHANDS_BASE_URL = process.env.OPENHANDS_BASE_URL ?? 'http://openhands-agent-server:8000'
const LLM_MODEL = process.env.LLM_MODEL ?? 'openai/kimi-k2.7-code'
const LLM_API_KEY = process.env.LLM_API_KEY ?? ''
const LLM_API_BASE = process.env.LLM_API_BASE ?? 'https://opencode.ai/zen/go/v1'
const MAX_RUNTIME_MS = 15 * 60 * 1000 // 15 minutes

async function main() {
  console.log('[runner] starting')
  console.log('[runner] planner:', PLANNER_BASE_URL)
  console.log('[runner] openhands:', OPENHANDS_BASE_URL)
  console.log('[runner] model:', LLM_MODEL)

  if (!LLM_API_KEY) {
    console.warn('[runner] LLM_API_KEY is not set. OpenHands will fail to call the LLM.')
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

  while (true) {
    try {
      const runs = await plannerFetch<AgentRun[]>('/api/runner/queue')
      const queued = runs.filter((r) => r.status === 'queued')

      if (queued.length === 0) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }

      // Process one run at a time for simplicity
      const run = queued[0]
      await processRun(run, openhands)
    } catch (err) {
      console.error('[runner] poll error:', err)
      await sleep(POLL_INTERVAL_MS)
    }
  }
}

async function processRun(run: AgentRun, openhands: OpenHandsClient) {
  const logs: LogEntry[] = [
    { t: Date.now(), level: 'info', message: 'Agent runner picked up task.' },
  ]

  async function append(message: string, level: LogEntry['level'] = 'info') {
    const entry: LogEntry = { t: Date.now(), level, message }
    logs.push(entry)
    console.log(`[run:${run.id}] ${level}: ${message}`)
    await updateRun(run.id, { status: 'running', appendLogs: [entry] })
  }

  const startedAt = Date.now()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
  }, MAX_RUNTIME_MS)

  try {
    await updateRun(run.id, { status: 'running', logs })

    const task = await plannerFetch<TaskContext>(`/api/runner/task-context/${run.taskId}`)
    if (!task) throw new Error('Task context not found')

    await append(`Task: ${task.title}`)
    await append(`Repository: ${task.repoUrl}`)

    const workspace = join(WORKSPACE_ROOT, run.id)
    if (existsSync(workspace)) {
      await rm(workspace, { recursive: true, force: true })
    }
    await mkdir(workspace, { recursive: true })

    const prompt = buildPrompt({
      ...task,
      attachments: task.attachments.map((a) => ({
        ...a,
        url: `${PLANNER_BASE_URL}${a.path}`,
      })),
    })
    await append('Starting OpenHands agent session...')

    const conversation = await openhands.startConversation(prompt, workspace)
    await append(`Conversation started: ${conversation.id}`)

    await openhands.runConversation(conversation.id)

    const seenEventKeys = new Set<string>()
    let idleCount = 0
    let terminalStatus: string | null = null

    await openhands.pollEvents(conversation.id, {
      onEvent: (event) => {
        const text = eventMessage(event)
        if (text) {
          const key = `${event.kind}:${event.id}:${text.slice(0, 80)}`
          if (!seenEventKeys.has(key)) {
            seenEventKeys.add(key)
            const level = event.kind === 'ConversationErrorEvent' ? 'error' : 'info'
            void append(text, level)
          }
        }
      },
      onPoll: async (newEventCount) => {
        if (newEventCount > 0) {
          idleCount = 0
          return
        }
        idleCount += 1
        // Periodically check execution status so we stop promptly when done
        if (idleCount % 2 === 0) {
          try {
            const convo = await openhands.getConversation(conversation.id)
            const status = convo.execution_status
            if (['finished', 'error', 'stuck'].includes(status)) {
              terminalStatus = status
              idleCount = 999
            }
          } catch {
            // ignore
          }
        }
      },
      shouldStop: () => {
        if (timedOut) return true
        if (Date.now() - startedAt > MAX_RUNTIME_MS) return true
        // Stop once terminal status is reached and event stream is stable
        return idleCount >= 3
      },
      intervalMs: 3000,
    })

    if (terminalStatus === 'error' || terminalStatus === 'stuck') {
      await append(`Agent session ended with status: ${terminalStatus}`, 'warn')
    }

    clearTimeout(timeout)

    if (timedOut) {
      await append('Stopped: reached 15 minute time limit.', 'warn')
      await updateRun(run.id, { status: 'error', errorMessage: 'Timeout: 15 minute limit reached' })
      return
    }

    // Try to extract PR URL from marker files the agent was instructed to create,
    // or fall back to scanning the logs for a GitHub PR URL.
    let prUrl = await extractPrUrl(workspace)
    if (!prUrl) prUrl = extractPrUrlFromLogs(logs)
    const branchName = prUrl ? await extractBranchName(workspace) : null

    if (prUrl) {
      await append(`Pull request created: ${prUrl}`, 'info')
      await updateRun(run.id, { status: 'success', prUrl, branchName })
      return
    }

    // No PR URL. Surface the most useful failure reason from logs.
    const lastError = logs.filter((l) => l.level === 'error').pop()
    const inferredError = inferErrorMessage(logs)
    if (lastError) {
      await updateRun(run.id, { status: 'error', errorMessage: lastError.message })
      return
    }
    if (inferredError) {
      await updateRun(run.id, { status: 'error', errorMessage: inferredError })
      return
    }

    await append('Agent finished but no PR URL was found.', 'warn')
    await updateRun(run.id, { status: 'error', errorMessage: 'No PR URL found after agent run' })
  } catch (err) {
    clearTimeout(timeout)
    const message = err instanceof Error ? err.message : String(err)
    await append(`Error: ${message}`, 'error')
    await updateRun(run.id, { status: 'error', errorMessage: message })
  }
}

async function plannerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PLANNER_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Planner request failed: ${res.status} ${text}`)
  }
  return (await res.json()) as T
}

async function updateRun(
  id: string,
  patch: { status?: string; logs?: LogEntry[]; appendLogs?: LogEntry[]; errorMessage?: string; prUrl?: string; branchName?: string | null },
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
    const output = extractText(event.observation?.content) ?? event.observation?.extra_content
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
    const text = [event.code, event.message, event.detail].filter(Boolean).join(' - ')
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
    return content.map((c) => c.text ?? '').filter(Boolean).join('\n') || null
  }
  return null
}

async function extractPrUrl(workspace: string): Promise<string | null> {
  for (const dir of [workspace, join(workspace, 'repo')]) {
    try {
      const marker = join(dir, '.agent-pr-url')
      if (existsSync(marker)) {
        const url = (await readFile(marker, 'utf-8')).trim()
        if (url.startsWith('http')) return url
      }
    } catch {
      // ignore
    }
  }
  return null
}

async function extractBranchName(workspace: string): Promise<string | null> {
  for (const dir of [workspace, join(workspace, 'repo')]) {
    try {
      const marker = join(dir, '.agent-branch-name')
      if (existsSync(marker)) {
        return (await readFile(marker, 'utf-8')).trim() || null
      }
    } catch {
      // ignore
    }
  }
  return null
}

const ERROR_PATTERNS = [
  { pattern: /remote:\s*Repository not found/i, message: 'Repository not found or bot account lacks access.' },
  { pattern: /fatal:\s*repository.*not found/i, message: 'Repository not found or bot account lacks access.' },
  { pattern: /fatal:\s*Could not resolve host/i, message: 'Could not resolve repository host. Check the repo URL and network.' },
  { pattern: /fatal:\s*Authentication failed/i, message: 'Git authentication failed. Check GITHUB_TOKEN permissions.' },
  { pattern: /HTTP 403/i, message: 'Received HTTP 403 from GitHub. Check GITHUB_TOKEN permissions.' },
  { pattern: /HTTP 404/i, message: 'Received HTTP 404 from GitHub. Repository may not exist.' },
  { pattern: /gh:\s*Not logged into/i, message: 'GitHub CLI (gh) is not authenticated. Check GITHUB_TOKEN.' },
  { pattern: /LLMBadRequestError/i, message: 'LLM request failed. Check LLM_MODEL / LLM_API_BASE / LLM_API_KEY.' },
  { pattern: /LLM.*Error/i, message: 'LLM request failed. Check LLM_MODEL / LLM_API_BASE / LLM_API_KEY.' },
]

function inferErrorMessage(logs: LogEntry[]): string | null {
  for (const entry of logs) {
    for (const { pattern, message } of ERROR_PATTERNS) {
      if (pattern.test(entry.message)) return message
    }
  }
  return null
}

function extractPrUrlFromLogs(
  logs: LogEntry[],
): string | null {
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
