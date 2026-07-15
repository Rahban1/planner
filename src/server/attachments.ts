import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { asc, eq } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import { env } from 'cloudflare:workers'
import type { Attachment } from '#/db/schema'

const id = () => crypto.randomUUID()

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

function r2KeyFor(id_: string) {
  return `attachments/${id_}`
}

export const listAttachmentsForTask = createServerFn({ method: 'GET' })
  .validator(z.object({ taskId: z.string() }))
  .handler(async ({ data }) => {
    return db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.taskId, data.taskId))
      .orderBy(asc(schema.attachments.createdAt))
  })

export const uploadAttachment = createServerFn({ method: 'POST' })
  .validator(z.instanceof(FormData))
  .handler(async ({ data }): Promise<Attachment> => {
    const taskId = data.get('taskId')
    const file = data.get('file')

    if (typeof taskId !== 'string') {
      throw new Error('Missing taskId')
    }

    if (!(file instanceof File)) {
      throw new Error('Missing or invalid file')
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File is too large. Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`)
    }

    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
    if (!task) throw new Error('Task not found')

    const id_ = id()
    const key = r2KeyFor(id_)
    const now = Date.now()

    const bytes = await file.arrayBuffer()
    await env.ATTACHMENTS.put(key, bytes, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    })

    await db.insert(schema.attachments).values({
      id: id_,
      taskId,
      projectId: task.projectId,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      r2Key: key,
      createdAt: now,
    })

    const [row] = await db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.id, id_))
    if (!row) throw new Error('Failed to save attachment')
    return row
  })

export const deleteAttachment = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.id, data.id))
    if (!row) throw new Error('Attachment not found')

    await env.ATTACHMENTS.delete(row.r2Key)
    await db.delete(schema.attachments).where(eq(schema.attachments.id, data.id))
    return row
  })
