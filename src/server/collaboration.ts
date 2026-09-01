import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, desc } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type { ProjectMember, PlanApproval, PlanSuggestion } from '#/db/schema'
import { getRequestHeader } from '@tanstack/react-start/server'
import { getUserFromCookie } from './auth'
import { requireUser } from './auth-middleware'

const id = () => crypto.randomUUID()
const now = () => Date.now()

async function hashInviteToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// ----- Project Members -----

export const createProjectInvite = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ projectId: z.string(), email: z.string().email() }))
  .handler(async ({ data }) => {
    const user = await getUserFromCookie(getRequestHeader('cookie') ?? null)
    if (!user) throw new Error('Unauthorized')
    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
    const t = now()
    await db.insert(schema.projectInvites).values({
      id: id(),
      projectId: data.projectId,
      email: data.email.toLowerCase(),
      tokenHash: await hashInviteToken(token),
      invitedBy: user.id,
      expiresAt: t + 7 * 24 * 60 * 60 * 1000,
      acceptedAt: null,
      createdAt: t,
    })
    return { token, invitePath: `/invite/${token}`, expiresAt: t + 7 * 24 * 60 * 60 * 1000 }
  })

export const acceptProjectInvite = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ token: z.string().min(20) }))
  .handler(async ({ data }) => {
    const user = await getUserFromCookie(getRequestHeader('cookie') ?? null)
    if (!user) throw new Error('Unauthorized')
    const tokenHash = await hashInviteToken(data.token)
    const [invite] = await db.select().from(schema.projectInvites).where(eq(schema.projectInvites.tokenHash, tokenHash))
    if (!invite || invite.acceptedAt || invite.expiresAt < now()) throw new Error('Invite is invalid or expired')
    if (invite.email !== user.email.toLowerCase()) throw new Error('Sign in with the invited email address')
    const existing = await db.select().from(schema.projectMembers).where(and(eq(schema.projectMembers.projectId, invite.projectId), eq(schema.projectMembers.email, user.email)))
    if (existing.length === 0) {
      await db.insert(schema.projectMembers).values({ id: id(), projectId: invite.projectId, email: user.email, name: user.name, role: 'member', createdAt: now() })
    }
    await db.update(schema.projectInvites).set({ acceptedAt: now() }).where(eq(schema.projectInvites.id, invite.id))
    return { projectId: invite.projectId }
  })

export const listProjectMembers = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ projectId: z.string() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.projectId, data.projectId))
      .orderBy(desc(schema.projectMembers.createdAt))
    return rows as ProjectMember[]
  })

export const addProjectMember = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      projectId: z.string(),
      email: z.string().email(),
      name: z.string().optional(),
      role: z.enum(['owner', 'manager', 'member']).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const t = now()
    const id_ = id()
    await db.insert(schema.projectMembers).values({
      id: id_,
      projectId: data.projectId,
      email: data.email,
      name: data.name ?? null,
      role: data.role ?? 'member',
      createdAt: t,
    })
    const [row] = await db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.id, id_))
    return row as ProjectMember
  })

export const removeProjectMember = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(schema.projectMembers).where(eq(schema.projectMembers.id, data.id))
    return { ok: true }
  })

export const updateMemberRole = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      id: z.string(),
      role: z.enum(['owner', 'manager', 'member']),
    }),
  )
  .handler(async ({ data }) => {
    const t = now()
    await db
      .update(schema.projectMembers)
      .set({ role: data.role, createdAt: t })
      .where(eq(schema.projectMembers.id, data.id))
    const [row] = await db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.id, data.id))
    return row as ProjectMember
  })

// ----- Plan Approvals -----

export const requestPlanApproval = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      agentRunId: z.string(),
      projectId: z.string(),
      requestedFrom: z.string().email(),
    }),
  )
  .handler(async ({ data, context }) => {
    if (!context.user) throw new Error('Unauthorized')
    const t = now()
    const id_ = id()

    // Check for existing pending approval to the same person
    const existing = await db
      .select()
      .from(schema.planApprovals)
      .where(
        and(
          eq(schema.planApprovals.agentRunId, data.agentRunId),
          eq(schema.planApprovals.requestedFrom, data.requestedFrom),
          eq(schema.planApprovals.status, 'pending'),
        ),
      )
    if (existing.length > 0) {
      return existing[0] as PlanApproval
    }

    await db.insert(schema.planApprovals).values({
      id: id_,
      agentRunId: data.agentRunId,
      projectId: data.projectId,
      requestedBy: context.user.email,
      requestedFrom: data.requestedFrom,
      status: 'pending',
      createdAt: t,
      updatedAt: t,
    })
    const [row] = await db
      .select()
      .from(schema.planApprovals)
      .where(eq(schema.planApprovals.id, id_))
    return row as PlanApproval
  })

export const listPlanApprovals = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ agentRunId: z.string() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(schema.planApprovals)
      .where(eq(schema.planApprovals.agentRunId, data.agentRunId))
      .orderBy(desc(schema.planApprovals.createdAt))
    return rows as PlanApproval[]
  })

export const listPendingApprovalsForUser = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    if (!context.user) throw new Error('Unauthorized')
    const rows = await db
      .select()
      .from(schema.planApprovals)
      .where(
        and(
          eq(schema.planApprovals.requestedFrom, context.user.email),
          eq(schema.planApprovals.status, 'pending'),
        ),
      )
      .orderBy(desc(schema.planApprovals.createdAt))
    return rows as PlanApproval[]
  })

export const respondToApproval = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      id: z.string(),
      status: z.enum(['approved', 'rejected']),
    }),
  )
  .handler(async ({ data, context }) => {
    if (!context.user) throw new Error('Unauthorized')
    const t = now()
    await db
      .update(schema.planApprovals)
      .set({ status: data.status, updatedAt: t })
      .where(
        and(
          eq(schema.planApprovals.id, data.id),
          eq(schema.planApprovals.requestedFrom, context.user.email),
        ),
      )
    const [row] = await db
      .select()
      .from(schema.planApprovals)
      .where(
        and(
          eq(schema.planApprovals.id, data.id),
          eq(schema.planApprovals.requestedFrom, context.user.email),
        ),
      )
    if (!row) throw new Error('Approval request not found')
    return row as PlanApproval
  })

// ----- Plan Suggestions -----

export const addPlanSuggestion = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      agentRunId: z.string(),
      projectId: z.string(),
      content: z.string().min(1),
    }),
  )
  .handler(async ({ data, context }) => {
    if (!context.user) throw new Error('Unauthorized')
    const t = now()
    const id_ = id()
    await db.insert(schema.planSuggestions).values({
      id: id_,
      agentRunId: data.agentRunId,
      projectId: data.projectId,
      suggestedBy: context.user.email,
      content: data.content,
      createdAt: t,
    })
    const [row] = await db
      .select()
      .from(schema.planSuggestions)
      .where(eq(schema.planSuggestions.id, id_))
    return row as PlanSuggestion
  })

export const listPlanSuggestions = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ agentRunId: z.string() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(schema.planSuggestions)
      .where(eq(schema.planSuggestions.agentRunId, data.agentRunId))
      .orderBy(desc(schema.planSuggestions.createdAt))
    return rows as PlanSuggestion[]
  })
