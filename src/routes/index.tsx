import { createFileRoute, useLoaderData, useNavigate } from '@tanstack/react-router'
import { useQueries } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { PriorityPanel } from '#/components/PriorityPanel'
import { ProjectColumn } from '#/components/ProjectColumn'
import {
  usePriority,
  useProjects,
  projectSummaryQueryOptions,
  useCompleteTaskMutation,
  useUncompleteTaskMutation,
  useDeleteTaskMutation,
  useDeleteProjectMutation,
} from '#/lib/queries'
import type {Project, PriorityCard, Task, TaskWithSubtasks} from '#/lib/queries';
import { useUI } from '#/lib/ui-context'
import { useFocus  } from '#/lib/focus-context'
import type {TaskActions} from '#/lib/focus-context';
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
  const deleteMut = useDeleteTaskMutation()
  const deleteProjectMut = useDeleteProjectMutation()
  const ui = useUI()
  const navigate = useNavigate()
  const focus = useFocus()
  const loaderData = useLoaderData({ from: '/' })

  const priorities: PriorityCard[] = priorityRes.data ?? loaderData.priority ?? []
  const projects: Project[] = projectsRes.data ?? loaderData.projects ?? []
  const loaderSummaries = loaderData.summaries ?? {}

  const summaryResults = useQueries({
    queries: projects.map((p) => projectSummaryQueryOptions(p.id)),
  })

  const summaries = useMemo(() => {
    return projects.map((p, i) => ({
      project: p,
      summary: summaryResults[i]?.data ?? loaderSummaries[p.id] ?? { active: [], completed: [] },
    }))
  }, [projects, summaryResults, loaderSummaries])

  // Register flat task list + handlers for keyboard navigation
  useEffect(() => {
    const taskIds: string[] = []
    const handlers: Record<string, TaskActions> = {}

    // --- Priority tasks (first in navigation order) ---
    for (const t of priorities) {
      taskIds.push(t.id)
      handlers[t.id] = {
        open: () => ui.openTask(t.id, t.project.name, t.project.repoUrl),
        complete: () => completeMut.mutate({ data: { id: t.id } }),
        delete: () => deleteMut.mutate({ data: { id: t.id } }),
      }
    }

    // --- Column tasks (left to right, top to bottom) ---
    for (const { project, summary } of summaries) {
      for (const t of summary.active) {
        taskIds.push(t.id)
        handlers[t.id] = {
          open: () => ui.openTask(t.id, project.name, project.repoUrl),
          complete: () => completeMut.mutate({ data: { id: t.id } }),
          delete: () => deleteMut.mutate({ data: { id: t.id } }),
        }
      }
    }

    focus.register(taskIds, handlers)
  }, [priorities, summaries, ui, completeMut, deleteMut, focus])

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
          <span
            className="add-proj"
            onClick={() => ui.openProjectModal()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') ui.openProjectModal()
            }}
          >
            + new project
          </span>
        </div>

        <div className="columns">
          {summaries.map(({ project, summary }) => (
            <ProjectColumn
              key={project.id}
              project={project}
              active={summary.active}
              completed={summary.completed}
              onTaskClick={(tid) => ui.openTask(tid, project.name, project.repoUrl)}
              onProjectClick={() => navigate({ to: '/projects/$id', params: { id: project.id } })}
              onTaskComplete={(tid) => completeMut.mutate({ data: { id: tid } })}
              onUncomplete={(tid) => uncompleteMut.mutate({ data: { id: tid } })}
              onAddTask={() => ui.openNewTask(project.id, project.name, project.repoUrl)}
              onProjectDelete={async () => {
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
                  {
                    onSuccess: () => {
                      const focusedInProject = summary.active.some((t) => t.id === focus.focusedTaskId)
                      if (focusedInProject) focus.clearFocus()
                    },
                  },
                )
              }}
            />
          ))}
          <div
            className="add-card"
            onClick={() => ui.openProjectModal()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') ui.openProjectModal()
            }}
          >
            + new project
          </div>
        </div>
      </div>
    </main>
  )
}