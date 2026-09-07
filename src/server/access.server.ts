import { getRequest } from '@tanstack/react-start/server'
import { and, eq, sql } from 'drizzle-orm'
import { db, runtimeEnv, schema } from '#/db/index'
import type { User } from '#/db/schema'
import { getUserFromCookie } from './auth'

// A machine request is trusted only after checking its token here as well as
// at the bridge. The path alone is never an authorization credential.
export function isRunnerRequest() {
  const request = getRequest()
  if (!new URL(request.url).pathname.startsWith('/api/runner/')) return false
  const token = runtimeEnv.RUNNER_API_TOKEN
  return token
    ? request.headers.get('X-Runner-Token') === token
    : new URL(request.url).hostname === 'localhost' ||
        new URL(request.url).hostname === '127.0.0.1'
}

export async function requireCurrentUser(): Promise<User> {
  const user = await getUserFromCookie(getRequest().headers.get('cookie'))
  if (!user) throw new Error('Unauthorized')
  return user
}

export async function accessibleProjectIds(user?: User): Promise<string[]> {
  const current = user ?? (await requireCurrentUser())
  const memberships = await db
    .select({ projectId: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .where(
      sql`lower(${schema.projectMembers.email}) = ${current.email.toLowerCase()}`,
    )
  return [...new Set(memberships.map((row) => row.projectId))]
}

export async function requireProjectAccess(projectId: string, user?: User) {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
  if (!project) throw new Error('Project not found')
  if (isRunnerRequest()) return project
  const current = user ?? (await requireCurrentUser())
  const [member] = await db
    .select({ id: schema.projectMembers.id })
    .from(schema.projectMembers)
    .where(
      and(
        eq(schema.projectMembers.projectId, projectId),
        sql`lower(${schema.projectMembers.email}) = ${current.email.toLowerCase()}`,
      ),
    )
  if (!member) throw new Error('Project membership required')
  return project
}

export async function requireTaskAccess(taskId: string, user?: User) {
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
  if (!task) throw new Error('Task not found')
  await requireProjectAccess(task.projectId, user)
  return task
}

export async function requireRunAccess(runId: string) {
  const [run] = await db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.id, runId))
  if (!run) throw new Error('Agent run not found')
  await requireTaskAccess(run.taskId)
  return run
}

export function requireRunnerAccess() {
  if (!isRunnerRequest()) throw new Error('Runner access required')
}
