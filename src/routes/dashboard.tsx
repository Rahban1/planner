import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowRight, Check, Plus, Search } from 'lucide-react'
import { TaskList } from '#/components/workflow/TaskList'
import { useWorkflowTasks } from '#/lib/workflow-queries'
import { useProjects } from '#/lib/queries'
import { useUI } from '#/lib/ui-context'
import { getCurrentUser, listProjects } from '#/server/projects'
import { listWorkflowTasks } from '#/server/workflow'

export const Route = createFileRoute('/dashboard')({
  loader: async ({ location }) => {
    if (!(await getCurrentUser()))
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
          error: undefined,
          detail: undefined,
        },
      })
    const [tasks, projects] = await Promise.all([
      listWorkflowTasks(),
      listProjects(),
    ])
    return { tasks, projects }
  },
  component: Dashboard,
})
function Dashboard() {
  const initial = Route.useLoaderData()
  const query = useWorkflowTasks()
  const projectsQuery = useProjects()
  const tasks = query.data ?? initial.tasks
  const projects = projectsQuery.data ?? initial.projects
  const ui = useUI()
  const [view, setView] = useState<'attention' | 'working' | 'all'>('attention')
  const [search, setSearch] = useState('')
  const attention = tasks.filter((t) => t.needsYou && t.state !== 'done')
  const working = tasks.filter(
    (t) => t.state === 'planning' || t.state === 'building',
  )
  const visible = (
    view === 'attention' ? attention : view === 'working' ? working : tasks
  ).filter((t) =>
    `${t.title} ${t.projectName}`.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <main className="wf-page">
      <header className="wf-page-head">
        <div>
          <p className="wf-eyebrow">Your workspace</p>
          <h1>Needs you</h1>
          <p>Plan the work. Review the result.</p>
        </div>
        <Link
          to="/new-task"
          search={{ project: undefined }}
          className="wf-button wf-primary"
        >
          <Plus size={18} />
          New task
        </Link>
      </header>
      <div className="wf-list-toolbar">
        <div className="wf-segments" aria-label="Task filter">
          <button
            aria-pressed={view === 'attention'}
            onClick={() => setView('attention')}
          >
            Needs you <span>{attention.length}</span>
          </button>
          <button
            aria-pressed={view === 'working'}
            onClick={() => setView('working')}
          >
            Working <span>{working.length}</span>
          </button>
          <button aria-pressed={view === 'all'} onClick={() => setView('all')}>
            All tasks
          </button>
        </div>
        <label className="wf-filter">
          <Search size={16} />
          <input
            aria-label="Filter tasks"
            placeholder="Find a task…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {query.isError && (
        <div role="alert" className="wf-notice wf-error">
          Could not refresh tasks.{' '}
          <button onClick={() => query.refetch()}>Try again</button>
        </div>
      )}
      {visible.length ? (
        <TaskList tasks={visible} />
      ) : (
        <section className="wf-empty">
          <span className="wf-empty-icon">
            <Check size={26} />
          </span>
          <h2>
            {search
              ? 'No matching tasks'
              : !projects.length
                ? 'Start with a project'
                : !tasks.length
                  ? 'What would you like to build?'
                  : view === 'working'
                    ? 'No work is running'
                    : 'You are up to date'}
          </h2>
          <p>
            {search
              ? 'Try another task or project name.'
              : !projects.length
                ? 'Connect the repositories for your first project. Then describe a task.'
                : !tasks.length
                  ? 'Describe the outcome. The agent will prepare a plan for you to review.'
                  : view === 'working'
                    ? 'Approve a plan to start implementation.'
                    : 'Your next plan or code review will appear here.'}
          </p>
          {!projects.length ? (
            <button
              className="wf-button wf-primary"
              onClick={() => ui.openProjectModal()}
            >
              Create project
            </button>
          ) : !tasks.length ? (
            <Link
              className="wf-button wf-primary"
              to="/new-task"
              search={{ project: undefined }}
            >
              Start a task
              <ArrowRight size={16} />
            </Link>
          ) : (
            <Link className="wf-button" to="/projects">
              Open projects
              <ArrowRight size={16} />
            </Link>
          )}
        </section>
      )}
      <footer className="wf-page-foot">
        <span>Running work continues when you close this page.</span>
        <Link to="/agent-runs">
          Run history
          <ArrowRight size={14} />
        </Link>
      </footer>
    </main>
  )
}
