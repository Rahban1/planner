import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '#/db/index'
import { env } from 'cloudflare:workers'
import type { TaskMessage, User } from '#/db/schema'
import { getUserFromCookie } from './auth'
import { requireUser } from './auth-middleware'
import { askAgentQuestion, giveTaskToAgent, planTask } from './agent'

const id = () => crypto.randomUUID()

async function broadcastTaskEvent(taskId: string, event: unknown) {
  const namespace = (env as Env & { TASK_CHAT_ROOMS?: DurableObjectNamespace }).TASK_CHAT_ROOMS
  if (!namespace) return
  try {
    const stub = namespace.get(namespace.idFromName(taskId))
    await stub.fetch('https://planner.internal/task-event', {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'content-type': 'application/json' },
    })
  } catch {
    // Realtime delivery is best effort. D1 is the source of truth and the
    // client uses polling when the local Durable Object is not available.
  }
}

function currentUser() {
  return getUserFromCookie(getRequestHeader('cookie') ?? null)
}

async function taskForUser(taskId: string, user: User) {
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
  if (!task) throw new Error('Task not found')

  const members = await db
    .select()
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.projectId, task.projectId))
  const isMember = members.some((member) => member.email.toLowerCase() === user.email.toLowerCase())
  // Existing projects may have no membership rows. Keep them usable until the
  // project owner accepts an invite, while all projects with members are gated.
  if (members.length > 0 && !isMember) throw new Error('Project membership required')
  return task
}

function titleFromMessage(body: string) {
  const firstLine = body.split(/\r?\n/)[0]?.trim() ?? body.trim()
  return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine
}

function intentFromMessage(body: string): 'question' | 'plan' | 'implement' | 'unclear' {
  const normalized = body.toLowerCase()
  if (!normalized.includes('@agent')) return 'unclear'
  if (/\b(plan|planning|approach|steps)\b/.test(normalized)) return 'plan'
  if (/\b(implement|fix|code|change|build|make|ship|pr|pull request)\b/.test(normalized)) return 'implement'
  return 'question'
}

async function insertMessage(values: {
  taskId: string
  authorType: 'user' | 'agent' | 'system'
  authorUserId?: string | null
  kind: TaskMessage['kind']
  body: string
  metadata?: Record<string, unknown>
  clientMessageId?: string | null
}) {
  const now = Date.now()
  const messageId = id()
  await db.insert(schema.taskMessages).values({
    id: messageId,
    taskId: values.taskId,
    authorType: values.authorType,
    authorUserId: values.authorUserId ?? null,
    kind: values.kind,
    body: values.body,
    metadata: values.metadata ? JSON.stringify(values.metadata) : null,
    clientMessageId: values.clientMessageId ?? null,
    createdAt: now,
    updatedAt: now,
  })
  await db
    .update(schema.tasks)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(schema.tasks.id, values.taskId))
  const [message] = await db
    .select()
    .from(schema.taskMessages)
    .where(eq(schema.taskMessages.id, messageId))
  await broadcastTaskEvent(values.taskId, { type: 'task.message.created', message })
  return message as TaskMessage
}

export const getTaskChat = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(
    z.object({
      taskId: z.string(),
      cursor: z.number().int().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await currentUser()
    if (!user) throw new Error('Unauthorized')
    await taskForUser(data.taskId, user)
    const conditions = [eq(schema.taskMessages.taskId, data.taskId)]
    if (data.cursor) conditions.push(gt(schema.taskMessages.createdAt, data.cursor))
    const messages = await db
      .select()
      .from(schema.taskMessages)
      .where(and(...conditions))
      .orderBy(asc(schema.taskMessages.createdAt))
      .limit(data.limit ?? 100)
    return { messages, nextCursor: messages.at(-1)?.createdAt ?? data.cursor ?? null }
  })

export const createTaskFromMessage = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      projectId: z.string(),
      body: z.string().trim().min(1).max(20_000),
      clientMessageId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await currentUser()
    if (!user) throw new Error('Unauthorized')
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, data.projectId))
    if (!project) throw new Error('Project not found')
    const now = Date.now()
    const taskId = id()
    await db.insert(schema.tasks).values({
      id: taskId,
      projectId: data.projectId,
      parentId: null,
      title: titleFromMessage(data.body),
      notes: null,
      priority: 'medium',
      status: 'todo',
      dueAt: null,
      position: 0,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      ownerUserId: user.id,
      lifecycleState: 'discussion',
      lastMessageAt: now,
      nextAction: 'Discuss the task or ask @agent for help',
    })
    const message = await insertMessage({
      taskId,
      authorType: 'user',
      authorUserId: user.id,
      kind: 'text',
      body: data.body,
      clientMessageId: data.clientMessageId,
    })
    return { taskId, message }
  })

export const sendTaskMessage = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      taskId: z.string(),
      body: z.string().trim().min(1).max(20_000),
      clientMessageId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await currentUser()
    if (!user) throw new Error('Unauthorized')
    await taskForUser(data.taskId, user)
    if (data.clientMessageId) {
      const [existing] = await db
        .select()
        .from(schema.taskMessages)
        .where(and(eq(schema.taskMessages.taskId, data.taskId), eq(schema.taskMessages.clientMessageId, data.clientMessageId)))
      if (existing) return { message: existing, actionMessage: null, intent: 'unclear' as const }
    }
    const message = await insertMessage({
      taskId: data.taskId,
      authorType: 'user',
      authorUserId: user.id,
      kind: 'text',
      body: data.body,
      clientMessageId: data.clientMessageId,
    })
    const intent = intentFromMessage(data.body)
    if (intent !== 'unclear') {
      const actionMessage = await insertMessage({
        taskId: data.taskId,
        authorType: 'system',
        kind: 'action_request',
        body:
          intent === 'implement'
            ? 'The agent detected an implementation request. Confirm to start repository changes.'
            : intent === 'plan'
              ? 'The agent will prepare a read-only plan.'
              : 'The agent will answer using the task context.',
        metadata: { intent, sourceMessageId: message.id, requiresConfirmation: intent === 'implement' },
      })
      if (intent === 'question') {
        await askAgentQuestion({ data: { taskId: data.taskId } })
      } else if (intent === 'plan') {
        await planTask({ data: { taskId: data.taskId } })
        await db.update(schema.tasks).set({ lifecycleState: 'planning', nextAction: 'Review the agent plan', updatedAt: Date.now() }).where(eq(schema.tasks.id, data.taskId))
      }
      return { message, actionMessage, intent }
    }
    return { message, actionMessage: null, intent }
  })

export const confirmAgentAction = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ messageId: z.string() }))
  .handler(async ({ data }) => {
    const user = await currentUser()
    if (!user) throw new Error('Unauthorized')
    const [message] = await db
      .select()
      .from(schema.taskMessages)
      .where(eq(schema.taskMessages.id, data.messageId))
    if (!message || message.kind !== 'action_request') throw new Error('Action request not found')
    await taskForUser(message.taskId, user)
    const metadata = message.metadata
      ? (JSON.parse(message.metadata) as { intent?: string; sourceMessageId?: string })
      : {}
    if (metadata.intent !== 'implement') throw new Error('Only implementation actions require confirmation')
    const run = await giveTaskToAgent({ data: { taskId: message.taskId } })
    await db
      .update(schema.agentRuns)
      .set({ confirmationMessageId: message.id, approvedByUserId: user.id, triggerMessageId: metadata.sourceMessageId ?? null })
      .where(eq(schema.agentRuns.id, run.id))
    await insertMessage({
      taskId: message.taskId,
      authorType: 'system',
      kind: 'progress',
      body: 'Implementation confirmed. The agent is starting the repository run.',
      metadata: { runId: run.id },
    })
    return run
  })

export const requestAgentPlan = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const user = await currentUser()
    if (!user) throw new Error('Unauthorized')
    await taskForUser(data.taskId, user)
    const run = await planTask({ data: { taskId: data.taskId } })
    await db
      .update(schema.tasks)
      .set({ lifecycleState: 'planning', nextAction: 'Review the agent plan', updatedAt: Date.now() })
      .where(eq(schema.tasks.id, data.taskId))
    return run
  })

export const markTaskChatRead = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string(), messageId: z.string().nullable() }))
  .handler(async ({ data }) => {
    const user = await currentUser()
    if (!user) throw new Error('Unauthorized')
    await taskForUser(data.taskId, user)
    const now = Date.now()
    await db
      .insert(schema.taskMessageReads)
      .values({ taskId: data.taskId, userId: user.id, lastReadMessageId: data.messageId, updatedAt: now })
      .onConflictDoUpdate({ target: [schema.taskMessageReads.taskId, schema.taskMessageReads.userId], set: { lastReadMessageId: data.messageId, updatedAt: now } })
    return { ok: true }
  })

export const listTaskUnread = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const user = await currentUser()
    if (!user) throw new Error('Unauthorized')
    await taskForUser(data.taskId, user)
    const [read] = await db.select().from(schema.taskMessageReads).where(and(eq(schema.taskMessageReads.taskId, data.taskId), eq(schema.taskMessageReads.userId, user.id)))
    const messages = await db.select({ id: schema.taskMessages.id }).from(schema.taskMessages).where(and(eq(schema.taskMessages.taskId, data.taskId), read?.lastReadMessageId ? gt(schema.taskMessages.createdAt, (await db.select({ createdAt: schema.taskMessages.createdAt }).from(schema.taskMessages).where(eq(schema.taskMessages.id, read.lastReadMessageId)).then((rows) => rows[0]?.createdAt ?? 0))) : isNull(schema.taskMessages.authorUserId)))
    return { count: messages.length }
  })
