import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Flag,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  Loader2,
  MessageSquare,
  RefreshCw,
  Square,
  Terminal,
  X,
} from 'lucide-react'
import { useAgentRunForTask, useGiveTaskToAgentMutation, useStopAgentRunMutation, useTask } from '#/lib/queries'
import { useUI } from '#/lib/ui-context'

type LogEntry = {
  t: number
  level: 'info' | 'warn' | 'error'
  message: string
}

const STATUS_META: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  queued: { label: 'Queued', className: 'queued', icon: <Clock size={12} /> },
  running: { label: 'Running', className: 'running', icon: <Loader2 size={12} className="spin" /> },
  success: { label: 'PR Ready', className: 'success', icon: <CheckCircle2 size={12} /> },
  merged: { label: 'Merged', className: 'merged', icon: <GitMerge size={12} /> },
  closed: { label: 'PR Closed', className: 'closed', icon: <GitPullRequestClosed size={12} /> },
  stopped: { label: 'Stopped', className: 'stopped', icon: <Square size={12} /> },
  error: { label: 'Error', className: 'error', icon: <AlertCircle size={12} /> },
  plan_ready: { label: 'Plan Ready', className: 'plan', icon: <CheckCircle2 size={12} /> },
  approved: { label: 'Approved', className: 'merged', icon: <CheckCircle2 size={12} /> },
}

// ----- log parsing -----

type EntryKind = 'milestone' | 'action' | 'observation' | 'prompt' | 'message' | 'error'

interface FeedEntry {
  key: number
  t: number
  kind: EntryKind
  summary: string
  command: string | null
  detail: string | null
  exitCode: number | null
}

/** Strip ANSI escape sequences and terminal control junk. */
function cleanText(input: string): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') // ANSI CSI sequences
    .replace(/\[\??\d{3,4}[a-zA-Z]/g, '') // bracketed-paste leftovers like [?2004l
}

/** Remove git progress-rewrite spam ("[K remote: Counting objects: 37% ..."). */
function cleanDetail(input: string): string {
  return cleanText(input)
    .split('[K')
    .map((chunk) => chunk.replace(/^\]\s*/, '').trim())
    .filter(
      (chunk) =>
        chunk.length > 0 &&
        !/(Counting|Compressing|Receiving|Resolving|Enumerating) objects:\s*\d+%/.test(chunk) &&
        !/^\d+%\s*\(\d+\/\d+\)/.test(chunk),
    )
    .join(' · ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const MILESTONE_PREFIXES = [
  'Run queued',
  'Agent runner picked up task',
  'Task:',
  'Repository:',
  'Starting OpenHands',
  'Conversation started',
  'Pull request created',
  'PR merged',
  'PR was closed',
  'Agent session ended',
  'Agent finished',
  'Stopped:',
]

const COMMAND_STARTERS = /^(git|gh|npm|pnpm|npx|yarn|bun|node|python|pip|cd|cat|ls|grep|rg|curl|wget|view|sed|echo|mkdir|rm|cp|mv|touch|chmod|docker|bash|sh|make|tsc|eslint|tar|unzip|find|diff|patch|open|apt|brew|\$|\.|\/|~)/

function parseEntry(log: LogEntry, index: number): FeedEntry {
  const text = cleanText(log.message).trim()
  const base = { key: index, t: log.t, command: null, detail: null, exitCode: null }

  if (log.level === 'error') {
    return { ...base, kind: 'error', summary: text }
  }

  if (text.startsWith('Observation:')) {
    const rest = text.slice('Observation:'.length).trim()
    const exitMatch = rest.match(/\(exit\s+(-?\d+)\)/)
    const exitCode = exitMatch ? Number(exitMatch[1]) : null
    const withoutExit = rest.replace(/\s*\(exit\s+-?\d+\)\s*/, ' ')
    const arrowIdx = withoutExit.indexOf('→')
    const command = (arrowIdx >= 0 ? withoutExit.slice(0, arrowIdx) : withoutExit)
      .replace(/^Observation:?\s*/, '')
      .trim()
    const output = arrowIdx >= 0 ? cleanDetail(withoutExit.slice(arrowIdx + 1)) : ''
    return {
      ...base,
      kind: 'observation',
      summary: command.length > 0 ? truncate(command, 90) : 'Command output',
      command: null,
      detail: output.length > 0 ? output : null,
      exitCode,
    }
  }

  if (text.startsWith('You are an expert software engineer')) {
    return {
      ...base,
      kind: 'prompt',
      summary: 'Prompt sent to agent',
      detail: text,
    }
  }

  if (MILESTONE_PREFIXES.some((p) => text.startsWith(p))) {
    return { ...base, kind: 'milestone', summary: text }
  }

  // "summary: command" shaped action events
  const colonIdx = text.indexOf(': ')
  if (colonIdx > 0 && colonIdx < 90) {
    const summary = text.slice(0, colonIdx)
    const rest = text.slice(colonIdx + 2).trim()
    if (COMMAND_STARTERS.test(rest) && !summary.includes('http')) {
      return {
        ...base,
        kind: 'action',
        summary: summary === 'Action' ? 'Ran command' : truncate(summary, 90),
        command: rest,
        detail: null,
      }
    }
  }

  if (text.startsWith('Action:')) {
    return {
      ...base,
      kind: 'action',
      summary: 'Ran command',
      command: text.slice('Action:'.length).trim(),
      detail: null,
    }
  }

  return { ...base, kind: log.level === 'warn' ? 'error' : 'message', summary: text }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function entryIcon(entry: FeedEntry): React.ReactNode {
  if (entry.kind === 'milestone') {
    if (entry.summary.startsWith('Pull request created')) return <GitPullRequest size={12} />
    if (entry.summary.startsWith('PR merged')) return <GitMerge size={12} />
    if (entry.summary.startsWith('PR was closed')) return <GitPullRequestClosed size={12} />
    return <Flag size={12} />
  }
  if (entry.kind === 'action') return <Terminal size={12} />
  if (entry.kind === 'observation') return <FileText size={12} />
  if (entry.kind === 'prompt') return <MessageSquare size={12} />
  if (entry.kind === 'message') return <Bot size={12} />
  return <AlertCircle size={12} />
}

function Expandable({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="arm-expand">
      <button
        className={`arm-expand-toggle ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={11} />
        {open ? 'Hide' : label}
      </button>
      {open && <div className="arm-expand-body">{children}</div>}
    </div>
  )
}

const LONG_MESSAGE = 320

function FeedRow({ entry }: { entry: FeedEntry }) {
  const isLongMessage =
    (entry.kind === 'message' || entry.kind === 'error') &&
    entry.summary.length > LONG_MESSAGE

  return (
    <div className={`arm-entry ${entry.kind}`}>
      <div className="arm-entry-icon">{entryIcon(entry)}</div>
      <div className="arm-entry-body">
        <div className="arm-entry-head">
          <span className="arm-entry-summary">
            {isLongMessage ? truncate(entry.summary, LONG_MESSAGE) : entry.summary}
          </span>
          {entry.exitCode !== null && (
            <span className={`arm-exit ${entry.exitCode === 0 ? 'ok' : 'bad'}`}>
              exit {entry.exitCode}
            </span>
          )}
          <span className="arm-time">
            {new Date(entry.t).toLocaleTimeString([], { hour12: false })}
          </span>
        </div>
        {entry.command && <code className="arm-cmd">{entry.command}</code>}
        {isLongMessage && (
          <Expandable label="Show full text">{entry.summary}</Expandable>
        )}
        {entry.kind === 'prompt' && entry.detail && (
          <Expandable label="View prompt">{entry.detail}</Expandable>
        )}
        {entry.kind === 'observation' && entry.detail && (
          <Expandable label="View output">{entry.detail}</Expandable>
        )}
      </div>
    </div>
  )
}

// ----- modal -----

export function AgentRunModal() {
  const ui = useUI()
  const taskId = ui.agentRunModal?.taskId ?? null
  const isOpen = !!taskId

  const taskRes = useTask(taskId ?? '')
  const runRes = useAgentRunForTask(taskId ?? '')
  const giveMut = useGiveTaskToAgentMutation()

  const [fadeClass, setFadeClass] = useState<'closed' | 'open'>('closed')
  const paneRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const prevEntryCountRef = useRef(0)

  const run = runRes.data
  const status = run?.status
  const isActive = status === 'queued' || status === 'running'
  const stopMut = useStopAgentRunMutation()

  const entries: FeedEntry[] = useMemo(() => {
    if (!run?.logs) return []
    try {
      const parsed = JSON.parse(run.logs)
      if (Array.isArray(parsed)) return parsed.map((log, i) => parseEntry(log, i))
    } catch {
      // ignore
    }
    return []
  }, [run?.logs])

  // Fade-in on open (same pattern as TaskModal).
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setFadeClass('open'))
    } else {
      setFadeClass('closed')
    }
  }, [isOpen])

  // Esc to close.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ui.closeAgentRun()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, ui])

  // Auto-scroll only when NEW entries arrive while the user is pinned to the
  // bottom — never on initial load, so the feed reads from the top.
  useEffect(() => {
    const grew = prevEntryCountRef.current > 0 && entries.length > prevEntryCountRef.current
    prevEntryCountRef.current = entries.length
    if (grew && stickToBottomRef.current) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [entries.length])

  // Reset scroll tracking when switching between runs.
  useEffect(() => {
    prevEntryCountRef.current = 0
    stickToBottomRef.current = true
  }, [taskId])

  if (!isOpen || !taskId) return null

  const task = taskRes.data
  const meta = STATUS_META[status ?? ''] ?? { label: 'No runs yet', className: 'queued', icon: <Bot size={12} /> }

  const onLogsScroll = () => {
    const pane = paneRef.current
    if (!pane) return
    stickToBottomRef.current =
      pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 40
  }

  return (
    <div
      className={`modal-backdrop ${fadeClass === 'open' ? 'open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) ui.closeAgentRun()
      }}
    >
      <div className="modal agent-run-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="arm-title-wrap">
            <div className="arm-eyebrow">
              <Bot size={13} />
              <span>Agent run</span>
            </div>
            <div className="arm-title">{task?.title ?? '…'}</div>
          </div>
          <div className="arm-head-right">
            <span className={`arm-status ${meta.className}`}>
              {meta.icon}
              <span>{meta.label}</span>
            </span>
            <button className="modal-close" onClick={ui.closeAgentRun} aria-label="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {run && (
            <div className="arm-meta">
              {run.branchName && (
                <span className="arm-chip">
                  <GitBranch size={11} />
                  {run.branchName}
                </span>
              )}
              {run.prUrl && (
                <a
                  className="arm-chip arm-chip-link"
                  href={run.prUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <GitPullRequest size={11} />
                  {run.prNumber ? `PR #${run.prNumber}` : 'Open PR'}
                  <ExternalLink size={10} />
                </a>
              )}
              <span className="arm-chip arm-chip-muted">
                Started {new Date(run.createdAt).toLocaleString()}
              </span>
            </div>
          )}

          {run?.errorMessage && (
            <div className="arm-error">
              <AlertCircle size={13} />
              <span>{run.errorMessage}</span>
            </div>
          )}

          <div className="field-label arm-logs-label">Activity</div>
          <div className="arm-logs" ref={paneRef} onScroll={onLogsScroll}>
            {!run ? (
              <div className="arm-logs-empty">No agent run yet for this task.</div>
            ) : entries.length === 0 ? (
              <div className="arm-logs-empty">No activity yet.</div>
            ) : (
              entries.map((entry) => <FeedRow key={entry.key} entry={entry} />)
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        <div className="modal-foot">
          <div className="left">
            {isActive && (
              <span className="arm-live">
                <span className="arm-live-dot" />
                Live
              </span>
            )}
          </div>
          <div className="right">
            {isActive && run && (
              <button
                className="btn btn-ghost"
                onClick={() => stopMut.mutate({ data: { runId: run.id } })}
                disabled={stopMut.isPending}
              >
                <Square size={13} />
                {stopMut.isPending ? 'Stopping…' : 'Stop run'}
              </button>
            )}
            {(status === 'error' || status === 'closed' || status === 'stopped') && (
              <button
                className="btn btn-ghost"
                onClick={() => giveMut.mutate({ data: { taskId } })}
                disabled={giveMut.isPending}
              >
                <RefreshCw size={13} className={giveMut.isPending ? 'spin' : ''} />
                {giveMut.isPending ? 'Retrying…' : 'Retry run'}
              </button>
            )}
            {run?.prUrl && (
              <a
                className="btn btn-ghost"
                href={run.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open PR
                <ExternalLink size={12} />
              </a>
            )}
            <button className="btn btn-primary" onClick={ui.closeAgentRun}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
