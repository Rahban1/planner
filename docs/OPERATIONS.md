# How to operate Planner

This guide gives the procedures for local work, agent-runner work, database changes, production deployment, and fault isolation.

## How to start the web application

### Prerequisites

- Install Node.js and pnpm.
- Install the repository packages with `pnpm install`.
- Put local OAuth values in `.env` when you must use provider sign-in.

### Steps

1. Start Vite on port 3000 and bind it to network interfaces:

   ```bash
   pnpm dev --host
   ```

2. Open `http://localhost:3000`.
3. Sign in and open `/dashboard`.

### Verification

Run:

```bash
curl -L -I http://localhost:3000
```

The command must return an HTTP response from Planner. A redirect to `/landing` or `/login` is valid for a browser without a session.

## How to configure OAuth

### Local values

Add these values to `.env`:

```dotenv
GOOGLE_CLIENT_ID=your-local-client-id
GOOGLE_CLIENT_SECRET=your-local-client-secret
GITHUB_CLIENT_ID=your-local-client-id
GITHUB_CLIENT_SECRET=your-local-client-secret
```

Use these local callback URLs:

```text
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/auth/callback/github
```

Restart `pnpm dev` after a value changes.

### Production values

Set the four values as Worker secrets:

```bash
pnpm wrangler secret put GOOGLE_CLIENT_ID
pnpm wrangler secret put GOOGLE_CLIENT_SECRET
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
```

Use these production callback URLs:

```text
https://planner.rahban-ghani2001.workers.dev/api/auth/callback/google
https://planner.rahban-ghani2001.workers.dev/api/auth/callback/github
```

Do not put a secret value in a command, a document, or a Git commit. Wrangler asks for the value without terminal echo.

### Verification

Open this URL:

```text
/api/auth/providers?redirect=/dashboard
```

Each configured provider must have `"configured": true`. Complete the provider callback and confirm that Planner opens `/dashboard`.

## How to start the agent runner

### Prerequisites

- Install Docker Desktop or a compatible Docker service.
- Start Planner with `pnpm dev --host`.
- Create `.env` from `.env.example`.
- Set `LLM_API_KEY` and `GITHUB_TOKEN`.
- Give the GitHub token permission to clone, push, read pull requests, and create pull requests in the target repositories.

### Steps

1. Set the Planner URL in `.env`:

   ```dotenv
   PLANNER_BASE_URL=http://host.docker.internal:3000
   ```

   If this host name does not work on your system, use the host computer LAN address and port 3000.

2. If the Worker has a runner secret, set the same value for the runner:

   ```dotenv
   RUNNER_API_TOKEN=the-same-secret-value
   ```

3. Build and start both services:

   ```bash
   docker compose -f docker-compose.local.yml up -d --build --force-recreate
   ```

4. Inspect service state:

   ```bash
   docker compose -f docker-compose.local.yml ps
   ```

The OpenHands service must become healthy. The agent-runner service must stay in the running state.

### Verification

Create a Planner project with a real GitHub repository URL. Create a small task. Select **Give to Agent**. Confirm these events:

1. The run changes from `queued` to `running`.
2. Logs appear in the run dialog.
3. The run has a pull request URL, or it reports a clear error.
4. The pull request body has a verification-proof section.

Do not use the sample `acme` repository URLs for this check.

## How to change runner configuration

The correct Docker action depends on the changed file.

| Change                                 | Required action                                                          |
| -------------------------------------- | ------------------------------------------------------------------------ |
| A file in `agent-runner/src/`          | Rebuild and recreate `agent-runner`.                                     |
| `agent-runner/Dockerfile`              | Rebuild and recreate `agent-runner`.                                     |
| `agent-runner/Dockerfile.agent-server` | Rebuild and recreate `openhands-agent-server`.                           |
| A value in `.env` only                 | Recreate the affected service. A rebuild is not necessary.               |
| `docker-compose.local.yml`             | Recreate the affected services. Rebuild if the image definition changed. |

Use this command after runner source changes:

```bash
docker compose -f docker-compose.local.yml up -d --build --force-recreate agent-runner
```

Use this command after environment-only changes:

```bash
docker compose -f docker-compose.local.yml up -d --force-recreate agent-runner
```

## How to run quality checks

Run the complete repository test command:

```bash
pnpm test
```

This command runs the web Vitest suite and the Node.js runner tests.

Run the acceptance checks before a production change:

```bash
pnpm lint
npx tsc --noEmit
pnpm build
```

For runner-only work, this command builds the runner and runs its Node.js tests:

```bash
npm --prefix agent-runner test
```

## How to create and apply a database migration

### Create a migration

1. Change `src/db/schema.ts`.
2. Generate SQL:

   ```bash
   pnpm drizzle-kit generate --name change_name
   ```

3. Read the generated SQL before you apply it.

### Apply a local migration

Run:

```bash
pnpm wrangler d1 execute planner --local --file=drizzle/migrations/NNNN_change_name.sql
```

### Apply a production migration

Back up important data and confirm the exact migration file. Then run:

```bash
pnpm wrangler d1 execute planner --remote --file=drizzle/migrations/NNNN_change_name.sql
```

### Verification

Start Planner and use the changed function. Also run the build and test commands. A generated migration file is not proof that the remote migration ran.

## How to deploy the Worker

### Prerequisites

- Authenticate Wrangler for the correct Cloudflare account.
- Apply required production migrations.
- Set all required Worker secrets.
- Confirm the D1 database ID and R2 bucket in `wrangler.jsonc`.

### Steps

1. Run the quality checks.
2. Deploy with the package script:

   ```bash
   pnpm run deploy
   ```

The script runs `pnpm run build` and then `wrangler deploy`.

### Verification

Open:

```text
https://planner.rahban-ghani2001.workers.dev
```

Complete the full sign-in callback. Confirm that the dashboard loads. If the runner uses production Planner, queue one small run and confirm that the runner can read and update it.

## How to set the runner bridge secret

Set the Worker secret:

```bash
pnpm wrangler secret put RUNNER_API_TOKEN
```

Put the same value in the runner `.env` file. Then recreate the runner container.

When the Worker secret exists, every `/api/runner/*` request must include `X-Runner-Token`. When the secret does not exist, the bridge accepts requests without this header. Use an unset secret only for local development on a trusted system.

## Troubleshooting

### Port 3000 is in use

Inspect the process before you stop it:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

If the process is the intended Planner server, keep it. Do not start another server on port 3001. If it is a stale process from this repository, stop that process and start Planner again on port 3000.

### The runner cannot reach Planner

Check `PLANNER_BASE_URL`. From Docker Desktop on macOS, try `http://host.docker.internal:3000`. If this fails, use the host LAN address. Planner must use `pnpm dev --host`.

### The runner gets HTTP 401

The Worker and runner have different `RUNNER_API_TOKEN` values, or one side has no value. Set the same value on both sides. Recreate the runner after an `.env` change.

### OAuth reports a redirect mismatch

Compare the full callback URL. The scheme, host, port, provider name, and path must be exact. Local and production URLs are different.

### GitHub sign-in returns no email

Planner requires a verified email address. GitHub first returns the profile email. If it is empty, Planner reads `/user/emails` and selects a verified email. Confirm that the OAuth app asks for `user:email`.

### A run says that the repository was not found

Confirm the repository URL and the GitHub token permissions. The sample seed URLs are not real repositories.

### A run finishes without a pull request

Inspect the run logs. Confirm that the agent pushed a branch. If a branch exists, the runner can create a ready fallback pull request. The runner needs `GITHUB_TOKEN` for this action.

### A plan run has no plan

The agent must write `.agent-plan-md` in the workspace root or primary repository workspace. If the file is absent or empty, the run changes to `error`.

### Proof is INCOMPLETE

Read the proof errors in the pull request. Common causes are a missing manifest, an uncommitted proof file, or an incorrect tested commit. Other causes are a symbolic link, an unsafe path, or an artifact that is too large.

### A merged pull request does not complete the task

Confirm that the runner is active and has `GITHUB_TOKEN`. For a project with more than one repository, all non-skipped pull requests must merge. The merge watcher checks every 15 seconds.

For exact values and endpoint names, use [Technical reference](REFERENCE.md).
