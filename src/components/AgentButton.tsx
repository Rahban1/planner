import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  GitMerge,
  GitPullRequestClosed,
  Loader2,
  RefreshCw,
  Square,
} from 'lucide-react'
import {
  useAgentRunForTask,
  useGiveTaskToAgentMutation,
  usePlanTaskMutation,
  useStopAgentRunMutation,
} from '#/lib/queries'
import { useUI } from '#/lib/ui-context'

interface AgentButtonProps {
  taskId: string
  /** split: main button + dropdown (roomy cards). icons: two compact icon buttons (tight rows). */
  variant?: 'split' | 'icons'
}

export function AgentButton({ taskId, variant = 'split' }: AgentButtonProps) {
  const runRes = useAgentRunForTask(taskId)
  const giveMut = useGiveTaskToAgentMutation()
  const planMut = usePlanTaskMutation()
  const stopMut = useStopAgentRunMutation()
  const ui = useUI()
  const [menuOpen, setMenuOpen] = useState(false)
  const caretRef = useRef<HTMLButtonElement>(null)

  const run = runRes.data
  const status = run?.status
  const kind = run?.kind
  const isActive = status === 'queued' || status === 'running'
  const busy = giveMut.isPending || planMut.isPending || stopMut.isPending

  const openRun = () => {
    if (kind === 'plan' && (status === 'queued' || status === 'running' || status === 'plan_ready' || status === 'approved')) {
      ui.openPlan(taskId)
    } else {
      ui.openAgentRun(taskId)
    }
  }

  // No run yet: offer the choice between implement and plan.
  if (!run) {
    if (variant === 'icons') {
      return (
        <div className="agent-wrap agent-icons" onClick={(e) => e.stopPropagation()}>
          <button
            className="agent-icon-btn"
            onClick={() => giveMut.mutate({ data: { taskId } })}
            disabled={busy}
            title="Give to Agent — implement and open a PR"
            aria-label="Give to Agent"
          >
            <Bot size={14} />
          </button>
          <button
            className="agent-icon-btn plan"
            onClick={() => planMut.mutate({ data: { taskId } })}
            disabled={busy}
            title="Plan — agent drafts a plan for your review first"
            aria-label="Draft a plan"
          >
            <ClipboardList size={14} />
          </button>
        </div>
      )
    }

    return (
      <div className="agent-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="agent-split">
          <button
            className="agent-btn split-main"
            onClick={() => giveMut.mutate({ data: { taskId } })}
            disabled={busy}
            title="Give this task to an AI agent"
          >
            <Bot size={14} />
            <span>Give to Agent</span>
          </button>
          <button
            ref={caretRef}
            className="agent-btn split-caret"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={busy}
            title="Choose agent action"
            aria-label="Choose agent action"
            aria-expanded={menuOpen}
          >
            <ChevronDown size={12} className={`chev ${menuOpen ? 'open' : ''}`} />
          </button>
        </div>
        {menuOpen &&
          createPortal(
            <>
              <div className="agent-menu-overlay" onClick={() => setMenuOpen(false)} />
              <div
                className="agent-menu"
                role="menu"
                style={menuPosition(caretRef.current)}
              >
              <button
                className="agent-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  giveMut.mutate({ data: { taskId } })
                }}
              >
                <Bot size={14} />
                <span className="agent-menu-text">
                  <span className="agent-menu-title">Give to Agent</span>
                  <span className="agent-menu-desc">Implement now and open a PR</span>
                </span>
              </button>
              <button
                className="agent-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  planMut.mutate({ data: { taskId } })
                }}
              >
                <ClipboardList size={14} />
                <span className="agent-menu-text">
                  <span className="agent-menu-title">Plan</span>
                  <span className="agent-menu-desc">Draft a plan for your review first</span>
                </span>
              </button>
              </div>
            </>,
            document.body,
          )}
      </div>
    )
  }

  // Run exists: status button opens the run (plan runs open the plan review).
  return (
    <div className="agent-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        className={`agent-btn ${isActive ? 'active' : ''} ${status === 'success' ? 'success' : ''} ${status === 'error' ? 'error' : ''} ${status === 'merged' ? 'merged' : ''} ${status === 'closed' ? 'closed' : ''} ${status === 'stopped' ? 'stopped' : ''} ${status === 'plan_ready' ? 'plan' : ''}`}
        onClick={openRun}
        disabled={busy}
        title={
          isActive
            ? 'Watch the agent run live'
            : kind === 'plan'
              ? 'Review the plan'
              : 'View agent run details'
        }
      >
        {isActive ? (
          <Loader2 size={14} className="spin" />
        ) : status === 'error' ? (
          <RefreshCw size={14} />
        ) : status === 'merged' ? (
          <GitMerge size={14} />
        ) : status === 'closed' ? (
          <GitPullRequestClosed size={14} />
        ) : status === 'stopped' ? (
          <Square size={14} />
        ) : status === 'plan_ready' ? (
          <ClipboardList size={14} />
        ) : status === 'approved' ? (
          <CheckCircle2 size={14} />
        ) : (
          <Bot size={14} />
        )}
        <span>{labelForStatus(status, kind)}</span>
      </button>
      {isActive && (
        <button
          className="agent-stop-btn"
          onClick={() => stopMut.mutate({ data: { runId: run.id } })}
          disabled={stopMut.isPending}
          title="Stop this agent run"
          aria-label="Stop agent run"
        >
          <Square size={12} />
        </button>
      )}
    </div>
  )
}

function menuPosition(anchor: HTMLButtonElement | null): React.CSSProperties {
  if (!anchor) return {}
  const rect = anchor.getBoundingClientRect()
  return {
    position: 'fixed',
    top: rect.bottom + 6,
    right: window.innerWidth - rect.right,
  }
}

function labelForStatus(status: string | undefined, kind?: string): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return kind === 'plan' ? 'Planning…' : 'Running'
    case 'success':
      return 'PR Ready'
    case 'merged':
      return 'Merged'
    case 'closed':
      return 'PR Closed'
    case 'stopped':
      return 'Stopped'
    case 'plan_ready':
      return 'Plan Ready'
    case 'approved':
      return 'Approved'
    case 'error':
      return 'Error'
    default:
      return 'Give to Agent'
  }
}
