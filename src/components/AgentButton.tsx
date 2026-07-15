import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, ChevronDown, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { useAgentRunForTask, useGiveTaskToAgentMutation } from '#/lib/queries'

interface AgentButtonProps {
  taskId: string
}

type LogEntry = {
  t: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export function AgentButton({ taskId }: AgentButtonProps) {
  const runRes = useAgentRunForTask(taskId)
  const giveMut = useGiveTaskToAgentMutation()
  const [expanded, setExpanded] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const run = runRes.data
  const status = run?.status

  const logs: LogEntry[] = useMemo(() => {
    if (!run?.logs) return []
    try {
      const parsed = JSON.parse(run.logs)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // ignore
    }
    return []
  }, [run?.logs])

  useEffect(() => {
    if (expanded && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, expanded])

  const isActive = status === 'queued' || status === 'running'

  return (
    <div className="agent-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        className={`agent-btn ${isActive ? 'active' : ''} ${status === 'success' ? 'success' : ''} ${status === 'error' ? 'error' : ''}`}
        onClick={() => {
          if (!run) {
            giveMut.mutate({ data: { taskId } })
          } else if (status === 'error') {
            giveMut.mutate({ data: { taskId } })
          } else {
            setExpanded((v) => !v)
          }
        }}
        disabled={giveMut.isPending || isActive}
        title={status === 'error' ? 'Retry this agent run' : 'Give this task to an AI agent'}
      >
        {isActive ? <Loader2 size={14} className="spin" /> : status === 'error' ? <RefreshCw size={14} /> : <Bot size={14} />}
        <span>{labelForStatus(status)}</span>
        {run && (
          <ChevronDown
            size={12}
            className={`chev ${expanded ? 'open' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
          />
        )}
      </button>

      {expanded && run && (
        <div className="agent-log">
          <div className="agent-log-head">
            <span className="status-badge" data-status={status}>
              {status}
            </span>
            {status === 'error' ? (
              <button
                className="agent-log-retry"
                onClick={() => giveMut.mutate({ data: { taskId } })}
                disabled={giveMut.isPending}
              >
                <RefreshCw size={10} className={giveMut.isPending ? 'spin' : ''} />
                <span>{giveMut.isPending ? 'Retrying…' : 'Retry run'}</span>
              </button>
            ) : run.prUrl ? (
              <a
                className="pr-link"
                href={run.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open PR <ExternalLink size={10} />
              </a>
            ) : null}
          </div>
          {run.errorMessage && (
            <div className="agent-log-error">{run.errorMessage}</div>
          )}
          <div className="agent-log-body">
            {logs.length === 0 ? (
              <div className="agent-log-empty">No logs yet.</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`agent-log-line ${log.level}`}>
                  <span className="agent-log-time">
                    {new Date(log.t).toLocaleTimeString()}
                  </span>
                  <span className="agent-log-msg">{log.message}</span>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}

function labelForStatus(status: string | undefined): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'success':
      return 'PR Ready'
    case 'error':
      return 'Retry'
    default:
      return 'Give to Agent'
  }
}
