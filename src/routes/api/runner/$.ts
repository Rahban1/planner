import { createFileRoute } from '@tanstack/react-router'
import {
  giveTaskToAgent,
  getAgentRun,
  updateAgentRun,
  listQueuedAgentRuns,
} from '#/server/agent'
import { getTask } from '#/server/tasks'
import { getProject } from '#/server/projects'

export const Route = createFileRoute('/api/runner/$')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const rest = params._splat ?? ''

        if (rest === 'queue') {
          const result = await listQueuedAgentRuns()
          return Response.json(result)
        }

        if (rest.startsWith('task-context/')) {
          const taskId = rest.replace('task-context/', '')
          const task = await getTask({ data: { id: taskId } })
          if (!task) return new Response('Task not found', { status: 404 })
          const project = await getProject({ data: { id: task.projectId } })
          if (!project) return new Response('Project not found', { status: 404 })
          return Response.json({
            title: task.title,
            notes: task.notes,
            priority: task.priority,
            projectName: project.name,
            repoUrl: project.repoUrl,
          })
        }

        if (rest.startsWith('runs/')) {
          const id = rest.replace('runs/', '')
          const result = await getAgentRun({ data: { id } })
          return Response.json(result)
        }

        return new Response('Not found', { status: 404 })
      },
      POST: async ({ params, request }) => {
        const rest = params._splat ?? ''
        const body = (await request.json()) as Record<string, unknown>

        if (rest === 'give-task') {
          const result = await giveTaskToAgent({ data: body as { taskId: string } })
          return Response.json(result)
        }

        if (rest === 'update-run') {
          const result = await updateAgentRun({ data: body as Parameters<typeof updateAgentRun>[0]['data'] })
          return Response.json(result)
        }

        return new Response('Not found', { status: 404 })
      },
    },
  },
})
