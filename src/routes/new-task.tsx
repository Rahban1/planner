import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, LoaderCircle } from 'lucide-react'
import { useProjects } from '#/lib/queries'
import { useUI } from '#/lib/ui-context'
import { getCurrentUser, listProjects } from '#/server/projects'
import { createTaskFromMessage } from '#/server/chat'

export const Route = createFileRoute('/new-task')({
  validateSearch: (search: Record<string, unknown>) => ({
    project: typeof search.project === 'string' ? search.project : undefined,
  }),
  loader: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user)
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
          error: undefined,
          detail: undefined,
        },
      })
    return { user, projects: await listProjects() }
  },
  component: NewTask,
})
function NewTask() {
  const initial = Route.useLoaderData()
  const search = Route.useSearch()
  const projectsQuery = useProjects()
  const projects = projectsQuery.data ?? initial.projects
  const [projectId, setProjectId] = useState(
    search.project ?? projects[0]?.id ?? '',
  )
  const [body, setBody] = useState('')
  const [online, setOnline] = useState(true)
  const [draftReady, setDraftReady] = useState(false)
  const [draftSaved, setDraftSaved] = useState(false)
  const sent = useRef(false)
  const clientId = useRef(crypto.randomUUID())
  const draftKey = `planner-new-task:${initial.user.id}`
  const ui = useUI()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const create = useMutation({ mutationFn: createTaskFromMessage })
  const project = projects.find((item) => item.id === projectId)
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || 'null')
      if (draft && typeof draft.body === 'string') {
        setBody(draft.body)
        if (!search.project && typeof draft.projectId === 'string')
          setProjectId(draft.projectId)
        if (typeof draft.clientId === 'string')
          clientId.current = draft.clientId
      }
    } catch {
      /* A draft can be unavailable in private browsing. */
    }
    setDraftReady(true)
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [draftKey, search.project])
  useEffect(() => {
    if (!draftReady || sent.current) return
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ body, projectId, clientId: clientId.current }),
      )
      setDraftSaved(Boolean(body.trim()))
    } catch {
      setDraftSaved(false)
    }
  }, [body, projectId, draftKey, draftReady])
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id)
  }, [projects, projectId])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!body.trim() || !project || !online || create.isPending) return
    try {
      const result = await create.mutateAsync({
        data: {
          projectId,
          body: body.trim(),
          clientMessageId: clientId.current,
        },
      })
      sent.current = true
      try {
        localStorage.removeItem(draftKey)
      } catch {
        /* Navigation can continue without draft storage. */
      }
      await queryClient.invalidateQueries({ queryKey: ['workflow-tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['projects', projectId] })
      await navigate({
        to: '/projects/$id/tasks/$taskId',
        params: { id: projectId, taskId: result.taskId },
      })
    } catch {
      /* The mutation error stays visible below the composer. */
    }
  }
  return (
    <main className="wf-page wf-new-task">
      <Link to="/dashboard" className="wf-back">
        <ArrowLeft size={16} />
        Workspace
      </Link>
      <header className="wf-page-head">
        <div>
          <p className="wf-eyebrow">A new task</p>
          <h1>What should we build?</h1>
          <p>Describe the outcome. Work through the plan together.</p>
        </div>
      </header>
      {!projects.length ? (
        <section className="wf-empty">
          <h2>Connect your first project</h2>
          <p>Add the repositories that the agent can use for your work.</p>
          <button
            className="wf-button wf-primary"
            onClick={() => ui.openProjectModal()}
          >
            Create project
          </button>
        </section>
      ) : (
        <form onSubmit={submit} className="wf-composer-card">
          <label className="wf-field-label" htmlFor="new-task-project">
            Project
          </label>
          <select
            id="new-task-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={create.isPending}
          >
            <option value="" disabled>
              Select a project
            </option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <div className="wf-project-hint">
            <span>
              {project
                ? `${project.repoUrls.length} connected ${project.repoUrls.length === 1 ? 'repository' : 'repositories'}`
                : 'Select a project to continue'}
            </span>
            {project && (
              <button
                type="button"
                className="wf-text-button"
                onClick={() => ui.openProjectModal(project.id)}
              >
                Project settings
              </button>
            )}
          </div>
          <label className="wf-field-label" htmlFor="new-task-message">
            What do you need?
          </label>
          <textarea
            id="new-task-message"
            autoFocus
            rows={8}
            maxLength={20000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={create.isPending}
            placeholder="Describe a change, a problem to solve, or an idea to explore…"
          />
          <p className="wf-composer-help">
            Include the outcome and any limits. The agent will read the
            repositories and prepare a plan. Code changes start after you
            approve it.
          </p>
          {!online && (
            <p className="wf-notice" role="status">
              You are offline. Your draft stays on this device.
            </p>
          )}
          {project && !project.repoUrls.length && (
            <p className="wf-notice">
              Add a repository in project settings to start planning.
            </p>
          )}
          {create.isError && (
            <p className="wf-notice wf-error" role="alert">
              {create.error.message ||
                'Could not create the task. Your draft is still here.'}
            </p>
          )}
          <div className="wf-composer-footer">
            <span>
              {draftSaved
                ? 'Draft saved on this device'
                : 'Your first message becomes the task'}
            </span>
            <button
              type="submit"
              className="wf-button wf-primary"
              disabled={
                !body.trim() ||
                !project?.repoUrls.length ||
                !online ||
                create.isPending
              }
            >
              {create.isPending ? (
                <>
                  <LoaderCircle size={17} className="wf-spin" />
                  Starting…
                </>
              ) : (
                <>
                  Start planning
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </main>
  )
}
