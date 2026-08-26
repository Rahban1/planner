# Planner architecture

Planner separates user requests from long agent work. A Cloudflare Worker serves the web application and stores control data. A Docker stack runs OpenHands and can use a longer process lifetime.

## The problem

A Cloudflare Worker is suitable for short web requests. An agent run can take up to 15 minutes. It must clone repositories, run commands, use a browser, push branches, and create pull requests. This work does not fit a normal Worker request.

Planner solves this problem with a queue record in D1 and an external runner. The Worker stays responsive while the runner does the long work.

## Component map

```text
Browser
  |
  | HTTPS, session cookie
  v
Cloudflare Worker: TanStack Start
  |-- React routes and server rendering
  |-- TanStack server functions
  |-- OAuth and session checks
  |-- /api/runner/* machine bridge
  |
  |----> D1: control data and run state
  |----> R2: attachment file bodies
  |
  | X-Runner-Token
  v
Node.js agent runner
  |-- queue poll
  |-- log and status updates
  |-- GitHub pull request checks
  |
  v
OpenHands Agent Server
  |-- repository workspace
  |-- terminal, file editor, browser, task tracker
  |-- OpenCode Go model endpoint
  |
  v
GitHub repositories and pull requests
```

## Web application

TanStack Start supplies the React application, server rendering, file routes, and server functions. `src/routes/__root.tsx` creates the document shell and all shared dialogs. `src/router.tsx` joins TanStack Router and TanStack Query for server rendering.

Protected page loaders call `getCurrentUser`. If no valid user exists, the loader redirects the browser to `/login`. Server functions use the `requireUser` middleware. The runner bridge is the only path-based exception. That bridge has its own machine-token check.

The main pages are:

- `/landing`: public product page.
- `/login`: sign-in page.
- `/dashboard`: priority list and project columns.
- `/projects/$id`: one project and its tasks.
- `/agent-runs`: all agent runs.

## Client data flow

Page loaders read the first data set on the server. React then uses the loader result as initial data. TanStack Query owns the client cache after hydration.

```text
Route loader -> server function -> D1 -> HTML and loader data
                                      |
                                      v
Browser -> TanStack Query cache -> React component
                  |
                  v
             mutation call
                  |
                  v
       cache update or invalidation
```

The priority list and project summaries poll every 30 seconds. Run detail queries poll every 10 seconds. The full run list polls every 5 seconds. These intervals make agent changes visible without a page reload.

Some mutations write the returned object directly to the cache. Other mutations invalidate a query and read fresh data. This mixed method keeps common user actions fast and also gets server-side changes, such as an automatic task completion after a merge.

## Data storage

D1 stores relational control data. Drizzle defines the schema in `src/db/schema.ts`. SQL migrations are in `drizzle/migrations/`.

The main data relationships are:

```text
users -> auth_sessions

projects
  |-- project_repositories
  |-- project_members
  |-- tasks
       |-- subtasks through tasks.parent_id
       |-- attachments
       |-- agent_runs
            |-- agent_run_repositories
            |-- plan_approvals
            |-- plan_suggestions
```

R2 stores attachment file bodies. D1 stores attachment names, MIME types, sizes, and R2 keys. The file size limit is 10 MB for each attachment.

Deleting a project removes its tasks and related child rows through database cascade rules. `deleteTask` explicitly deletes child tasks before it deletes a top-level task.

## Authentication flow

Planner supports Google OAuth, GitHub OAuth, and a configured Cloudflare Access identity.

The Google and GitHub flow is:

```text
Browser -> /api/auth/start
        -> create state and PKCE verifier in D1
        -> set short OAuth-state cookie
        -> provider sign-in
        -> /api/auth/callback/{provider}
        -> check cookie, state, expiry, and PKCE verifier
        -> read a verified email address
        -> create or update user
        -> create 30-day session in D1
        -> set HttpOnly session cookie
```

The OAuth state is valid for 10 minutes. The session is valid for 30 days. Cookies use `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS.

The redirect filter accepts only a local path that starts with one slash. It rejects protocol-relative paths and backslashes. The default redirect is `/dashboard`.

## Task and priority flow

A task can be a top-level task or a subtask. `parentId` identifies a subtask. The priority list contains only open top-level tasks from active projects.

The sort order is:

1. Priority: urgent, high, medium, low.
2. Due date: oldest date first.
3. No due date: after all dated tasks in the same priority.

Completing a top-level task does not complete its subtasks. This behavior is explicit in the task server code.

## Agent implementation flow

```text
User selects Give to Agent
  -> Worker creates agent_runs row with status queued
  -> Worker copies the project repository list into the run snapshot
  -> runner reads /api/runner/queue every 3 seconds
  -> runner changes status to running
  -> runner gets task context and attachment metadata
  -> OpenHands clones each repository and changes files
  -> agent pushes branch and writes handoff markers
  -> runner validates the proof package
  -> runner creates or updates pull requests
  -> run status becomes success
  -> merge watcher checks GitHub every 15 seconds
  -> all required pull requests merge
  -> run status becomes merged
  -> Worker marks the task done
```

The run stores a copy of the repository list at queue time. A later project edit does not change an active run.

The runner processes one queued run at a time. It polls a user stop request every 5 seconds. The maximum run time is 15 minutes. At the limit, the runner still checks for a pushed branch or a pull request before it reports an error.

For a project with more than one repository, each repository has its own status, branch, and pull request. The task becomes done only after all non-skipped repository pull requests merge. One closed or failed required repository changes the aggregate run status to `closed`.

## Plan flow

A plan run uses the same queue, runner, and log paths. Its prompt tells the agent to inspect repositories without a code change. The agent writes `.agent-plan-md`.

```text
queued -> running -> plan_ready
                       |-- request changes -> queued with a new version
                       `-- approve -> approved + new implementation run
```

An approved plan becomes part of the task context for the next implementation run.

## Verification proof flow

The implementation prompt reserves time for verification. The agent writes a proof package under `.planner/proof/{runId}`. The manifest records checks, artifacts, tested commit, limitations, and reproduction commands.

The runner checks these items before it changes the pull request body:

- The manifest format and run ID.
- The tested commit in the pull request.
- The committed state of each proof file.
- Safe relative file paths.
- No symbolic-link artifacts.
- A 10 MB limit for one artifact and a 20 MB limit for the package.
- An allowed file extension for each artifact type.
- Agreement between check results and the overall result.

The proof can report `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`. Missing or invalid proof becomes `INCOMPLETE`. The runner does not change an incomplete result to a pass result.

## Design trade-offs

### External runner

The external runner gives long execution time and a full tool environment. The cost is an additional Docker service and a machine-token boundary.

### Polling

Polling is simple and works through common network controls. The cost is delayed updates and repeated reads. Planner does not use a WebSocket event channel.

### D1 run queue

The D1 row is both the queue item and the user-visible run record. This keeps one source of state. The cost is that the runner must use careful status transitions and retry failed updates.

### Repository snapshots

A run keeps the repository list that existed at queue time. This makes the run stable and auditable. The cost is that a project repository change does not repair an already queued run.

## Current constraints

- Project member roles are stored, but server functions do not use the roles for authorization. An authenticated user can call the current project and task server functions.
- The direct attachment route requires a Planner session cookie. The runner receives attachment URLs, but the route does not accept the runner token.
- The runner processes only one queued run at a time.
- The runner supports GitHub repository URLs and GitHub pull requests.
- Completing a parent task does not complete its subtasks.
- Server functions validate data shape, but they do not enforce project ownership.

Read [Technical reference](REFERENCE.md) for exact interfaces and values. Read [Operations](OPERATIONS.md) for runtime procedures.
