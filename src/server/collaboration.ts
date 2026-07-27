import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, desc } from 'drizzle-orm'
import { db, schema } from '#/db/index'
import type { ProjectMember, PlanApproval, PlanSuggestion } from '#/db/schema'

const id = () => crypto.randomUUID()
const now = () => Date.now()

// ----- Project Members -----

export const listProjectMembers = createServerFn({ method: 'GET' })
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
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await db.delete(schema.projectMembers).where(eq(schema.projectMembers.id, data.id))
    return { ok: true }
  })

export const updateMemberRole = createServerFn({ method: 'POST' })
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
  .validator(
    z.object({
      agentRunId: z.string(),
      projectId: z.string(),
      requestedBy: z.string().email(),
      requestedFrom: z.string().email(),
    }),
  )
  .handler(async ({ data }) => {
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
      requestedBy: data.requestedBy,
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
  .validator(z.object({ email: z.string().email() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(schema.planApprovals)
      .where(
        and(
          eq(schema.planApprovals.requestedFrom, data.email),
          eq(schema.planApprovals.status, 'pending'),
        ),
      )
      .orderBy(desc(schema.planApprovals.createdAt))
    return rows as PlanApproval[]
  })

export const respondToApproval = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string(),
      status: z.enum(['approved', 'rejected']),
    }),
  )
  .handler(async ({ data }) => {
    const t = now()
    await db
      .update(schema.planApprovals)
      .set({ status: data.status, updatedAt: t })
      .where(eq(schema.planApprovals.id, data.id))
    const [row] = await db
      .select()
      .from(schema.planApprovals)
      .where(eq(schema.planApprovals.id, data.id))
    return row as PlanApproval
  })

// ----- Plan Suggestions -----

export const addPlanSuggestion = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      agentRunId: z.string(),
      projectId: z.string(),
      suggestedBy: z.string().email(),
      content: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const t = now()
    const id_ = id()
    await db.insert(schema.planSuggestions).values({
      id: id_,
      agentRunId: data.agentRunId,
      projectId: data.projectId,
      suggestedBy: data.suggestedBy,
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
  .validator(z.object({ agentRunId: z.string() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(schema.planSuggestions)
      .where(eq(schema.planSuggestions.agentRunId, data.agentRunId))
      .orderBy(desc(schema.planSuggestions.createdAt))
    return rows as PlanSuggestion[]
  })