import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowRight,
  Check,
  GitPullRequest,
  LoaderCircle,
  MessageSquare,
  ScrollText,
} from 'lucide-react'
import type { WorkflowTask } from '#/server/workflow'

const labels = {
  needs_plan: 'Planning',
  planning: 'Planning',
  plan_ready: 'Plan ready',
  building: 'Building',
  review: 'Review',
  failed: 'Needs attention',
  done: 'Done',
}
export function TaskList({
  tasks,
  showProject = true,
}: {
  tasks: WorkflowTask[]
  showProject?: boolean
}) {
  return (
    <div className="wf-task-list">
      {tasks.map((task) => {
        const running = task.state === 'planning' || task.state === 'building'
        const Icon = running
          ? LoaderCircle
          : task.state === 'failed'
            ? AlertCircle
            : task.state === 'done'
              ? Check
              : task.state === 'plan_ready'
                ? ScrollText
                : task.state === 'review'
                  ? GitPullRequest
                  : MessageSquare
        const action =
          task.state === 'plan_ready'
            ? 'Review plan'
            : task.state === 'review'
              ? 'Review changes'
              : task.state === 'failed'
                ? 'View issue'
                : running
                  ? 'View progress'
                  : task.state === 'done'
                    ? 'View task'
                    : 'Continue'
        return (
          <Link
            key={task.id}
            to="/projects/$id/tasks/$taskId"
            params={{ id: task.projectId, taskId: task.id }}
            className={`wf-task-row wf-state-${task.state}`}
          >
            <span className="wf-task-icon">
              <Icon size={21} className={running ? 'wf-spin' : undefined} />
            </span>
            <span className="wf-task-copy">
              <span className="wf-task-meta">
                {showProject && <span>{task.projectName}</span>}
                <span className="wf-state-label">{labels[task.state]}</span>
              </span>
              <strong>{task.title}</strong>
              <span className="wf-task-detail">{task.nextAction}</span>
            </span>
            <span className="wf-task-action">
              {action}
              <ArrowRight size={16} />
            </span>
          </Link>
        )
      })}
    </div>
  )
}
