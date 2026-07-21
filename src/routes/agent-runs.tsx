import { useState, useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  AlertCircle,
  Loader2,
  ChevronDown,
  RefreshCw,
  GitBranch,
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
  Folder,
} from 'lucide-react'
import { useAgentRuns, useGiveTaskToAgentMutation } from '#/lib/queries'

export const Route = createFileRoute('/agent-runs')({
  component: AgentRunsPage,
})

type StatusFilter = 'all' | 'queued' | 'running' | 'success' | 'error' | 'merged' | 'closed' | 'stopped' | 'plan_ready' | 'approved'

const statusConfig: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  queued: { label: 'Queued', color: 'var(--g-700)', icon: <Clock size={12} /> },
  running: {
    label: 'Running',
    color: 'var(--accent)',
    icon: <Loader2 size={12} className="spin" />,
  },
  success: {
    label: 'Success',
    color: 'var(--accent)',
    icon: <CheckCircle2 size={12} />,
  },
  merged: {
    label: 'Merged',
    color: 'var(--accent)',
    icon: <GitMerge size={12} />,
  },
  closed: {
    label: 'PR Closed',
    color: '#e5a073',
    icon: <GitPullRequestClosed size={12} />,
  },
  stopped: {
    label: 'Stopped',
    color: '#e5a073',
    icon: <GitPullRequestClosed size={12} />,
  },
  plan_ready: {
    label: 'Plan Ready',
    color: 'var(--accent)',
    icon: <ClipboardList size={12} />,
  },
  approved: {
    label: 'Approved',
    color: 'var(--accent)',
    icon: <CheckCircle2 size={12} />,
  },
  error: { label: 'Error', color: '#e57373', icon: <AlertCircle size={12} /> },
}

function AgentRunsPage() {
  const runsQuery = useAgentRuns()
  const giveMut = useGiveTaskToAgentMutation()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const runs = useMemo(() => {
    const all = runsQuery.data ?? []
    if (filter === 'all') return all
    return all.filter((r) => r.status === filter)
  }, [runsQuery.data, filter])

  const counts = useMemo(() => {
    const all = runsQuery.data ?? []
    return {
      all: all.length,
      queued: all.filter((r) => r.status === 'queued').length,
      running: all.filter((r) => r.status === 'running').length,
      success: all.filter((r) => r.status === 'success').length,
      merged: all.filter((r) => r.status === 'merged').length,
      closed: all.filter((r) => r.status === 'closed').length,
      stopped: all.filter((r) => r.status === 'stopped').length,
      plan_ready: all.filter((r) => r.status === 'plan_ready').length,
      approved: all.filter((r) => r.status === 'approved').length,
      error: all.filter((r) => r.status === 'error').length,
    }
  }, [runsQuery.data])

  const toggleLogs = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="agent-runs-page">
      <div className="agent-runs-head">
        <Link to="/" className="agent-runs-back">
          <ArrowLeft size={14} />
          <span>Dashboard</span>
        </Link>
        <h1 className="agent-runs-title">
          <Bot size={28} className="agent-runs-title-icon" aria-hidden="true" />
          Agent Runs
        </h1>
        <p className="agent-runs-subtitle">
          Track every task handed to the agent, live logs, and pull-request
          outcomes.
        </p>
      </div>

      <div className="agent-runs-filters">
        {(['all', 'running', 'queued', 'success', 'merged', 'closed', 'stopped', 'plan_ready', 'approved', 'error'] as StatusFilter[]).map(
          (s) => (
            <button
              key={s}
              className={`agent-runs-filter ${filter === s ? 'active' : ''}`}
              onClick={() => setFilter(s)}
            >
              <span className="capitalize">{s}</span>
              <span className="agent-runs-count">{counts[s]}</span>
            </button>
          ),
        )}
      </div>

      {runsQuery.isLoading ? (
        <div className="agent-runs-empty">
          <Loader2 size={24} className="spin" />
          <p>Loading agent runs…</p>
        </div>
      ) : runs.length === 0 ? (
        <div className="agent-runs-empty">
          <Bot size={32} className="agent-runs-empty-icon" />
          <p>No agent runs yet.</p>
          <p className="agent-runs-empty-hint">
            Click “Give to Agent” on any task to see it here.
          </p>
        </div>
      ) : (
        <div className="agent-runs-list">
          {runs.map((run) => {
            const cfg = statusConfig[run.status] ?? statusConfig.queued
            const isOpen = !!expanded[run.id]
            const logs = parseLogs(run.logs)
            const repoPath = run.repoUrl
              ? run.repoUrl.replace(/^https?:\/\//, '')
              : null

            return (
              <div
                key={run.id}
                className={`agent-run-card ${isOpen ? 'open' : ''}`}
                onClick={() => toggleLogs(run.id)}
              >
                <div className="agent-run-card-head">
                  <div className="agent-run-card-main">
                    <div className="agent-run-task-title">
                      {run.taskTitle ?? 'Untitled task'}
                    </div>
                    <div className="agent-run-card-meta">
                      {run.projectName && (
                        <span className="agent-run-meta-item">
                          <Folder size={11} />
                          {run.projectName}
                        </span>
                      )}
                      {repoPath && (
                        <a
                          className="agent-run-meta-item repo"
                          href={run.repoUrl ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {repoPath}
                        </a>
                      )}
                      <span className="agent-run-meta-item">
                        {formatRelative(run.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="agent-run-card-actions">
                    <div
                      className="agent-run-status-badge"
                      style={{ color: cfg.color, borderColor: cfg.color }}
                    >
                      {cfg.icon}
                      <span>{cfg.label}</span>
                    </div>
                    <ChevronDown
                      size={16}
                      className={`agent-run-card-chev ${isOpen ? 'open' : ''}`}
                    />
                  </div>
                </div>

                {run.status === 'success' && (
                  <div className="agent-run-outcome success">
                    {run.prUrl ? (
                      <a
                        className="agent-run-pr-link"
                        href={run.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GitPullRequest size={14} />
                        <span>Open Pull Request</span>
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="agent-run-outcome-text">
                        <CheckCircle2 size={14} />
                        Completed without a PR URL.
                      </span>
                    )}
                    {run.branchName && (
                      <span className="agent-run-branch">
                        <GitBranch size={12} />
                        {run.branchName}
                      </span>
                    )}
                  </div>
                )}

                {run.status === 'merged' && (
                  <div className="agent-run-outcome success">
                    {run.prUrl ? (
                      <a
                        className="agent-run-pr-link"
                        href={run.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GitMerge size={14} />
                        <span>Pull Request merged — task completed</span>
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="agent-run-outcome-text">
                        <GitMerge size={14} />
                        Merged — task completed.
                      </span>
                    )}
                    {run.branchName && (
                      <span className="agent-run-branch">
                        <GitBranch size={12} />
                        {run.branchName}
                      </span>
                    )}
                  </div>
                )}

                {run.status === 'closed' && (
                  <div className="agent-run-outcome error">
                    <div className="agent-run-error-main">
                      <GitPullRequestClosed size={14} />
                      <span>PR was closed without merging.</span>
                    </div>
                    <button
                      className="agent-run-retry"
                      onClick={(e) => {
                        e.stopPropagation()
                        giveMut.mutate({ data: { taskId: run.taskId } })
                      }}
                      disabled={giveMut.isPending}
                    >
                      <RefreshCw size={12} className={giveMut.isPending ? 'spin' : ''} />
                      <span>{giveMut.isPending ? 'Retrying…' : 'Retry'}</span>
                    </button>
                  </div>
                )}

                {run.status === 'stopped' && (
                  <div className="agent-run-outcome error">
                    <div className="agent-run-error-main">
                      <GitPullRequestClosed size={14} />
                      <span>Run was stopped by user.</span>
                    </div>
                    <button
                      className="agent-run-retry"
                      onClick={(e) => {
                        e.stopPropagation()
                        giveMut.mutate({ data: { taskId: run.taskId } })
                      }}
                      disabled={giveMut.isPending}
                    >
                      <RefreshCw size={12} className={giveMut.isPending ? 'spin' : ''} />
                      <span>{giveMut.isPending ? 'Retrying…' : 'Retry'}</span>
                    </button>
                  </div>
                )}

                {run.status === 'error' && (
                  <div className="agent-run-outcome error">
                    <div className="agent-run-error-main">
                      <AlertCircle size={14} />
                      <span>{run.errorMessage ?? 'The agent run failed.'}</span>
                    </div>
                    <button
                      className="agent-run-retry"
                      onClick={(e) => {
                        e.stopPropagation()
                        giveMut.mutate({ data: { taskId: run.taskId } })
                      }}
                      disabled={giveMut.isPending}
                    >
                      <RefreshCw size={12} className={giveMut.isPending ? 'spin' : ''} />
                      <span>{giveMut.isPending ? 'Retrying…' : 'Retry'}</span>
                    </button>
                  </div>
                )}

                {isOpen && (
                  <div className="agent-run-logs" onClick={(e) => e.stopPropagation()}>
                    <div className="agent-run-logs-head">
                      <span>Logs</span>
                      <span className="agent-run-logs-count">{logs.length} entries</span>
                    </div>
                    {logs.length === 0 ? (
                      <div className="agent-run-log-empty">
                        No logs captured yet.
                      </div>
                    ) : (
                      logs.map((log, i) => (
                        <div
                          key={i}
                          className={`agent-run-log-line ${log.level}`}
                        >
                          <span className="agent-run-log-time">
                            {new Date(log.t).toLocaleTimeString()}
                          </span>
                          <span className="agent-run-log-msg">
                            {log.message}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                <div className="agent-run-card-foot">
                  <Link
                    to="/projects/$id"
                    params={{ id: run.projectId }}
                    className="agent-run-foot-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View project
                  </Link>
                  <span className="agent-run-updated">
                    Updated {formatRelative(run.updatedAt)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function parseLogs(
  raw: string | null,
): Array<{ t: number; level: 'info' | 'warn' | 'error'; message: string }> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // ignore
  }
  return []
}

function formatRelative(ts: number | null): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}
