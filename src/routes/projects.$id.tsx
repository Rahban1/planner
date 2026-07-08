import { createFileRoute, useLoaderData, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { PriorityPanel } from '#/components/PriorityPanel'
import {
  useProject,
  useProjectSummary,
  usePriority,
  useCompleteTaskMutation,
  useUncompleteTaskMutation,
  useDeleteTaskMutation,
  useDeleteProjectMutation,
} from '#/lib/queries'
import type {Task, TaskWithSubtasks, PriorityCard} from '#/lib/queries';
import { useUI } from '#/lib/ui-context'
import { useFocus  } from '#/lib/focus-context'
import type {TaskActions} from '#/lib/focus-context';
import { priorityClass, formatDue } from '#/lib/format'
import { listProjectSummary } from '#/server/tasks'
import { getProject } from '#/server/projects'
import { listPriority } from '#/server/priority'

export const Route = createFileRoute('/projects/$id')({
  loader: async ({ params }) => {
    const [project, summary, priority] = await Promise.all([
      getProject({ data: { id: params.id } }),
      listProjectSummary({ data: { projectId: params.id } }),
      listPriority(),
    ])
    return { project, summary, priority }
  },
  component: ProjectPage,
})

function ProjectPage() {
  const { id } = Route.useParams()
  const projectRes = useProject(id)
  const summaryRes = useProjectSummary(id)
  const priorityRes = usePriority()
  const completeMut = useCompleteTaskMutation()
  const uncompleteMut = useUncompleteTaskMutation()
  const deleteMut = useDeleteTaskMutation()
  const deleteProjectMut = useDeleteProjectMutation()
  const ui = useUI()
  const navigate = useNavigate()
  const focus = useFocus()
  const loaderData = useLoaderData({ from: '/projects/$id' })

  const project = projectRes.data ?? loaderData.project
  const summary =
    summaryRes.data ?? loaderData.summary ?? { active: [] as TaskWithSubtasks[], completed: [] as Task[] }
  const priorities: PriorityCard[] = priorityRes.data ?? loaderData.priority ?? []

  // Register flat task list + handlers for keyboard navigation
  useEffect(() => {
    const taskIds: string[] = []
    const handlers: Record<string, TaskActions> = {}

    // --- Priority tasks (cross-project, for reference) ---
    for (const t of priorities) {
      if (t.project.id !== id) continue
      taskIds.push(t.id)
      handlers[t.id] = {
        open: () => ui.openTask(t.id, t.project.name, t.project.repoUrl),
        complete: () => completeMut.mutate({ data: { id: t.id } }),
        delete: () => deleteMut.mutate({ data: { id: t.id } }),
      }
    }

    // --- Active tasks ---
    for (const t of summary.active) {
      taskIds.push(t.id)
      handlers[t.id] = {
        open: () => ui.openTask(t.id, project?.name, project?.repoUrl),
        complete: () => completeMut.mutate({ data: { id: t.id } }),
        delete: () => deleteMut.mutate({ data: { id: t.id } }),
      }
    }

    // --- Completed tasks (Space/x restores) ---
    for (const t of summary.completed) {
      taskIds.push(t.id)
      handlers[t.id] = {
        open: () => ui.openTask(t.id, project?.name, project?.repoUrl),
        complete: () => uncompleteMut.mutate({ data: { id: t.id } }),
        delete: () => deleteMut.mutate({ data: { id: t.id } }),
      }
    }

    focus.register(taskIds, handlers)
  }, [priorities, summary, project, id, ui, completeMut, uncompleteMut, deleteMut, focus])

  if (!project) {
    return (
      <main className="project-page">
        <div className="pp-back" onClick={() => navigate({ to: '/' })}>
          <ChevronLeft size={12} />
          Back to projects
        </div>
        <div className="serif" style={{ fontSize: 28, color: 'var(--g-700)' }}>
          Project not found.
        </div>
      </main>
    )
  }

  return (
    <main className="project-page">
      <div className="pp-back" onClick={() => navigate({ to: '/' })} role="button" tabIndex={0}>
        <ChevronLeft size={12} />
        All projects
      </div>

      <div className="pp-head">
        <div className="pp-title">
          <div className="name" role="textbox">{project.name}</div>
          {project.repoUrl && (
            <a
              className="repo"
              href={project.repoUrl}
              target="_blank"
              rel="noreferrer"
            >
              {project.repoUrl.replace(/^https?:\/\//, '')}
            </a>
          )}
        </div>
        <div className="pp-actions">
          <span
            className="pp-add-task"
            onClick={() => ui.openNewTask(project.id, project.name, project.repoUrl)}
            role="button"
            tabIndex={0}
          >
            + new task
          </span>
          <span
            className="pp-delete-proj"
            onClick={async () => {
              const confirmed = await ui.requestConfirm({
                title: `Delete "${project.name}"?`,
                message: 'All of its tasks will be removed. This cannot be undone.',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                destructive: true,
              })
              if (!confirmed) return
              deleteProjectMut.mutate(
                { data: { id: project.id } },
                { onSuccess: () => navigate({ to: '/' }) },
              )
            }}
            role="button"
            tabIndex={0}
            title="Delete project"
          >
            <Trash2 size={16} />
          </span>
        </div>
      </div>

      <div className="pp-tasks">
        <div className="pp-section-label">Active</div>
        {summary.active.map((t) => (
          <ActiveTaskRow
            key={t.id}
            task={t}
            focused={focus.focusedTaskId === t.id}
            onClick={() => ui.openTask(t.id, project.name, project.repoUrl)}
            onComplete={() => completeMut.mutate({ data: { id: t.id } })}
          />
        ))}
        {summary.active.length === 0 && (
          <div className="serif italic" style={{ color: 'var(--g-700)', padding: '12px 0' }}>
            All clear here.
          </div>
        )}

        <div className="pp-completed">
          <div className="pp-section-label">Completed</div>
          <div className="pp-completed-list">
            {summary.completed.map((t) => (
              <CompletedTaskRow
                key={t.id}
                task={t}
                focused={focus.focusedTaskId === t.id}
                onClick={() => ui.openTask(t.id, project.name, project.repoUrl)}
                onRestore={() => uncompleteMut.mutate({ data: { id: t.id } })}
              />
            ))}
            {summary.completed.length === 0 && (
              <div className="serif italic" style={{ color: 'var(--g-500)', padding: '8px 12px' }}>
                Nothing here yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {priorities.length > 0 && (
        <PriorityPanel
          items={priorities}
          onTaskClick={(tid) => {
            const proj = priorities.find((t) => t.id === tid)?.project
            ui.openTask(tid, proj?.name, proj?.repoUrl)
          }}
        />
      )}
    </main>
  )
}

function ActiveTaskRow({
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
  const dueTxt = formatDue(task.dueAt)
  return (
    <div
      id={`focus-${task.id}`}
      className={`pp-task ${focused ? 'kbd-focus' : ''}`}
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
          onComplete()
        }}
        role="button"
        tabIndex={0}
        aria-label="Mark done"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onComplete()
        }}
      />
      <div className="t-title">{task.title}</div>
      <div className="t-meta">
        <span className={`pill ${priorityClass(task.priority)}`}>
          <span className="dot" />
          {task.priority}
          {dueTxt ? ` · ${dueTxt}` : ''}
        </span>
      </div>
      <svg className="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
}

function CompletedTaskRow({
  task,
  focused,
  onClick,
  onRestore,
}: {
  task: Task
  focused: boolean
  onClick: () => void
  onRestore: () => void
}) {
  return (
    <div
      id={`focus-${task.id}`}
      className={`pp-task done ${focused ? 'kbd-focus' : ''}`}
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
        className="check done"
        onClick={(e) => {
          e.stopPropagation()
          onRestore()
        }}
        role="button"
        tabIndex={0}
        aria-label="Restore task"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onRestore()
        }}
      />
      <div className="t-title">{task.title}</div>
      <div />
      <div />
    </div>
  )
}