import { createFileRoute, useLoaderData, useNavigate } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { PriorityPanel } from '#/components/PriorityPanel'
import {
  useProject,
  useProjectSummary,
  usePriority,
  useCompleteTaskMutation,
  useUncompleteTaskMutation
  
  
  
} from '#/lib/queries'
import type {Task, TaskWithSubtasks, PriorityCard} from '#/lib/queries';
import { useUI } from '#/lib/ui-context'
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
  const ui = useUI()
  const navigate = useNavigate()
  const loaderData = useLoaderData({ from: '/projects/$id' })

  const project = projectRes.data ?? loaderData.project
  const summary =
    summaryRes.data ?? loaderData.summary ?? { active: [] as TaskWithSubtasks[], completed: [] as Task[] }
  const priorities: PriorityCard[] = priorityRes.data ?? loaderData.priority ?? []

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
        <span
          className="pp-add-task"
          onClick={() => ui.openNewTask(project.id, project.name, project.repoUrl)}
          role="button"
          tabIndex={0}
        >
          + new task
        </span>
      </div>

      <div className="pp-tasks">
        <div className="pp-section-label">Active</div>
        {summary.active.map((t) => (
          <ActiveTaskRow
            key={t.id}
            task={t}
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
  onClick,
  onComplete,
}: {
  task: Task
  onClick: () => void
  onComplete: () => void
}) {
  const dueTxt = formatDue(task.dueAt)
  return (
    <div
      className="pp-task"
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
  onClick,
  onRestore,
}: {
  task: Task
  onClick: () => void
  onRestore: () => void
}) {
  return (
    <div
      className={`pp-task done`}
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