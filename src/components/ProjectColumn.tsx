import { useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import type { Project, Task, TaskWithSubtasks } from '#/lib/queries'
import { priorityClass as fmtPrio, formatDue as fmtDue } from '#/lib/format'
import { useFocus } from '#/lib/focus-context'
import { AgentButton } from '#/components/AgentButton'

interface ProjectColumnProps {
  project: Project
  active: TaskWithSubtasks[]
  completed: Task[]
  onTaskClick: (taskId: string) => void
  onProjectClick: () => void
  onProjectDelete: () => void
  onTaskComplete: (taskId: string) => void
  onAddTask: () => void
  onUncomplete: (taskId: string) => void
}

export function ProjectColumn(props: ProjectColumnProps) {
  const [showCompleted, setShowCompleted] = useState(false)
  const { project, active, completed } = props
  const focus = useFocus()

  return (
    <div className="column">
      <div className="column-head">
        <div
          className="name"
          onClick={props.onProjectClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') props.onProjectClick()
          }}
        >
          {project.name}
        </div>
        <div className="right">
          {project.repoUrl && (
            <a className="repo" href={project.repoUrl} target="_blank" rel="noreferrer">
              {project.repoUrl.replace(/^https?:\/\//, '')}
            </a>
          )}
          <span
            className="add-task"
            onClick={props.onAddTask}
            role="button"
            tabIndex={0}
            title="New task"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') props.onAddTask()
            }}
          >
            +
          </span>
          <span
            className="delete-proj"
            onClick={props.onProjectDelete}
            role="button"
            tabIndex={0}
            title="Delete project"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') props.onProjectDelete()
            }}
          >
            <Trash2 size={14} />
          </span>
        </div>
      </div>

      <div className="task-list">
        {active.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            focused={focus.focusedTaskId === t.id}
            onClick={() => props.onTaskClick(t.id)}
            onComplete={() => props.onTaskComplete(t.id)}
          />
        ))}
        {active.length === 0 && (
          <div className="serif italic" style={{ color: 'var(--g-700)', padding: '12px 10px' }}>
            All clear here.
          </div>
        )}
      </div>

      {completed.length > 0 && (
        <div
          className={`done-toggle ${showCompleted ? 'open' : ''}`}
          onClick={() => setShowCompleted((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setShowCompleted((v) => !v)
          }}
        >
          <ChevronDown className="chev" size={12} />
          Done ({completed.length})
        </div>
      )}
      <div className={`done-list ${showCompleted ? 'open' : ''}`}>
        <div className="inner">
          {completed.map((t) => (
            <div
              key={t.id}
              className="d-task"
              onClick={() => props.onUncomplete(t.id)}
              role="button"
              tabIndex={0}
              title="Restore task"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') props.onUncomplete(t.id)
              }}
            >
              <div className="check done" />
              <div className="t-title">{t.title}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TaskCard({
  task,
  focused,
  onClick,
  onComplete,
}: {
  task: Task
  focused: boolean
  onClick: () => void
  onComplete: () => void
}) {
  const [removing, setRemoving] = useState(false)
  const dueTxt = fmtDue(task.dueAt)
  const prioCut = fmtPrio(task.priority)

  return (
    <div
      id={`focus-${task.id}`}
      className={`task ${removing ? 'removing' : ''} ${focused ? 'kbd-focus' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.check')) return
        onClick()
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick()
      }}
    >
      <div
        className="check"
        onClick={(e) => {
          e.stopPropagation()
          if (removing) return
          setRemoving(true)
          window.setTimeout(onComplete, 220)
        }}
        role="button"
        tabIndex={0}
        aria-label="Mark done"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setRemoving(true)
            window.setTimeout(onComplete, 220)
          }
        }}
      />
      <div className="task-main">
        <div className="t-title">{task.title}</div>
        <div className="t-meta">
          <span className={`pill ${prioCut}`}>
            <span className="dot" />
            {task.priority}
            {dueTxt ? ` · ${dueTxt}` : ''}
          </span>
        </div>
      </div>
      <div className="task-actions">
        <AgentButton taskId={task.id} variant="icons" />
      </div>
    </div>
  )
}