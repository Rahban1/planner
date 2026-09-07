import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { and, asc, eq, inArray, max } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type { Project, ProjectRow } from '#/db/schema'
import { getUserFromCookie } from './auth'
import { requireUser } from './auth-middleware'
import {
  accessibleProjectIds,
  requireCurrentUser,
  requireProjectAccess,
} from './access.server'

export const getCurrentUser = createServerFn({ method: 'GET' }).handler(
  async () => {
    return getUserFromCookie(getRequestHeader('cookie') ?? null)
  },
)

const id = () => crypto.randomUUID()

const repositoryUrl = z.string().trim().url()
const repositoryUrls = z.array(repositoryUrl).max(8).optional()

function normalizeRepoUrls(repoUrls: string[]): string[] {
  return [...new Set(repoUrls.map((url) => url.trim()).filter(Boolean))]
}

async function addRepoUrls(projectRows: ProjectRow[]): Promise<Project[]> {
  if (projectRows.length === 0) return []

  const repositoryRows = await db
    .select()
    .from(schema.projectRepositories)
    .where(
      inArray(
        schema.projectRepositories.projectId,
        projectRows.map((project) => project.id),
      ),
    )
    .orderBy(asc(schema.projectRepositories.position))
  const urlsByProject = new Map<string, string[]>()

  for (const repository of repositoryRows) {
    const urls = urlsByProject.get(repository.projectId) ?? []
    urls.push(repository.url)
    urlsByProject.set(repository.projectId, urls)
  }

  return projectRows.map((project) => ({
    ...project,
    repoUrls:
      urlsByProject.get(project.id) ??
      (project.repoUrl ? [project.repoUrl] : []),
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
    const projectIds = await accessibleProjectIds()
    if (projectIds.length === 0) return []
    const rows = (await db
      .select()
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.archived, 0),
          inArray(schema.projects.id, projectIds),
        ),
      )
      .orderBy(asc(schema.projects.position))) as ProjectRow[]
    return addRepoUrls(rows)
  })

export const getProject = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const project = await requireProjectAccess(data.id)
    return (await addRepoUrls([project]))[0]
  })

export const createProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      name: z.string().min(1),
      repoUrl: repositoryUrl.nullable().optional(),
      repoUrls: repositoryUrls,
      instructions: z.string().trim().max(20_000).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const creator = await requireCurrentUser()
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
    const projectInsert = db.insert(schema.projects).values({
      id: id_,
      name: data.name,
      repoUrl: repoUrls[0] ?? null,
      instructions: data.instructions || null,
      position,
      createdAt: now,
      updatedAt: now,
    })
    const membershipInsert = db.insert(schema.projectMembers).values({
      id: id(),
      projectId: id_,
      email: creator.email,
      name: creator.name,
      role: 'owner',
      createdAt: now,
    })
    await db.batch([
      projectInsert,
      membershipInsert,
      ...(repoUrls.length > 0
        ? [
            db.insert(schema.projectRepositories).values(
              repoUrls.map((url, repoPosition) => ({
                id: id(),
                projectId: id_,
                url,
                position: repoPosition,
                createdAt: now,
              })),
            ),
          ]
        : []),
    ])
    const rows = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id_))
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
      instructions: z.string().trim().max(20_000).nullable().optional(),
      position: z.number().int().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireProjectAccess(data.id)
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
      ...(inputPatch.instructions !== undefined
        ? { instructions: inputPatch.instructions || null }
        : {}),
      ...(repoUrls !== undefined ? { repoUrl: repoUrls[0] ?? null } : {}),
      updatedAt: now,
    }
    await db
      .update(schema.projects)
      .set(patch)
      .where(eq(schema.projects.id, pid))
    if (repoUrls !== undefined) {
      await replaceProjectRepositories(pid, repoUrls, now)
    }
    const rows = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, pid))
    return (await addRepoUrls(rows as ProjectRow[]))[0]
  })

export const archiveProject = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireProjectAccess(data.id)
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
    await requireProjectAccess(data.id)
    await db.delete(schema.projects).where(eq(schema.projects.id, data.id))
    return { ok: true }
  })
