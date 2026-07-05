import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type { Task } from '#/db/schema'

const id = () => crypto.randomUUID()

const taskWithSubtasks = async (task: Task): Promise<TaskWithSubtasks> => {
  const subtasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.parentId, task.id))
    .orderBy(asc(schema.tasks.position))
  return { ...task, subtasks }
}

export type TaskWithSubtasks = Task & { subtasks: Task[] }

export const listTasksForProject = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      projectId: z.string(),
      includeDone: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.projectId, data.projectId),
          isNull(schema.tasks.parentId),
          data.includeDone ? undefined : eq(schema.tasks.status, 'todo'),
        ),
      )
      .orderBy(asc(schema.tasks.position))
    return Promise.all(rows.map(taskWithSubtasks))
  })

export const listProjectSummary = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      projectId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    // Active tasks only (no parent)
    const active = await Promise.all(
      (
        await db
          .select()
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.projectId, data.projectId),
              isNull(schema.tasks.parentId),
              eq(schema.tasks.status, 'todo'),
            ),
          )
          .orderBy(asc(schema.tasks.position))
      ).map(taskWithSubtasks),
    )
    const completed = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.projectId, data.projectId),
          isNull(schema.tasks.parentId),
          eq(schema.tasks.status, 'done'),
        ),
      )
      .orderBy(asc(schema.tasks.position))
    return { active, completed }
  })

export const getTask = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, data.id))
    if (!task) return undefined
    return taskWithSubtasks(task)
  })

export const createTask = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      projectId: z.string(),
      parentId: z.string().nullable().optional(),
      title: z.string().min(1),
      notes: z.string().nullable().optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      dueAt: z.number().int().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const now = Date.now()
    const where = data.parentId
      ? and(
          eq(schema.tasks.projectId, data.projectId),
          eq(schema.tasks.parentId, data.parentId),
        )
      : and(
          eq(schema.tasks.projectId, data.projectId),
          isNull(schema.tasks.parentId),
        )

    const existing = await db.select().from(schema.tasks).where(where)
    const position = existing.length
    const id_ = id()
    await db.insert(schema.tasks).values({
      id: id_,
      projectId: data.projectId,
      parentId: data.parentId ?? null,
      title: data.title,
      notes: data.notes ?? null,
      priority: data.priority ?? 'medium',
      status: 'todo',
      dueAt: data.dueAt ?? null,
      position,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id_))
    return task ? taskWithSubtasks(task) : undefined
  })

export const updateTask = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      title: z.string().min(1).optional(),
      notes: z.string().nullable().optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
      status: z.enum(['todo', 'in_progress', 'done']).optional(),
      dueAt: z.number().int().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { id: tid, ...patch } = data
    const now = Date.now()
    const finalPatch: Partial<Task> = { ...patch, updatedAt: now }
    if (patch.status === 'done') finalPatch.completedAt = now
    if (patch.status && patch.status !== 'done') finalPatch.completedAt = null
    await db.update(schema.tasks).set(finalPatch).where(eq(schema.tasks.id, tid))
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, tid))
    return task ? taskWithSubtasks(task) : undefined
  })

export const completeTask = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const now = Date.now()
    await db
      .update(schema.tasks)
      .set({ status: 'done', completedAt: now, updatedAt: now })
      .where(eq(schema.tasks.id, data.id))
    // Recursive completion not applied in v1 — keep subtasks intact.
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, data.id))
    return task
  })

export const uncompleteTask = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const now = Date.now()
    await db
      .update(schema.tasks)
      .set({ status: 'todo', completedAt: null, updatedAt: now })
      .where(eq(schema.tasks.id, data.id))
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, data.id))
    return task
  })

export const deleteTask = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, data.id))
    if (task && !task.parentId) {
      // First delete children
      await db.delete(schema.tasks).where(eq(schema.tasks.parentId, data.id))
    }
    await db.delete(schema.tasks).where(eq(schema.tasks.id, data.id))
    return { ok: true }
  })

// End of task server functions