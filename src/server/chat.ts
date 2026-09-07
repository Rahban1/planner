import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db, runtimeEnv, schema } from '#/db/index'
import type { TaskMessage } from '#/db/schema'
import { requireUser } from './auth-middleware'
import {
  requireCurrentUser,
  requireProjectAccess,
  requireTaskAccess,
} from './access.server'
import { queueWorkflowRun } from './agent-queue.server'
import { validateReviewAction } from './review.server'
import { giveTaskToAgent, planTask } from './agent'

const id = () => crypto.randomUUID()
const selectionSchema = z.object({
  repoUrl: z.string().url().optional(),
  path: z.string().min(1).max(1000).optional(),
  line: z.number().int().positive().optional(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  headSha: z
    .string()
    .regex(/^[a-f0-9]{40,64}$/i)
    .optional(),
})
const messageSchema = z.object({
  taskId: z.string().min(1),
  body: z.string().trim().min(1).max(20_000),
  clientMessageId: z.string().min(1).max(100).optional(),
  mode: z.enum(['discuss', 'plan', 'question', 'change']).optional(),
  sourceRunId: z.string().optional(),
  context: selectionSchema.optional(),
})

async function broadcastTaskEvent(taskId: string, event: unknown) {
  const namespace = runtimeEnv.TASK_CHAT_ROOMS
  if (!namespace) return
  try {
    await namespace
      .get(namespace.idFromName(taskId))
      .fetch('https://planner.internal/task-event', {
        method: 'POST',
        body: JSON.stringify(event),
        headers: { 'content-type': 'application/json' },
      })
  } catch {
    /* D1 remains the source of truth. Clients also poll. */
  }
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
  const t = Date.now()
  const messageId = id()
  await db
    .insert(schema.taskMessages)
    .values({
      id: messageId,
      taskId: values.taskId,
      authorType: values.authorType,
      authorUserId: values.authorUserId ?? null,
      kind: values.kind,
      body: values.body,
      metadata: values.metadata ? JSON.stringify(values.metadata) : null,
      clientMessageId: values.clientMessageId ?? null,
      createdAt: t,
      updatedAt: t,
    })
    .onConflictDoNothing()
  await db
    .update(schema.tasks)
    .set({ lastMessageAt: t, updatedAt: t })
    .where(eq(schema.tasks.id, values.taskId))
  const [message] = await db
    .select()
    .from(schema.taskMessages)
    .where(
      values.clientMessageId
        ? and(
            eq(schema.taskMessages.taskId, values.taskId),
            eq(schema.taskMessages.clientMessageId, values.clientMessageId),
          )
        : eq(schema.taskMessages.id, messageId),
    )
  await broadcastTaskEvent(values.taskId, {
    type: 'task.message.created',
    message,
  })
  return message
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
    await requireTaskAccess(data.taskId)
    const conditions = [eq(schema.taskMessages.taskId, data.taskId)]
    if (data.cursor !== undefined)
      conditions.push(gt(schema.taskMessages.createdAt, data.cursor))
    const messages = await db
      .select()
      .from(schema.taskMessages)
      .where(and(...conditions))
      .orderBy(
        data.cursor !== undefined
          ? asc(schema.taskMessages.createdAt)
          : desc(schema.taskMessages.createdAt),
        data.cursor !== undefined
          ? asc(schema.taskMessages.id)
          : desc(schema.taskMessages.id),
      )
      .limit(data.limit ?? 100)
    if (data.cursor === undefined) messages.reverse()
    return {
      messages,
      nextCursor: messages.at(-1)?.createdAt ?? data.cursor ?? null,
    }
  })

export const createTaskFromMessage = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      projectId: z.string(),
      body: z.string().trim().min(1).max(20_000),
      clientMessageId: z.string().min(1).max(100).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireCurrentUser()
    await requireProjectAccess(data.projectId, user)
    const t = Date.now()
    const requestKey = data.clientMessageId
      ? new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(
              JSON.stringify([user.id, data.projectId, data.clientMessageId]),
            ),
          ),
        )
      : null
    const taskId = requestKey
      ? `task-${Array.from(requestKey)
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('')}`
      : id()
    const messageId = id()
    const firstLine = data.body.split(/\r?\n/)[0].trim()
    await db.batch([
      db
        .insert(schema.tasks)
        .values({
          id: taskId,
          projectId: data.projectId,
          title:
            firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine,
          priority: 'medium',
          status: 'todo',
          position: 0,
          createdAt: t,
          updatedAt: t,
          ownerUserId: user.id,
          lifecycleState: 'discussion',
          lastMessageAt: t,
          nextAction: 'The agent will prepare a plan',
        })
        .onConflictDoNothing(),
      db
        .insert(schema.taskMessages)
        .values({
          id: messageId,
          taskId,
          authorType: 'user',
          authorUserId: user.id,
          kind: 'text',
          body: data.body,
          metadata: JSON.stringify({ mode: 'plan' }),
          clientMessageId: data.clientMessageId ?? null,
          createdAt: t,
          updatedAt: t,
        })
        .onConflictDoNothing(),
    ])
    const [message] = await db
      .select()
      .from(schema.taskMessages)
      .where(eq(schema.taskMessages.taskId, taskId))
      .orderBy(asc(schema.taskMessages.createdAt))
      .limit(1)
    if (message.body !== data.body)
      throw new Error('This request was already used for another task message')
    await broadcastTaskEvent(taskId, { type: 'task.message.created', message })
    let dispatchError: string | null = null
    let run = null
    try {
      run = await queueWorkflowRun(taskId, 'plan', {
        triggerMessageId: message.id,
      })
      dispatchError = run.dispatchError
    } catch (error) {
      dispatchError =
        error instanceof Error
          ? error.message
          : 'The task was saved, but planning could not start.'
    }
    return { taskId, projectId: data.projectId, message, run, dispatchError }
  })

export const sendTaskMessage = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(messageSchema)
  .handler(async ({ data }) => {
    const user = await requireCurrentUser()
    await requireTaskAccess(data.taskId, user)
    const mode = data.mode ?? 'discuss'
    const [existing] = data.clientMessageId
      ? await db
          .select()
          .from(schema.taskMessages)
          .where(
            and(
              eq(schema.taskMessages.taskId, data.taskId),
              eq(schema.taskMessages.clientMessageId, data.clientMessageId),
            ),
          )
      : []
    const stored = existing?.metadata
      ? (JSON.parse(existing.metadata) as {
          mode?: string
          review?: Awaited<ReturnType<typeof validateReviewAction>>
        })
      : null
    if (
      existing &&
      (existing.authorUserId !== user.id ||
        existing.body !== data.body ||
        stored?.mode !== mode)
    )
      throw new Error('This message request was already used')
    let review = stored?.review
    if (!existing && (mode === 'change' || data.sourceRunId))
      review = await validateReviewAction(
        data.taskId,
        data.sourceRunId,
        mode === 'change' ? 'change' : 'question',
        data.context,
      )
    const message =
      existing ??
      (await insertMessage({
        taskId: data.taskId,
        authorType: 'user',
        authorUserId: user.id,
        kind: 'text',
        body: data.body,
        clientMessageId: data.clientMessageId,
        metadata: { mode, ...(review ? { review } : {}) },
      }))
    const kind =
      mode === 'plan' ? 'plan' : mode === 'change' ? 'revise' : 'answer'
    let dispatchError: string | null = null
    let run = null
    try {
      run = await queueWorkflowRun(data.taskId, kind, {
        triggerMessageId: message.id,
        sourceRunId: review?.sourceRunId,
      })
      dispatchError = run.dispatchError
    } catch (error) {
      dispatchError =
        error instanceof Error
          ? error.message
          : 'The message was saved, but the agent could not start.'
    }
    return {
      message,
      actionMessage: null,
      intent: mode === 'discuss' ? ('question' as const) : mode,
      run,
      dispatchError,
    }
  })

// Kept for old task links. The implementation function now requires an approved plan.
export const confirmAgentAction = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ messageId: z.string() }))
  .handler(async ({ data }) => {
    const [message] = await db
      .select()
      .from(schema.taskMessages)
      .where(eq(schema.taskMessages.id, data.messageId))
    if (!message || message.kind !== 'action_request')
      throw new Error('Action request not found')
    await requireTaskAccess(message.taskId)
    return giveTaskToAgent({ data: { taskId: message.taskId } })
  })

export const requestAgentPlan = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(({ data }) => planTask({ data }))

export const markTaskChatRead = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string(), messageId: z.string().nullable() }))
  .handler(async ({ data }) => {
    const user = await requireCurrentUser()
    await requireTaskAccess(data.taskId, user)
    if (data.messageId) {
      const [message] = await db
        .select()
        .from(schema.taskMessages)
        .where(
          and(
            eq(schema.taskMessages.id, data.messageId),
            eq(schema.taskMessages.taskId, data.taskId),
          ),
        )
      if (!message) throw new Error('Message does not belong to this task')
    }
    const t = Date.now()
    await db
      .insert(schema.taskMessageReads)
      .values({
        taskId: data.taskId,
        userId: user.id,
        lastReadMessageId: data.messageId,
        updatedAt: t,
      })
      .onConflictDoUpdate({
        target: [
          schema.taskMessageReads.taskId,
          schema.taskMessageReads.userId,
        ],
        set: { lastReadMessageId: data.messageId, updatedAt: t },
      })
    return { ok: true }
  })

export const listTaskUnread = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireCurrentUser()
    await requireTaskAccess(data.taskId, user)
    const [read] = await db
      .select()
      .from(schema.taskMessageReads)
      .where(
        and(
          eq(schema.taskMessageReads.taskId, data.taskId),
          eq(schema.taskMessageReads.userId, user.id),
        ),
      )
    const [lastMessage] = read?.lastReadMessageId
      ? await db
          .select()
          .from(schema.taskMessages)
          .where(
            and(
              eq(schema.taskMessages.id, read.lastReadMessageId),
              eq(schema.taskMessages.taskId, data.taskId),
            ),
          )
      : []
    const messages = await db
      .select({ id: schema.taskMessages.id })
      .from(schema.taskMessages)
      .where(
        and(
          eq(schema.taskMessages.taskId, data.taskId),
          lastMessage
            ? gt(schema.taskMessages.createdAt, lastMessage.createdAt)
            : isNull(schema.taskMessages.authorUserId),
        ),
      )
    return { count: messages.length }
  })
