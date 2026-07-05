import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import { priorityRank } from '#/db/schema'
import type { Project } from '#/db/schema'
import { listProjects } from './projects'

export type PriorityCard = {
  id: string
  title: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueAt: number | null
  project: { id: string; name: string; repoUrl?: string | null }
}

// All unresolved tasks across all projects, sorted by (priority_rank, due_at asc).
export const listPriority = createServerFn({ method: 'GET' }).handler(async () => {
  const projects = (await listProjects()) as Project[]
  const projectsById = new Map(projects.map((p) => [p.id, p]))

  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        isNull(schema.tasks.parentId),
        eq(schema.tasks.status, 'todo'),
      ),
    )

  const enriched: PriorityCard[] = tasks
    .filter((t) => projectsById.has(t.projectId))
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      dueAt: t.dueAt,
      project: {
        id: t.projectId,
        name: projectsById.get(t.projectId)!.name,
        repoUrl: projectsById.get(t.projectId)!.repoUrl,
      },
    }))

  enriched.sort((a, b) => {
    const pr = priorityRank[a.priority] - priorityRank[b.priority]
    if (pr !== 0) return pr
    const aDue = a.dueAt ?? Number.MAX_SAFE_INTEGER
    const bDue = b.dueAt ?? Number.MAX_SAFE_INTEGER
    return aDue - bDue
  })

  return enriched
})

// Unused; keeps asc/or imports alive without lint complaints during scaffolding
export const _unused = { asc, or }