import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import {
  giveTaskToAgent,
  planTask,
  approvePlan,
  requestPlanChanges,
  getLatestApprovedPlan,
  getAgentRun,
  updateAgentRun,
  listQueuedAgentRuns,
  listAwaitingMergeRuns,
} from '#/server/agent'
import { getTask } from '#/server/tasks'
import { getProject } from '#/server/projects'

// The runner bridge is machine-to-machine. When RUNNER_API_TOKEN is set
// (production), every request must present it as X-Runner-Token. When unset
// (local dev), requests are allowed through.
function authorizeRunner(request: Request): Response | null {
  const token = (env as { RUNNER_API_TOKEN?: string }).RUNNER_API_TOKEN
  if (!token) return null
  if (request.headers.get('X-Runner-Token') !== token) {
    return new Response('Unauthorized', { status: 401 })
  }
  return null
}

export const Route = createFileRoute('/api/runner/$')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const denied = authorizeRunner(request)
        if (denied) return denied

        const rest = params._splat ?? ''

        if (rest === 'queue') {
          const result = await listQueuedAgentRuns()
          return Response.json(result)
        }

        if (rest === 'awaiting-merge') {
          const result = await listAwaitingMergeRuns()
          return Response.json(result)
        }

        if (rest.startsWith('task-context/')) {
          const taskId = rest.replace('task-context/', '')
          const task = await getTask({ data: { id: taskId } })
          if (!task) return new Response('Task not found', { status: 404 })
          const project = await getProject({ data: { id: task.projectId } })
          if (!project) return new Response('Project not found', { status: 404 })
          const approvedPlan = await getLatestApprovedPlan({ data: { taskId } }).catch(
            () => undefined,
          )
          return Response.json({
            title: task.title,
            notes: task.notes,
            priority: task.priority,
            projectName: project.name,
            repoUrl: project.repoUrl,
            approvedPlanMd: approvedPlan?.planMd ?? null,
            attachments: task.attachments.map((a) => ({
              id: a.id,
              name: a.name,
              mimeType: a.mimeType,
              path: `/api/attachments/${a.id}`,
            })),
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
        const denied = authorizeRunner(request)
        if (denied) return denied

        const rest = params._splat ?? ''
        const body = (await request.json()) as Record<string, unknown>

        if (rest === 'give-task') {
          const result = await giveTaskToAgent({ data: body as { taskId: string } })
          return Response.json(result)
        }

        if (rest === 'plan-task') {
          const result = await planTask({ data: body as { taskId: string } })
          return Response.json(result)
        }

        if (rest === 'approve-plan') {
          const result = await approvePlan({ data: body as { runId: string } })
          return Response.json(result)
        }

        if (rest === 'request-changes') {
          const result = await requestPlanChanges({
            data: body as { runId: string; feedback: string },
          })
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
