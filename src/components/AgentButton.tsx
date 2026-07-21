import {
  Bot,
  GitMerge,
  GitPullRequestClosed,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useAgentRunForTask, useGiveTaskToAgentMutation } from '#/lib/queries'
import { useUI } from '#/lib/ui-context'

interface AgentButtonProps {
  taskId: string
}

export function AgentButton({ taskId }: AgentButtonProps) {
  const runRes = useAgentRunForTask(taskId)
  const giveMut = useGiveTaskToAgentMutation()
  const ui = useUI()

  const run = runRes.data
  const status = run?.status
  const isActive = status === 'queued' || status === 'running'

  return (
    <div className="agent-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        className={`agent-btn ${isActive ? 'active' : ''} ${status === 'success' ? 'success' : ''} ${status === 'error' ? 'error' : ''} ${status === 'merged' ? 'merged' : ''} ${status === 'closed' ? 'closed' : ''}`}
        onClick={() => {
          if (!run) {
            giveMut.mutate({ data: { taskId } })
          } else {
            ui.openAgentRun(taskId)
          }
        }}
        disabled={giveMut.isPending}
        title={
          !run
            ? 'Give this task to an AI agent'
            : isActive
              ? 'Watch the agent run live'
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
        ) : (
          <Bot size={14} />
        )}
        <span>{labelForStatus(status)}</span>
      </button>
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
    case 'merged':
      return 'Merged'
    case 'closed':
      return 'PR Closed'
    case 'error':
      return 'Error'
    default:
      return 'Give to Agent'
  }
}
