import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { asc, eq, max } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type { Project } from '#/db/schema'

const id = () => crypto.randomUUID()

export const listProjects = createServerFn({ method: 'GET' }).handler(async () => {
  return (await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.archived, 0))
    .orderBy(asc(schema.projects.position))) as Project[]
})

export const getProject = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, data.id))
    return rows[0] as Project | undefined
  })

export const createProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().min(1),
      repoUrl: z.string().url().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const now = Date.now()
    const maxRows = await db
      .select({ value: max(schema.projects.position) })
      .from(schema.projects)
    const maxRow = maxRows[0]
    const position = (maxRow?.value ?? -1) + 1
    const id_ = id()
    await db.insert(schema.projects).values({
      id: id_,
      name: data.name,
      repoUrl: data.repoUrl ?? null,
      position,
      createdAt: now,
      updatedAt: now,
    })
    const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, id_))
    return rows[0] as Project | undefined
  })

export const updateProject = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      repoUrl: z.string().url().nullable().optional(),
      position: z.number().int().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { id: pid, ...patch } = data
    const now = Date.now()
    await db.update(schema.projects).set({ ...patch, updatedAt: now }).where(eq(schema.projects.id, pid))
    const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, pid))
    return rows[0] as Project | undefined
  })

export const archiveProject = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const now = Date.now()
    await db
      .update(schema.projects)
      .set({ archived: 1, updatedAt: now })
      .where(eq(schema.projects.id, data.id))
    return { ok: true }
  })

export const deleteProject = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(schema.projects).where(eq(schema.projects.id, data.id))
    return { ok: true }
  })