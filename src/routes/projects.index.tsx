import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ArrowRight, Folder, Plus, Settings } from 'lucide-react'
import { useProjects } from '#/lib/queries'
import { useUI } from '#/lib/ui-context'
import { getCurrentUser, listProjects } from '#/server/projects'

export const Route = createFileRoute('/projects/')({
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
    return listProjects()
  },
  component: Projects,
})
function Projects() {
  const query = useProjects()
  const initial = Route.useLoaderData()
  const projects = query.data ?? initial
  const ui = useUI()
  return (
    <main className="wf-page">
      <header className="wf-page-head">
        <div>
          <p className="wf-eyebrow">Your workspace</p>
          <h1>Projects</h1>
          <p>Set up repositories once. Keep the work together.</p>
        </div>
        <button
          className="wf-button wf-primary"
          onClick={() => ui.openProjectModal()}
        >
          <Plus size={18} />
          New project
        </button>
      </header>
      {query.isError && (
        <div className="wf-notice wf-error" role="alert">
          Could not refresh projects.{' '}
          <button onClick={() => query.refetch()}>Try again</button>
        </div>
      )}
      <div className="wf-project-list">
        {projects.map((project) => (
          <div className="wf-project-row" key={project.id}>
            <Link to="/projects/$id" params={{ id: project.id }}>
              <Folder size={22} />
              <span>
                <strong>{project.name}</strong>
                <small>
                  {project.repoUrls.length}{' '}
                  {project.repoUrls.length === 1
                    ? 'repository'
                    : 'repositories'}
                  <span className="wf-repo-preview">
                    {project.repoUrls
                      .map((url) =>
                        url
                          .replace('https://github.com/', '')
                          .replace(/\.git$/, ''),
                      )
                      .join(' · ')}
                  </span>
                </small>
              </span>
              <ArrowRight size={18} />
            </Link>
            <button
              className="wf-icon-button"
              aria-label={`Settings for ${project.name}`}
              onClick={() => ui.openProjectModal(project.id)}
            >
              <Settings size={18} />
            </button>
          </div>
        ))}
      </div>
      {!projects.length && (
        <section className="wf-empty">
          <span className="wf-empty-icon">
            <Folder size={26} />
          </span>
          <h2>Your work starts here</h2>
          <p>A project connects your repositories, plans, and pull requests.</p>
          <button
            className="wf-button wf-primary"
            onClick={() => ui.openProjectModal()}
          >
            Create your first project
          </button>
        </section>
      )}
    </main>
  )
}
