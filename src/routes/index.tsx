import { createFileRoute, useLoaderData, useNavigate } from '@tanstack/react-router'
import { PriorityPanel } from '#/components/PriorityPanel'
import { ProjectColumn } from '#/components/ProjectColumn'
import {
  usePriority,
  useProjects,
  useProjectSummary,
  useCompleteTaskMutation,
  useUncompleteTaskMutation
  
  
  
  
} from '#/lib/queries'
import type {Project, PriorityCard, Task, TaskWithSubtasks} from '#/lib/queries';
import { useUI } from '#/lib/ui-context'
import { listPriority } from '#/server/priority'
import { listProjects } from '#/server/projects'
import { listProjectSummary } from '#/server/tasks'

type ProjectSummary = { active: TaskWithSubtasks[]; completed: Task[] }

export const Route = createFileRoute('/')({
  loader: async () => {
    const [priority, projects] = await Promise.all([listPriority(), listProjects()])
    const summaryResults = await Promise.all(
      projects.map((p) => listProjectSummary({ data: { projectId: p.id } })),
    )
    const summaries: Record<string, ProjectSummary> = {}
    projects.forEach((p, i) => {
      summaries[p.id] = summaryResults[i] as ProjectSummary
    })
    return { priority, projects, summaries }
  },
  component: Dashboard,
})

function Dashboard() {
  const priorityRes = usePriority()
  const projectsRes = useProjects()
  const completeMut = useCompleteTaskMutation()
  const uncompleteMut = useUncompleteTaskMutation()
  const ui = useUI()
  const navigate = useNavigate()
  const loaderData = useLoaderData({ from: '/' })

  const priorities: PriorityCard[] = priorityRes.data ?? loaderData.priority ?? []
  const projects: Project[] = projectsRes.data ?? loaderData.projects ?? []
  const loaderSummaries = loaderData.summaries ?? {}

  return (
    <main className="dashboard">
      <PriorityPanel
        items={priorities}
        onTaskClick={(id) => {
          const project = priorities.find((t) => t.id === id)?.project
          ui.openTask(id, project?.name, project?.repoUrl)
        }}
      />

      <div className="columns-wrap">
        <div className="columns-head">
          <span className="label">Projects</span>
          <span className="add-proj">+ new project</span>
        </div>

        <div className="columns">
          {projects.map((project) => (
            <ColumnLoader
              key={project.id}
              project={project}
              initialSummary={loaderSummaries[project.id]}
              onTaskClick={(tid) => ui.openTask(tid, project.name, project.repoUrl)}
              onProjectClick={() => navigate({ to: '/projects/$id', params: { id: project.id } })}
              onTaskComplete={(tid) => completeMut.mutate({ data: { id: tid } })}
              onUncomplete={(tid) => uncompleteMut.mutate({ data: { id: tid } })}
              onAddTask={() => ui.openNewTask(project.id, project.name, project.repoUrl)}
            />
          ))}
          <div className="add-card" onClick={() => ui.openNewTask('')} role="button" tabIndex={0}>
            + new project
          </div>
        </div>
      </div>
    </main>
  )
}

function ColumnLoader(props: {
  project: Project
  initialSummary?: { active: TaskWithSubtasks[]; completed: Task[] }
  onTaskClick: (taskId: string) => void
  onProjectClick: () => void
  onTaskComplete: (taskId: string) => void
  onUncomplete: (taskId: string) => void
  onAddTask: () => void
}) {
  const summaryRes = useProjectSummary(props.project.id)
  const summary =
    summaryRes.data ??
    props.initialSummary ??
    ({ active: [] as TaskWithSubtasks[], completed: [] as Task[] } as const)
  return (
    <ProjectColumn
      project={props.project}
      active={summary.active}
      completed={summary.completed}
      onTaskClick={props.onTaskClick}
      onProjectClick={props.onProjectClick}
      onTaskComplete={props.onTaskComplete}
      onUncomplete={props.onUncomplete}
      onAddTask={props.onAddTask}
    />
  )
}