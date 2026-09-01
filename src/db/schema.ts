import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  repoUrl: text('repo_url'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  archived: integer('archived').notNull().default(0),
})

export const projectRepositories = sqliteTable(
  'project_repositories',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    projectUrlIdx: uniqueIndex('project_repositories_project_url_idx').on(
      table.projectId,
      table.url,
    ),
  }),
)

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  notes: text('notes'),
  priority: text('priority', {
    enum: ['low', 'medium', 'high', 'urgent'],
  })
    .notNull()
    .default('medium'),
  status: text('status', {
    enum: ['todo', 'in_progress', 'done'],
  })
    .notNull()
    .default('todo'),
  dueAt: integer('due_at'),
  position: integer('position').notNull().default(0),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  ownerUserId: text('owner_user_id'),
  lifecycleState: text('lifecycle_state', {
    enum: ['discussion', 'planning', 'plan_ready', 'approved', 'running', 'pr_open', 'done', 'failed'],
  }).notNull().default('discussion'),
  lastMessageAt: integer('last_message_at'),
  nextAction: text('next_action'),
})

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  r2Key: text('r2_key').notNull(),
  createdAt: integer('created_at').notNull(),
})

export type ProjectRow = typeof projects.$inferSelect
export type Project = ProjectRow & { repoUrls: string[] }
export type ProjectRepository = typeof projectRepositories.$inferSelect
export type Task = typeof tasks.$inferSelect
export type Attachment = typeof attachments.$inferSelect

export const agentRuns = sqliteTable('agent_runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  status: text('status', {
    enum: [
      'queued',
      'running',
      'success',
      'error',
      'merged',
      'closed',
      'plan_ready',
      'approved',
      'stopped',
    ],
  })
    .notNull()
    .default('queued'),
  kind: text('kind', { enum: ['answer', 'implement', 'plan'] })
    .notNull()
    .default('implement'),
  repoUrl: text('repo_url'),
  branchName: text('branch_name'),
  prUrl: text('pr_url'),
  prNumber: integer('pr_number'),
  planMd: text('plan_md'),
  planFeedback: text('plan_feedback'),
  planVersion: integer('plan_version').notNull().default(1),
  logs: text('logs'),
  errorMessage: text('error_message'),
  runnerBackend: text('runner_backend', {
    enum: ['local', 'github_actions'],
  })
    .notNull()
    .default('local'),
  runnerJobId: text('runner_job_id'),
  runnerJobUrl: text('runner_job_url'),
  dispatchAttempts: integer('dispatch_attempts').notNull().default(0),
  dispatchedAt: integer('dispatched_at'),
  triggerMessageId: text('trigger_message_id'),
  confirmationMessageId: text('confirmation_message_id'),
  approvedByUserId: text('approved_by_user_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type AgentRun = typeof agentRuns.$inferSelect

export const agentRunRepositories = sqliteTable(
  'agent_run_repositories',
  {
    id: text('id').primaryKey(),
    agentRunId: text('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    repoUrl: text('repo_url').notNull(),
    position: integer('position').notNull().default(0),
    status: text('status', {
      enum: ['pending', 'skipped', 'success', 'merged', 'closed', 'error'],
    })
      .notNull()
      .default('pending'),
    branchName: text('branch_name'),
    prUrl: text('pr_url'),
    prNumber: integer('pr_number'),
    errorMessage: text('error_message'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    runRepoIdx: uniqueIndex('agent_run_repositories_run_repo_idx').on(
      table.agentRunId,
      table.repoUrl,
    ),
  }),
)

export type AgentRunRepository = typeof agentRunRepositories.$inferSelect
export type AgentRunWithRepositories = AgentRun & {
  repositories: AgentRunRepository[]
}

export const projectMembers = sqliteTable('project_members', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name'),
  role: text('role', { enum: ['owner', 'manager', 'member'] })
    .notNull()
    .default('member'),
  createdAt: integer('created_at').notNull(),
})

export type ProjectMember = typeof projectMembers.$inferSelect

export const planApprovals = sqliteTable('plan_approvals', {
  id: text('id').primaryKey(),
  agentRunId: text('agent_run_id')
    .notNull()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  requestedBy: text('requested_by').notNull(),
  requestedFrom: text('requested_from').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] })
    .notNull()
    .default('pending'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export type PlanApproval = typeof planApprovals.$inferSelect

export const planSuggestions = sqliteTable('plan_suggestions', {
  id: text('id').primaryKey(),
  agentRunId: text('agent_run_id')
    .notNull()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  suggestedBy: text('suggested_by').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
})

export type PlanSuggestion = typeof planSuggestions.$inferSelect

export const taskMessages = sqliteTable(
  'task_messages',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorType: text('author_type', { enum: ['user', 'agent', 'system'] })
      .notNull(),
    authorUserId: text('author_user_id'),
    kind: text('kind', {
      enum: ['text', 'answer', 'plan', 'action_request', 'progress', 'pr', 'error', 'attachment', 'legacy_context'],
    }).notNull().default('text'),
    body: text('body').notNull(),
    metadata: text('metadata'),
    clientMessageId: text('client_message_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    taskCreatedIdx: index('task_messages_task_created_idx').on(
      table.taskId,
      table.createdAt,
    ),
    taskIdIdx: index('task_messages_task_id_idx').on(table.taskId, table.id),
    clientMessageIdx: uniqueIndex('task_messages_client_message_idx').on(
      table.taskId,
      table.clientMessageId,
    ),
  }),
)

export type TaskMessage = typeof taskMessages.$inferSelect

export const taskMessageReads = sqliteTable(
  'task_message_reads',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastReadMessageId: text('last_read_message_id'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    taskUserIdx: uniqueIndex('task_message_reads_task_user_idx').on(
      table.taskId,
      table.userId,
    ),
  }),
)

export type TaskMessageRead = typeof taskMessageReads.$inferSelect

export const projectInvites = sqliteTable('project_invites', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: text('invited_by').notNull(),
  expiresAt: integer('expires_at').notNull(),
  acceptedAt: integer('accepted_at'),
  createdAt: integer('created_at').notNull(),
})

export type ProjectInvite = typeof projectInvites.$inferSelect

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    provider: text('provider', {
      enum: ['google', 'github', 'cloudflare'],
    }).notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
    providerAccountIdx: uniqueIndex('users_provider_account_idx').on(
      table.provider,
      table.providerAccountId,
    ),
  }),
)

export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const oauthStates = sqliteTable('oauth_states', {
  state: text('state').primaryKey(),
  provider: text('provider', { enum: ['google', 'github'] }).notNull(),
  codeVerifier: text('code_verifier').notNull(),
  redirectPath: text('redirect_path').notNull(),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
})

export type User = typeof users.$inferSelect
export type AuthSession = typeof authSessions.$inferSelect

export const priorityRank: Record<Task['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
}
