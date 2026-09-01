import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { asc, eq, max } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type { Project, ProjectRow } from '#/db/schema'
import { getUserFromCookie } from './auth'
import { requireUser } from './auth-middleware'

export const getCurrentUser = createServerFn({ method: 'GET' }).handler(async () => {
  return getUserFromCookie(getRequestHeader('cookie') ?? null)
})

const id = () => crypto.randomUUID()

const repositoryUrl = z.string().trim().url()
const repositoryUrls = z.array(repositoryUrl).max(8).optional()

function normalizeRepoUrls(repoUrls: string[]): string[] {
  return [...new Set(repoUrls.map((url) => url.trim()).filter(Boolean))]
}

async function addRepoUrls(projectRows: ProjectRow[]): Promise<Project[]> {
  if (projectRows.length === 0) return []

  const projectIds = new Set(projectRows.map((project) => project.id))
  const repositoryRows = (
    await db
      .select()
      .from(schema.projectRepositories)
      .orderBy(asc(schema.projectRepositories.position))
  ).filter((repository) => projectIds.has(repository.projectId))
  const urlsByProject = new Map<string, string[]>()

  for (const repository of repositoryRows) {
    const urls = urlsByProject.get(repository.projectId) ?? []
    urls.push(repository.url)
    urlsByProject.set(repository.projectId, urls)
  }

  return projectRows.map((project) => ({
    ...project,
    repoUrls:
      urlsByProject.get(project.id) ?? (project.repoUrl ? [project.repoUrl] : []),
  }))
}

async function replaceProjectRepositories(
  projectId: string,
  repoUrls: string[],
  createdAt: number,
) {
  const removeExisting = db
    .delete(schema.projectRepositories)
    .where(eq(schema.projectRepositories.projectId, projectId))

  if (repoUrls.length === 0) {
    await removeExisting
    return
  }

  const insertRepositories = db.insert(schema.projectRepositories).values(
    repoUrls.map((url, position) => ({
      id: id(),
      projectId,
      url,
      position,
      createdAt,
    })),
  )
  await db.batch([removeExisting, insertRepositories])
}

export const listProjects = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async () => {
  const rows = (await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.archived, 0))
    .orderBy(asc(schema.projects.position))) as ProjectRow[]
  return addRepoUrls(rows)
})

export const getProject = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, data.id))
    return (await addRepoUrls(rows as ProjectRow[]))[0]
  })

export const createProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      name: z.string().min(1),
      repoUrl: repositoryUrl.nullable().optional(),
      repoUrls: repositoryUrls,
    }),
  )
  .handler(async ({ data }) => {
    const creator = await getUserFromCookie(getRequestHeader('cookie') ?? null)
    if (!creator) throw new Error('Unauthorized')
    const now = Date.now()
    const maxRows = await db
      .select({ value: max(schema.projects.position) })
      .from(schema.projects)
    const maxRow = maxRows[0]
    const position = (maxRow?.value ?? -1) + 1
    const id_ = id()
    const repoUrls = normalizeRepoUrls(
      data.repoUrls ?? (data.repoUrl ? [data.repoUrl] : []),
    )
    await db.insert(schema.projects).values({
      id: id_,
      name: data.name,
      repoUrl: repoUrls[0] ?? null,
      position,
      createdAt: now,
      updatedAt: now,
    })
    await replaceProjectRepositories(id_, repoUrls, now)
    await db.insert(schema.projectMembers).values({
      id: id(),
      projectId: id_,
      email: creator.email,
      name: creator.name,
      role: 'owner',
      createdAt: now,
    })
    const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, id_))
    return (await addRepoUrls(rows as ProjectRow[]))[0]
  })

export const updateProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      repoUrl: repositoryUrl.nullable().optional(),
      repoUrls: repositoryUrls,
      position: z.number().int().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { id: pid, repoUrls: inputRepoUrls, ...inputPatch } = data
    const now = Date.now()
    const repoUrls =
      inputRepoUrls !== undefined
        ? normalizeRepoUrls(inputRepoUrls)
        : inputPatch.repoUrl !== undefined
          ? normalizeRepoUrls(inputPatch.repoUrl ? [inputPatch.repoUrl] : [])
          : undefined
    const patch = {
      ...inputPatch,
      ...(repoUrls !== undefined ? { repoUrl: repoUrls[0] ?? null } : {}),
      updatedAt: now,
    }
    await db.update(schema.projects).set(patch).where(eq(schema.projects.id, pid))
    if (repoUrls !== undefined) {
      await replaceProjectRepositories(pid, repoUrls, now)
    }
    const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, pid))
    return (await addRepoUrls(rows as ProjectRow[]))[0]
  })

export const archiveProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
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
  .middleware([requireUser])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(schema.projects).where(eq(schema.projects.id, data.id))
    return { ok: true }
  })
