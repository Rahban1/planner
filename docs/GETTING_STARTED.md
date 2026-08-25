# Start Planner on your computer

This tutorial starts the Planner web application with a local D1 database. You will open the application on port 3000 and create a project and a task.

## What you need

- Node.js 20 or a later supported version.
- pnpm 10.32.1 or a compatible pnpm 10 version.
- A current checkout of this repository.
- Local Google or GitHub OAuth client values. Protected Planner pages require a user session.

Docker is not necessary for the first web application result. You need Docker only when you start the agent runner.

## Step 1: Install the packages

Run this command in the repository root:

```bash
pnpm install
```

This command installs the web application packages. The Docker build installs the runner packages later.

## Step 2: Create the local database

Apply the migrations in order:

```bash
for migration in drizzle/migrations/*.sql; do
  pnpm wrangler d1 execute planner --local --file="$migration"
done
```

This command creates the local D1 tables. If the tables already exist, do not apply the same migrations again.

## Step 3: Start Planner

Run:

```bash
pnpm dev --host
```

Open `http://localhost:3000`.

The `--host` option also lets the Docker runner connect to the development server. Keep Planner on port 3000. If Vite selects port 3001, another process already uses port 3000. See [Port 3000 is in use](OPERATIONS.md#port-3000-is-in-use).

## Step 4: Sign in and open the dashboard

Select Google or GitHub on the sign-in page. After sign-in, Planner opens `/dashboard`.

For local OAuth, register these exact callback URLs in the provider configuration:

```text
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/auth/callback/github
```

Google can use more than one redirect URI in one client. A GitHub OAuth App has one callback URL. Use a separate GitHub OAuth App for local development if the production app uses the production callback URL.

## Step 5: Create data

On the dashboard:

1. Select **new project**.
2. Enter a project name.
3. Add at least one GitHub repository URL if you plan to use the agent runner.
4. Save the project.
5. Select **add task** in the project.
6. Enter a task title and save the task.

The new task appears in the project column. It also appears in the priority list because it is an open top-level task.

## Step 6: Check the application

Do these checks:

1. Select the task title. The task dialog must open.
2. Select the task check box. The task must move to the completed list.
3. Select the project name. The project page must open.
4. Use the theme control. The selected theme must stay after a page reload.
5. Press `Command+K` on macOS, or the equivalent Control key shortcut on another system. The command palette must open.

You now have a working Planner application with local data.

## Optional: Load the sample data

Use the seed only for a new local database:

```bash
pnpm wrangler d1 execute planner --local --file=drizzle/seed.sql
```

The sample projects use placeholder GitHub repository URLs. Agent runs for these projects will fail. Create a project with a repository that the configured GitHub token can access.

## Next steps

- To start the agent services, use [How to start the agent runner](OPERATIONS.md#how-to-start-the-agent-runner).
- To understand the system, read [Architecture](ARCHITECTURE.md).
- To find all settings and commands, use [Technical reference](REFERENCE.md).
