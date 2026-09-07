import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft, ExternalLink, Plus, Settings, Users } from 'lucide-react'
import { TaskList } from '#/components/workflow/TaskList'
import { useProject } from '#/lib/queries'
import { useWorkflowTasks } from '#/lib/workflow-queries'
import { useUI } from '#/lib/ui-context'
import { getCurrentUser, getProject } from '#/server/projects'

export const Route = createFileRoute('/projects/$id')({
  loader: async ({ params, location }) => {
    if (!(await getCurrentUser()))
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
          error: undefined,
          detail: undefined,
        },
      })
    return getProject({ data: { id: params.id } })
  },
  component: ProjectRoute,
})
function ProjectRoute() {
  const { id } = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  return pathname.replace(/\/$/, '') !==
    `/projects/${encodeURIComponent(id)}` ? (
    <Outlet />
  ) : (
    <ProjectPage />
  )
}
function ProjectPage() {
  const { id } = Route.useParams()
  const initial = Route.useLoaderData()
  const query = useProject(id)
  const project = query.data ?? initial
  const workflow = useWorkflowTasks()
  const ui = useUI()
  const [showDone, setShowDone] = useState(false)
  const tasks = (workflow.data ?? []).filter(
    (task) => task.projectId === id && (showDone || task.state !== 'done'),
  )
  if (!project)
    return (
      <main className="wf-page">
        <h1>Project not found</h1>
        <Link to="/projects">Back to projects</Link>
      </main>
    )
  return (
    <main className="wf-page">
      <Link to="/projects" className="wf-back">
        <ArrowLeft size={16} />
        Projects
      </Link>
      <header className="wf-page-head">
        <div>
          <p className="wf-eyebrow">Project</p>
          <h1>{project.name}</h1>
          <p>
            {project.repoUrls.length} connected{' '}
            {project.repoUrls.length === 1 ? 'repository' : 'repositories'}
          </p>
        </div>
        <div className="wf-actions">
          <button
            className="wf-icon-button"
            aria-label="Project members"
            onClick={() => ui.openMembers(id)}
          >
            <Users size={19} />
          </button>
          <button
            className="wf-icon-button"
            aria-label="Project settings"
            onClick={() => ui.openProjectModal(id)}
          >
            <Settings size={19} />
          </button>
          <Link
            to="/new-task"
            search={{ project: id }}
            className="wf-button wf-primary"
          >
            <Plus size={18} />
            New task
          </Link>
        </div>
      </header>
      <details className="wf-project-context">
        <summary>Repositories and working rules</summary>
        <div className="wf-repo-links">
          {project.repoUrls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer">
              {url.replace('https://github.com/', '')}
              <ExternalLink size={14} />
            </a>
          ))}
        </div>
        {!project.repoUrls.length && (
          <p>Add a repository in project settings to start planning.</p>
        )}
        {project.instructions && (
          <p className="wf-rules">{project.instructions}</p>
        )}
        <button
          className="wf-text-button"
          onClick={() => ui.openProjectModal(id)}
        >
          Edit project settings
        </button>
      </details>
      <div className="wf-list-toolbar">
        <h2>Tasks</h2>
        <label className="wf-check">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Include completed
        </label>
      </div>
      {workflow.isError ? (
        <div className="wf-notice wf-error" role="alert">
          Could not load tasks.{' '}
          <button onClick={() => workflow.refetch()}>Try again</button>
        </div>
      ) : workflow.isPending ? (
        <p role="status">Loading tasks…</p>
      ) : tasks.length ? (
        <TaskList tasks={tasks} showProject={false} />
      ) : (
        <section className="wf-empty">
          <h2>Start with an outcome</h2>
          <p>
            Describe what you need. Review the plan before the agent changes
            your code.
          </p>
          <Link
            className="wf-button wf-primary"
            to="/new-task"
            search={{ project: id }}
          >
            New task
            <Plus size={16} />
          </Link>
        </section>
      )}
    </main>
  )
}
