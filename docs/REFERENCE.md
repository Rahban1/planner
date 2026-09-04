# Planner technical reference

This reference describes the current working source. Types and constraints come from the schema, validators, configuration, and runner code.

## Runtime stack

| Area                      | Technology                                            |
| ------------------------- | ----------------------------------------------------- |
| Web framework             | TanStack Start with React 19                          |
| Routing                   | TanStack Router file routes                           |
| Client server-state cache | TanStack Query                                        |
| Worker runtime            | Cloudflare Workers through the Cloudflare Vite plugin |
| Database                  | Cloudflare D1 with Drizzle ORM                        |
| File storage              | Cloudflare R2                                         |
| Styling                   | Tailwind CSS 4 and `src/styles.css`                   |
| Agent coordinator         | Node.js 22 container                                  |
| Agent service             | OpenHands Agent Server 1.32.0                         |
| Model endpoint default    | Anthropic Claude                                      |
| Pull request service      | GitHub or Bitbucket Data Center REST API              |

## Package commands

Run these commands from the repository root.

| Command                          | Result                                                      |
| -------------------------------- | ----------------------------------------------------------- |
| `pnpm dev`                       | Start Vite on port 3000.                                    |
| `pnpm dev --host`                | Start Vite on port 3000 and accept Docker host connections. |
| `pnpm generate-routes`           | Generate `src/routeTree.gen.ts`.                            |
| `pnpm test`                      | Run web tests, build the runner, and run runner tests.      |
| `pnpm lint`                      | Run ESLint.                                                 |
| `pnpm format`                    | Run Prettier write and ESLint fix.                          |
| `pnpm check`                     | Check Prettier format.                                      |
| `pnpm build`                     | Create the production Worker build.                         |
| `pnpm preview`                   | Start a local preview of the production build.              |
| `pnpm run deploy`                | Build and deploy with Wrangler.                             |
| `npm --prefix agent-runner test` | Build and test the agent runner.                            |

## Browser routes

| Route           | Access       | Purpose                                              |
| --------------- | ------------ | ---------------------------------------------------- |
| `/`             | Public       | Redirect to `/landing`.                              |
| `/landing`      | Public       | Show the product landing page.                       |
| `/login`        | Public       | Show Google and GitHub sign-in choices.              |
| `/dashboard`    | User session | Show priority tasks and project columns.             |
| `/projects/$id` | User session | Show one project, active tasks, and completed tasks. |
| `/agent-runs`   | User session | Show all plan and implementation runs.               |

## HTTP API routes

### Authentication

| Method and path                     | Input                                               | Result                                           |
| ----------------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| `GET /api/auth/providers`           | Optional `redirect` query                           | Provider name, start URL, and configured state.  |
| `GET /api/auth/start`               | `provider=google                                    | github`, optional `redirect`                     | Create OAuth state and redirect to the provider. |
| `GET /api/auth/callback/$provider`  | Provider `code` and `state`                         | Create a user session or redirect with an error. |
| `GET /api/auth/cloudflare/callback` | Cloudflare Access assertion and optional `redirect` | Verify the Access JWT and create a user session. |
| `POST /api/auth/logout`             | Session cookie                                      | Expire the Planner session cookie.               |

### Attachments

| Method and path            | Access                       | Result                                                     |
| -------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `GET /api/attachments/$id` | Valid Planner session cookie | Stream the R2 object inline. Return 401 or 404 on failure. |

### Runner bridge

The bridge uses `X-Runner-Token` when the Worker has `RUNNER_API_TOKEN`. The path middleware permits internal server-function calls without a user session only under `/api/runner/`.

| Method and path                        | Input or result                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/runner/queue`                | Return queued agent runs.                                                          |
| `GET /api/runner/awaiting-merge`       | Return successful runs that have a primary pull request URL.                       |
| `GET /api/runner/task-context/$taskId` | Return task, project, repository snapshot, approved plan, and attachment metadata. |
| `GET /api/runner/runs/$runId`          | Return one run.                                                                    |
| `POST /api/runner/give-task`           | Body: `{ taskId }`. Queue an implementation run.                                   |
| `POST /api/runner/plan-task`           | Body: `{ taskId }`. Queue a plan run.                                              |
| `POST /api/runner/approve-plan`        | Body: `{ runId }`. Approve a plan and queue implementation.                        |
| `POST /api/runner/request-changes`     | Body: `{ runId, feedback }`. Queue a plan revision.                                |
| `POST /api/runner/update-run`          | Body: run status and result fields. Update a run.                                  |

Unknown bridge paths return HTTP 404. A wrong machine token returns HTTP 401.

## Server functions

All functions in this section use `requireUser`. Calls made inside the authorized runner route are the exception.

### Projects

| Function         | Method | Input and constraint                                                | Result                                     |
| ---------------- | ------ | ------------------------------------------------------------------- | ------------------------------------------ |
| `getCurrentUser` | GET    | None                                                                | Current user or `null`.                    |
| `listProjects`   | GET    | None                                                                | Active projects in position order.         |
| `getProject`     | GET    | `id: string`                                                        | Project with `repoUrls`.                   |
| `createProject`  | POST   | Name is not empty. Up to 8 valid repository URLs.                   | New project.                               |
| `updateProject`  | POST   | Project ID and optional name, repository URLs, or integer position. | Updated project.                           |
| `archiveProject` | POST   | `id: string`                                                        | Set `archived` to 1.                       |
| `deleteProject`  | POST   | `id: string`                                                        | Delete the project and cascade child rows. |

`repoUrl` is the compatibility field for the first repository. `repoUrls` is the ordered current interface. Duplicate repository URLs are removed.

### Tasks and priority

| Function              | Method | Input and constraint                                                                 | Result                                                          |
| --------------------- | ------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `listTasksForProject` | GET    | Project ID and optional `includeDone`.                                               | Top-level tasks with subtasks and attachments.                  |
| `listProjectSummary`  | GET    | Project ID.                                                                          | Active and completed top-level task arrays.                     |
| `getTask`             | GET    | Task ID.                                                                             | Task with subtasks and attachments.                             |
| `createTask`          | POST   | Project ID, non-empty title, optional parent, notes, priority, and integer due time. | New task.                                                       |
| `updateTask`          | POST   | Task ID and optional mutable fields.                                                 | Updated task.                                                   |
| `completeTask`        | POST   | Task ID.                                                                             | Status `done` and completion time.                              |
| `uncompleteTask`      | POST   | Task ID.                                                                             | Status `todo` and no completion time.                           |
| `deleteTask`          | POST   | Task ID.                                                                             | Delete task. Delete direct children first for a top-level task. |
| `listPriority`        | GET    | None.                                                                                | Open top-level tasks from active projects in priority order.    |

Priority values are `urgent`, `high`, `medium`, and `low`. Task status values are `todo`, `in_progress`, and `done`.

### Attachments

| Function                 | Method | Input and constraint                                                | Result                                 |
| ------------------------ | ------ | ------------------------------------------------------------------- | -------------------------------------- |
| `listAttachmentsForTask` | GET    | Task ID.                                                            | Attachment metadata in creation order. |
| `uploadAttachment`       | POST   | `FormData` with `taskId` and `file`. File is not larger than 10 MB. | New attachment metadata.               |
| `deleteAttachment`       | POST   | Attachment ID.                                                      | Delete the R2 object and D1 row.       |

### Agent runs

| Function                | Method | Purpose                                                                 |
| ----------------------- | ------ | ----------------------------------------------------------------------- |
| `giveTaskToAgent`       | POST   | Queue an implementation run.                                            |
| `planTask`              | POST   | Queue a plan run.                                                       |
| `approvePlan`           | POST   | Change `plan_ready` to `approved` and queue implementation.             |
| `requestPlanChanges`    | POST   | Save feedback, increase the version, and requeue the plan.              |
| `getLatestApprovedPlan` | GET    | Get the last approved plan for a task.                                  |
| `getLatestPlanRun`      | GET    | Get the last plan run for a task.                                       |
| `getAgentRunForTask`    | GET    | Get the last run for a task.                                            |
| `getAgentRun`           | GET    | Get one run with repository results.                                    |
| `listQueuedAgentRuns`   | GET    | Get queued runs in creation order.                                      |
| `listAwaitingMergeRuns` | GET    | Get successful runs with a primary pull request.                        |
| `listAgentRuns`         | GET    | Get all runs with task and project names.                               |
| `updateAgentRun`        | POST   | Update status, logs, plan, pull request, error, and repository results. |
| `stopAgentRun`          | POST   | Change a queued or running run to `stopped`.                            |

Run status values are:

| Status       | Meaning                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `queued`     | The runner can select the run.                                                                               |
| `running`    | The runner or agent is active.                                                                               |
| `success`    | Implementation produced at least one usable pull request.                                                    |
| `error`      | The run did not produce a usable result.                                                                     |
| `merged`     | All required pull requests merged.                                                                           |
| `closed`     | A required pull request closed without merge, or a required repository failed during aggregate merge checks. |
| `plan_ready` | A plan is ready for review.                                                                                  |
| `approved`   | A plan was approved.                                                                                         |
| `stopped`    | A user stopped an active run.                                                                                |

Repository status values are `pending`, `skipped`, `success`, `merged`, `closed`, and `error`.

### Collaboration

| Function                      | Method | Input or purpose                                         |
| ----------------------------- | ------ | -------------------------------------------------------- |
| `listProjectMembers`          | GET    | Project ID.                                              |
| `addProjectMember`            | POST   | Project ID, valid email, optional name, and role.        |
| `removeProjectMember`         | POST   | Member ID.                                               |
| `updateMemberRole`            | POST   | Member ID and role.                                      |
| `requestPlanApproval`         | POST   | Run ID, project ID, requester email, and reviewer email. |
| `listPlanApprovals`           | GET    | Run ID.                                                  |
| `listPendingApprovalsForUser` | GET    | Valid reviewer email.                                    |
| `respondToApproval`           | POST   | Approval ID and `approved` or `rejected`.                |
| `addPlanSuggestion`           | POST   | Run ID, project ID, author email, and non-empty content. |
| `listPlanSuggestions`         | GET    | Run ID.                                                  |

Member roles are `owner`, `manager`, and `member`. Approval status values are `pending`, `approved`, and `rejected`.

## Database tables

All time fields are integer millisecond values unless a different interface converts them.

| Table                    | Primary fields and constraints                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`               | ID, name, position, compatibility repository URL, timestamps, archived flag.                                                                         |
| `project_repositories`   | Project foreign key, unique URL for that project, position, creation time. Cascade on project delete.                                                |
| `tasks`                  | Project foreign key, optional parent ID, title, notes, priority, status, due time, position, completion time, timestamps. Cascade on project delete. |
| `attachments`            | Task and project foreign keys, name, MIME type, size, R2 key, creation time. Cascade on task or project delete.                                      |
| `agent_runs`             | Task and project foreign keys, run status and kind, primary repository and pull request fields, plan data, JSON logs, error, timestamps.             |
| `agent_run_repositories` | Run foreign key, unique repository URL for that run, position, status, branch, pull request, error, timestamps.                                      |
| `project_members`        | Project foreign key, email, optional name, role, creation time.                                                                                      |
| `plan_approvals`         | Run and project foreign keys, requester, reviewer, status, timestamps.                                                                               |
| `plan_suggestions`       | Run and project foreign keys, author, content, creation time.                                                                                        |
| `users`                  | Unique email, optional profile data, provider, unique provider account key, timestamps.                                                              |
| `auth_sessions`          | User foreign key, expiry time, creation time.                                                                                                        |
| `oauth_states`           | State key, provider, PKCE verifier, safe redirect path, expiry time, creation time.                                                                  |

## Environment settings

### Worker settings

| Name                    | Required                 | Purpose                            |
| ----------------------- | ------------------------ | ---------------------------------- |
| `GOOGLE_CLIENT_ID`      | For Google sign-in       | Google OAuth client ID.            |
| `GOOGLE_CLIENT_SECRET`  | For Google sign-in       | Google OAuth client secret.        |
| `GITHUB_CLIENT_ID`      | For GitHub sign-in       | GitHub OAuth client ID.            |
| `GITHUB_CLIENT_SECRET`  | For GitHub sign-in       | GitHub OAuth client secret.        |
| `CF_ACCESS_TEAM_DOMAIN` | For Access fallback      | Cloudflare Access team URL.        |
| `CF_ACCESS_AUDIENCE`    | For Access fallback      | Access application audience.       |
| `RUNNER_API_TOKEN`      | Production runner bridge | Shared secret for `/api/runner/*`. |

`wrangler.jsonc` binds D1 as `DB` and R2 as `ATTACHMENTS`. The production Worker name is `planner`.

### Agent-runner settings

| Name                         | Default                              | Purpose                                                           |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `PLANNER_BASE_URL`           | `http://host.docker.internal:3000`   | Planner bridge origin.                                            |
| `PLANNER_CONTAINER_BASE_URL` | `PLANNER_BASE_URL`                   | Optional Planner origin used inside on-premises job containers.   |
| `OPENHANDS_BASE_URL`         | `http://openhands-agent-server:8000` | OpenHands service origin.                                         |
| `LLM_MODEL`                  | `anthropic/claude-sonnet-5`          | OpenHands provider and model identifier.                          |
| `LLM_API_KEY`                | Empty                                | Model endpoint secret. An empty value causes model calls to fail. |
| `LLM_API_BASE`               | Empty                                | Optional approved enterprise model gateway.                       |
| `SCM_PROVIDER`               | `github`                             | `github` or `bitbucket_data_center`.                              |
| `SCM_TOKEN`                  | `GITHUB_TOKEN` fallback              | Repository, pull request, proof, and merge-watch access.          |
| `BITBUCKET_BASE_URL`         | Empty                                | Bitbucket Data Center base URL.                                   |
| `GITHUB_TOKEN`               | Empty                                | GitHub compatibility token.                                       |
| `RUNNER_API_TOKEN`           | Empty                                | Shared Planner bridge secret.                                     |
| `RUNNER_WORKSPACE`           | `/workspace/runs` in Docker          | Per-run workspace root.                                           |
| `RUNNER_MANAGED_GIT`         | `0`                                  | Prepare repositories in the trusted runner when set to `1`.       |
| `RUNNER_REPOSITORY_CACHE`    | `/var/lib/planner-runner/mirrors`    | Persistent bare repository mirrors.                               |
| `CONTAINER_SELINUX_LABEL`    | Empty                                | Use `z` for shared bind mounts on SELinux hosts.                  |

## Poll and time values

| Operation                   | Value      |
| --------------------------- | ---------- |
| Runner queue poll           | 3 seconds  |
| Runner stop poll            | 5 seconds  |
| GitHub merge check          | 15 seconds |
| Maximum agent run           | 15 minutes |
| Client project-summary poll | 30 seconds |
| Client priority poll        | 30 seconds |
| Client task-run poll        | 10 seconds |
| Client plan-run poll        | 10 seconds |
| Client all-runs poll        | 5 seconds  |
| OAuth state lifetime        | 10 minutes |
| Planner session lifetime    | 30 days    |

## Source map

| Path                                        | Responsibility                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/routes/`                               | Browser pages and HTTP API routes.                                                |
| `src/server/`                               | Validated server functions and authentication middleware.                         |
| `src/db/schema.ts`                          | Drizzle tables, types, and priority rank.                                         |
| `src/db/index.ts`                           | D1 database connection and schema export.                                         |
| `src/lib/queries.ts`                        | Query keys, query options, hooks, mutations, and cache updates.                   |
| `src/components/`                           | Product interface components and dialogs.                                         |
| `src/styles.css`                            | Tailwind import, design tokens, layout, themes, and motion.                       |
| `drizzle/migrations/`                       | Ordered D1 schema changes.                                                        |
| `agent-runner/src/index.ts`                 | Queue loop, plan flow, implementation flow, logs, stop checks, and merge watcher. |
| `agent-runner/src/openhands.ts`             | OpenHands HTTP client.                                                            |
| `agent-runner/src/prompt.ts`                | Plan and implementation prompt contracts.                                         |
| `agent-runner/src/proof.ts`                 | Proof manifest validation and pull request proof rendering.                       |
| `agent-runner/src/handoff.ts`               | Pull request fallback and proof publication.                                      |
| `agent-runner/src/github.ts`                | GitHub REST operations.                                                           |
| `agent-runner/src/bitbucket-data-center.ts` | Bitbucket Data Center Git and pull-request operations.                            |
| `agent-runner/src/managed-workspace.ts`     | Cached mirrors and isolated per-run repository copies.                            |
| `agent-runner/src/onprem-supervisor.ts`     | Bounded on-premises container job supervisor.                                     |
| `docker-compose.local.yml`                  | Local runner and OpenHands service definitions.                                   |
| `wrangler.jsonc`                            | Worker, D1, R2, public variables, and required secrets.                           |

## Related documents

- [Getting started](GETTING_STARTED.md)
- [Architecture](ARCHITECTURE.md)
- [Operations](OPERATIONS.md)
