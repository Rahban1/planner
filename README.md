# Planner

Planner is a full-stack task manager for people and software agents. You can manage projects and tasks, ask an agent for a plan, approve the plan, and send the implementation to GitHub pull requests.

The web application runs on Cloudflare Workers. It uses TanStack Start, React, D1, R2, Drizzle, and TanStack Query. A separate Docker stack runs the Node.js agent runner and OpenHands Agent Server.

## Documentation

The full documentation uses ASD-STE100 Simplified Technical English.

- [Documentation index](docs/README.md)
- [Getting started](docs/GETTING_STARTED.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Operations and troubleshooting](docs/OPERATIONS.md)
- [Technical reference](docs/REFERENCE.md)

## Quick start

Install the packages and start Planner on port 3000:

```bash
pnpm install
pnpm dev --host
```

Open `http://localhost:3000`.

To start the agent services, create `.env` from `.env.example`, set the required secrets, and run:

```bash
docker compose -f docker-compose.local.yml up -d --build --force-recreate
```

For all setup steps and checks, read [Getting started](docs/GETTING_STARTED.md).

## Common commands

```bash
pnpm test
pnpm lint
npx tsc --noEmit
pnpm build
pnpm run deploy
```

The `pnpm test` command also builds and tests the agent runner.

## OAuth callback URLs

Register the exact callback URL for each provider.

| Environment | Google                                                                  | GitHub                                                                  |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Production  | `https://planner.rahban-ghani2001.workers.dev/api/auth/callback/google` | `https://planner.rahban-ghani2001.workers.dev/api/auth/callback/github` |
| Local       | `http://localhost:3000/api/auth/callback/google`                        | `http://localhost:3000/api/auth/callback/github`                        |

Google can use both redirect URLs in one OAuth client. A GitHub OAuth App has one callback URL. Use a separate GitHub OAuth App for local development when necessary.

Set production credentials as Worker secrets:

```bash
pnpm wrangler secret put GOOGLE_CLIENT_ID
pnpm wrangler secret put GOOGLE_CLIENT_SECRET
pnpm wrangler secret put GITHUB_CLIENT_ID
pnpm wrangler secret put GITHUB_CLIENT_SECRET
```

The Google scopes are `openid email profile`. The GitHub scopes are `read:user user:email`. Planner requires a verified email address.

## Repository structure

```text
src/                    Planner Worker, React application, and server functions
drizzle/migrations/     D1 database migrations
agent-runner/           Node.js runner, OpenHands image, and runner tests
public/                 Static images, icons, manifest, and service worker
docs/                   Product, architecture, operations, and reference documents
```

Read [Architecture](docs/ARCHITECTURE.md) before you change authentication, data flow, or agent-run state. Read [Operations](docs/OPERATIONS.md) before you change a deployment, a migration, or the Docker services.

For a secure Linux runner with Bitbucket Data Center, use the [on-premises runner guide](agent-runner/onprem/README.md).
