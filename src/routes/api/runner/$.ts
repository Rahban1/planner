import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { asc, eq } from 'drizzle-orm'
import { db, schema } from '#/db/index'
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
  claimAgentRun,
  completeAgentWorkflow,
  expireStaleAgentRuns,
} from '#/server/agent'
import { getTask } from '#/server/tasks'
import { getProject } from '#/server/projects'

// The runner bridge is machine-to-machine. When RUNNER_API_TOKEN is set
// (production), every request must present it as X-Runner-Token. When unset
// (local dev), requests are allowed through.
async function matchesRunnerToken(
  provided: string | null,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder()
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided ?? '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const left = new Uint8Array(providedHash)
  const right = new Uint8Array(expectedHash)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

async function authorizeRunner(request: Request): Promise<Response | null> {
  const token = (env as { RUNNER_API_TOKEN?: string }).RUNNER_API_TOKEN
  if (!token) return null
  if (!(await matchesRunnerToken(request.headers.get('X-Runner-Token'), token))) {
    return new Response('Unauthorized', { status: 401 })
  }
  return null
}

export const Route = createFileRoute('/api/runner/$')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const denied = await authorizeRunner(request)
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
          const messages = await db
            .select()
            .from(schema.taskMessages)
            .where(eq(schema.taskMessages.taskId, taskId))
            .orderBy(asc(schema.taskMessages.createdAt))
          return Response.json({
            title: task.title,
            notes: task.notes,
            priority: task.priority,
            projectName: project.name,
            repoUrl: project.repoUrl,
            repoUrls: project.repoUrls,
            approvedPlanMd: approvedPlan?.planMd ?? null,
            messages: messages.map((message) => ({
              authorType: message.authorType,
              kind: message.kind,
              body: message.body,
              createdAt: message.createdAt,
            })),
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
        const denied = await authorizeRunner(request)
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

        if (rest === 'claim') {
          const runId = typeof body.runId === 'string' ? body.runId : ''
          const jobId = typeof body.jobId === 'string' ? body.jobId : undefined
          const jobUrl = typeof body.jobUrl === 'string' ? body.jobUrl : undefined
          if (!runId) return new Response('Invalid run ID', { status: 400 })
          const result = await claimAgentRun({ data: { runId, jobId, jobUrl } })
          return Response.json(result)
        }

        if (rest === 'workflow-complete') {
          const runId = typeof body.runId === 'string' ? body.runId : ''
          const outcome = body.outcome
          const jobId = typeof body.jobId === 'string' ? body.jobId : ''
          const jobUrl = typeof body.jobUrl === 'string' ? body.jobUrl : ''
          if (
            !runId ||
            (outcome !== 'success' &&
              outcome !== 'failure' &&
              outcome !== 'cancelled') ||
            !jobId ||
            !jobUrl
          ) {
            return new Response('Invalid workflow result', { status: 400 })
          }
          const result = await completeAgentWorkflow({
            data: { runId, outcome, jobId, jobUrl },
          })
          return Response.json(result)
        }

        if (rest === 'expire-stale') {
          const result = await expireStaleAgentRuns()
          return Response.json(result)
        }

        if (rest === 'task-message') {
          const taskId = typeof body.taskId === 'string' ? body.taskId : ''
          const messageBody = typeof body.body === 'string' ? body.body.trim() : ''
          const kind = typeof body.kind === 'string' ? body.kind : 'progress'
          if (!taskId || !messageBody) return new Response('Invalid message', { status: 400 })
          const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId))
          if (!task) return new Response('Task not found', { status: 404 })
          const now = Date.now()
          const messageId = crypto.randomUUID()
          await db.insert(schema.taskMessages).values({
            id: messageId,
            taskId,
            authorType: 'agent',
            authorUserId: null,
            kind: kind as 'answer' | 'progress' | 'pr' | 'error',
            body: messageBody,
            metadata: null,
            clientMessageId: null,
            createdAt: now,
            updatedAt: now,
          })
          await db.update(schema.tasks).set({ lastMessageAt: now, updatedAt: now }).where(eq(schema.tasks.id, taskId))
          return Response.json({ ok: true, id: messageId })
        }

        return new Response('Not found', { status: 404 })
      },
    },
  },
})
