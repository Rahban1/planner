<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/devtools#devtools-app-setup"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-app-setup"
    for: "Install TanStack Devtools, pick framework adapter (React/Vue/Solid/Preact), register plugins via plugins prop, configure shell (position, hotkeys, theme, hideUntilHover, requireUrlFlag, eventBusConfig). TanStackDevtools component, defaultOpen, localStorage persistence."
  - id: "@tanstack/devtools#devtools-marketplace"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-marketplace"
    for: "Publish plugin to npm and submit to TanStack Devtools Marketplace. PluginMetadata registry format, plugin-registry.ts, pluginImport (importName, type), requires (packageName, minVersion), framework tagging, multi-framework submissions, featured plugins."
  - id: "@tanstack/devtools#devtools-plugin-panel"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-plugin-panel"
    for: "Build devtools panel components that display emitted event data. Listen via EventClient.on(), handle theme (light/dark), use @tanstack/devtools-ui components. Plugin registration (name, render, id, defaultOpen), lifecycle (mount, activate, destroy), max 3 active plugins. Two paths: Solid.js core with devtools-ui for multi-framework support, or framework-specific panels."
  - id: "@tanstack/devtools#devtools-production"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools#devtools-production"
    for: "Handle devtools in production vs development. removeDevtoolsOnBuild, devDependency vs regular dependency, conditional imports, NoOp plugin variants for tree-shaking, non-Vite production exclusion patterns."
  - id: "@tanstack/devtools-event-client#devtools-bidirectional"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-bidirectional"
    for: "Two-way event patterns between devtools panel and application. App-to-devtools observation, devtools-to-app commands, time-travel debugging with snapshots and revert. structuredClone for snapshot safety, distinct event suffixes for observation vs commands, serializable payloads only."
  - id: "@tanstack/devtools-event-client#devtools-event-client"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-event-client"
    for: "Create typed EventClient for a library. Define event maps with typed payloads, pluginId auto-prepend namespacing, emit()/on()/onAll()/onAllPluginEvents() API. Connection lifecycle (5 retries, 300ms), event queuing, enabled/disabled state, SSR fallbacks, singleton pattern. Unique pluginId requirement to avoid event collisions."
  - id: "@tanstack/devtools-event-client#devtools-instrumentation"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-event-client#devtools-instrumentation"
    for: "Analyze library codebase for critical architecture and debugging points, add strategic event emissions. Identify middleware boundaries, state transitions, lifecycle hooks. Consolidate events (1 not 15), debounce high-frequency updates, DRY shared payload fields, guard emit() for production. Transparent server/client event bridging."
  - id: "@tanstack/devtools-vite#devtools-vite-plugin"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/devtools-vite#devtools-vite-plugin"
    for: "Configure @tanstack/devtools-vite for source inspection (data-tsd-source, inspectHotkey, ignore patterns), console piping (client-to-server, server-to-client, levels), enhanced logging, server event bus (port, host, HTTPS), production stripping (removeDevtoolsOnBuild), editor integration (launch-editor, custom editor.open). Must be FIRST plugin in Vite config. Vite ^6 || ^7 only."
  - id: "@tanstack/react-start#lifecycle/migrate-from-nextjs"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/react-start#lifecycle/migrate-from-nextjs"
    for: "Step-by-step migration from Next.js App Router to TanStack Start: route definition conversion, API mapping, server function conversion from Server Actions, middleware conversion, data fetching pattern changes."
  - id: "@tanstack/react-start#react-start"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/react-start#react-start"
    for: "React bindings for TanStack Start: createStart, StartClient, StartServer, React-specific imports, re-exports from @tanstack/react-router, full project setup with React, useServerFn hook."
  - id: "@tanstack/react-start#react-start/server-components"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/react-start#react-start/server-components"
    for: "Implement, review, debug, and refactor TanStack Start React Server Components in React 19 apps. Use when tasks mention @tanstack/react-start/rsc, renderServerComponent, createCompositeComponent, CompositeComponent, renderToReadableStream, createFromReadableStream, createFromFetch, Composite Components, React Flight streams, loader or query owned RSC caching, router.invalidate, structuralSharing: false, selective SSR, stale names like renderRsc or .validator, or migration from Next App Router RSC patterns. Do not use for generic SSR or non-TanStack RSC frameworks except brief comparison."
  - id: "@tanstack/router-core#router-core"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core"
    for: "Framework-agnostic core concepts for TanStack Router: route trees, createRouter, createRoute, createRootRoute, createRootRouteWithContext, addChildren, Register type declaration, route matching, route sorting, file naming conventions. Entry point for all router skills."
  - id: "@tanstack/router-core#router-core/auth-and-guards"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/auth-and-guards"
    for: "Route protection with beforeLoad, redirect()/throw redirect(), isRedirect helper, authenticated layout routes (_authenticated), non-redirect auth (inline login), RBAC with roles and permissions, auth provider integration (Auth0, Clerk, Supabase), router context for auth state."
  - id: "@tanstack/router-core#router-core/code-splitting"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/code-splitting"
    for: "Automatic code splitting (autoCodeSplitting), .lazy.tsx convention, createLazyFileRoute, createLazyRoute, lazyRouteComponent, getRouteApi for typed hooks in split files, codeSplitGroupings per-route override, splitBehavior programmatic config, critical vs non-critical properties."
  - id: "@tanstack/router-core#router-core/data-loading"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/data-loading"
    for: "Route loader option, loaderDeps for cache keys, staleTime/gcTime/ defaultPreloadStaleTime SWR caching, pendingComponent/pendingMs/ pendingMinMs, errorComponent/onError/onCatch, beforeLoad, router context and createRootRouteWithContext DI pattern, router.invalidate, Await component, deferred data loading with unawaited promises."
  - id: "@tanstack/router-core#router-core/navigation"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/navigation"
    for: "Link component, useNavigate, Navigate component, router.navigate, ToOptions/NavigateOptions/LinkOptions, from/to relative navigation, activeOptions/activeProps, preloading (intent/viewport/render), preloadDelay, navigation blocking (useBlocker, Block), createLink, linkOptions helper, scroll restoration, MatchRoute."
  - id: "@tanstack/router-core#router-core/not-found-and-errors"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/not-found-and-errors"
    for: "notFound() function, notFoundComponent, defaultNotFoundComponent, notFoundMode (fuzzy/root), errorComponent, CatchBoundary, CatchNotFound, isNotFound, NotFoundRoute (deprecated), route masking (mask option, createRouteMask, unmaskOnReload)."
  - id: "@tanstack/router-core#router-core/path-params"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/path-params"
    for: "Dynamic path segments ($paramName), splat routes ($ / _splat), optional params ({-$paramName}), prefix/suffix patterns ({$param}.ext), useParams, params.parse/stringify, pathParamsAllowedCharacters, i18n locale patterns."
  - id: "@tanstack/router-core#router-core/search-params"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/search-params"
    for: "validateSearch, search param validation with Zod/Valibot/ArkType adapters, fallback(), search middlewares (retainSearchParams, stripSearchParams), custom serialization (parseSearch, stringifySearch), search param inheritance, loaderDeps for cache keys, reading and writing search params."
  - id: "@tanstack/router-core#router-core/ssr"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/ssr"
    for: "Non-streaming and streaming SSR, RouterClient/RouterServer, renderRouterToString/renderRouterToStream, createRequestHandler, defaultRenderHandler/defaultStreamHandler, HeadContent/Scripts components, head route option (meta/links/styles/scripts), ScriptOnce, automatic loader dehydration/hydration, memory history on server, data serialization, document head management."
  - id: "@tanstack/router-core#router-core/type-safety"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-core#router-core/type-safety"
    for: "Full type inference philosophy (never cast, never annotate inferred values), Register module declaration, from narrowing on hooks and Link, strict:false for shared components, getRouteApi for code-split typed access, addChildren with object syntax for TS perf, LinkProps and ValidateLinkOptions type utilities, as const satisfies pattern."
  - id: "@tanstack/router-plugin#router-plugin"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/router-plugin#router-plugin"
    for: "TanStack Router bundler plugin for route generation and automatic code splitting. Supports Vite, Webpack, Rspack, and esbuild. Configures autoCodeSplitting, routesDirectory, target framework, and code split groupings."
  - id: "@tanstack/start-client-core#start-core"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core"
    for: "Core overview for TanStack Start: tanstackStart() Vite plugin, getRouter() factory, root route document shell (HeadContent, Scripts, Outlet), client/server entry points, routeTree.gen.ts, tsconfig configuration. Entry point for all Start skills."
  - id: "@tanstack/start-client-core#start-core/auth-server-primitives"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/auth-server-primitives"
    for: "Server-side authentication primitives for TanStack Start: session cookies (HttpOnly, Secure, SameSite, __Host- prefix), session read/issue/destroy via createServerFn and middleware, OAuth authorization-code flow with state and PKCE, password-reset enumeration defense, CSRF for non-GET RPCs, rate limiting auth endpoints, session rotation on privilege change. Pairs with router-core/auth-and-guards for the routing side."
  - id: "@tanstack/start-client-core#start-core/deployment"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/deployment"
    for: "Deploy to Cloudflare Workers, Netlify, Vercel, Node.js/Docker, Bun, Railway. Selective SSR (ssr option per route), SPA mode, static prerendering, ISR with Cache-Control headers, SEO and head management."
  - id: "@tanstack/start-client-core#start-core/execution-model"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/execution-model"
    for: "Isomorphic-by-default principle, environment boundary functions (createServerFn, createServerOnlyFn, createClientOnlyFn, createIsomorphicFn), ClientOnly component, useHydrated hook, import protection, dead code elimination, environment variable safety (VITE_ prefix, process.env)."
  - id: "@tanstack/start-client-core#start-core/middleware"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/middleware"
    for: "createMiddleware, request middleware (.server only), server function middleware (.client + .server), context passing via next({ context }), sendContext for client-server transfer, global middleware via createStart in src/start.ts, middleware factories, method order enforcement, fetch override precedence."
  - id: "@tanstack/start-client-core#start-core/server-functions"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/server-functions"
    for: "createServerFn (GET/POST), validator (Zod or function), useServerFn hook, server context utilities (getRequest, getRequestHeader, setResponseHeader, setResponseStatus), error handling (throw errors, redirect, notFound), streaming, FormData handling, file organization (.functions.ts, .server.ts)."
  - id: "@tanstack/start-client-core#start-core/server-routes"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-client-core#start-core/server-routes"
    for: "Server-side API endpoints using the server property on createFileRoute, HTTP method handlers (GET, POST, PUT, DELETE), createHandlers for per-handler middleware, handler context (request, params, context), request body parsing, response helpers, file naming for API routes."
  - id: "@tanstack/start-server-core#start-server-core"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/start-server-core#start-server-core"
    for: "Server-side runtime for TanStack Start: createStartHandler, request/response utilities (getRequest, setResponseHeader, setCookie, getCookie, useSession), three-phase request handling, AsyncLocalStorage context."
  - id: "@tanstack/virtual-file-routes#virtual-file-routes"
    run: "pnpm dlx @tanstack/intent@latest load @tanstack/virtual-file-routes#virtual-file-routes"
    for: "Programmatic route tree building as an alternative to filesystem conventions: rootRoute, index, route, layout, physical, defineVirtualSubtreeConfig. Use with TanStack Router plugin's virtualRouteConfig option."
<!-- intent-skills:end -->

# Planner — Project Commands

This is a TanStack Start app on Cloudflare Workers + D1. Drizzle ORM is used for typed SQL. TanStack Query handles client cache with optimistic updates via `useCancel + invalidateQueries`.

## Stack

- **Framework**: TanStack Start (full-stack React) on Cloudflare Workers via `@cloudflare/vite-plugin`
- **DB**: Cloudflare D1 (SQLite). Drizzle ORM (`drizzle-orm/d1`) bound via `env.DB` from `cloudflare:workers`
- **Cache**: TanStack Query (`@tanstack/react-query`) wired for SSR via `@tanstack/react-router-ssr-query` in `src/router.tsx`
- **Styling**: Tailwind v4 (`@import 'tailwindcss'`) + custom design tokens in `src/styles.css`
- **Fonts**: Instrument Serif (display) + Inter (UI) via Google Fonts
- **Backgrounds**: `public/bg.png` (light theme) and `public/bg-dark.png` (dark theme) — full bleed, no scrim
- **Theme**: `data-theme` attribute on `<html>`, persisted in `localStorage('planner-theme')`. Set inline before paint via a script in `__root.tsx` head.
- **Motion**: CSS transitions only. Tokens: `--ease: cubic-bezier(0.175, 0.885, 0.32, 1.1)`, durations 150/200/300ms. `prefers-reduced-motion` drops all transitions.

## Common commands

### Install deps
```bash
pnpm install
```

### Dev server (Cloudflare Workers + local D1)
```bash
pnpm dev
# http://localhost:3000
```

### Typecheck + lint
```bash
npx tsc --noEmit
pnpm lint
pnpm lint --fix
```

### Production build + deploy
```bash
pnpm build
pnpm preview   # run built Worker locally before deploy
pnpm deploy     # builds + wrangler deploy
```

### Database (Cloudflare D1)

Schema lives in `src/db/schema.ts`. Drizzle migrations live in `drizzle/migrations/`.

Generate a new migration after editing `src/db/schema.ts`:
```bash
pnpm drizzle-kit generate --name <migration_name>
```

Apply migration to local D1 (dev):
```bash
pnpm wrangler d1 execute planner --local --file=drizzle/migrations/0000_init.sql
```

Apply seed (only needed first time on a fresh local SQLite):
```bash
pnpm wrangler d1 execute planner --local --file=drizzle/seed.sql
```

Apply migration to remote D1 (production):
```bash
pnpm wrangler d1 execute planner --remote --file=drizzle/migrations/0000_init.sql
```

Regenerate Cloudflare env types after editing `wrangler.jsonc`:
```bash
pnpm wrangler types
```

## Schemas

`projects`: {id, name, position, repoUrl, createdAt, updatedAt, archived}
`tasks`: {id, projectId → projects, parentId → tasks, title, notes, priority (low|medium|high|urgent), status (todo|in_progress|done), dueAt, position, completedAt, createdAt, updatedAt}
`agentRuns`: {id, taskId → tasks, projectId → projects, status (queued|running|success|error|merged|closed), repoUrl, branchName, prUrl, prNumber, logs (JSON array of {t, level, message}), errorMessage, createdAt, updatedAt}

Priority sort = `(priority_rank asc, dueAt asc)`, with NULL dueAt treated as `Number.MAX_SAFE_INTEGER`.

## Architecture

```
src/
  db/
    schema.ts        # Drizzle table definitions
    index.ts         # `db` instance — bound to env.DB inside the worker
  server/
    projects.ts      # CRUD server fns for projects (createServerFn)
    tasks.ts         # CRUD + completeTask + uncompleteTask + deleteTask
    priority.ts      # Cross-project priority-sorted inbox
  lib/
    queries.ts       # TanStack Query keys + hooks (useProjects/useTask/etc.) + mutations
    theme.ts         # useTheme hook (lifts state in __root AppShell)
    ui-context.tsx    # Global UI state (task modal, Cmd+K palette)
    format.ts         # formatDue + priorityClass helpers
  components/
    TopBar.tsx       # Planner. wordmark + ⌘K hint + theme toggle
    PriorityPanel.tsx
    ProjectColumn.tsx # Per-project column on dashboard
    TaskModal.tsx    # Modal for editing/creating tasks
    ProjectPage.tsx  # (Not currently used — project page lives in routes)
    CommandPalette.tsx
    AgentButton.tsx  # "Give to Agent" trigger + live log panel
  routes/
    __root.tsx       # Root document + AppShell (TopBar, TaskModal, CommandPalette, ⌘K handler)
    index.tsx        # Dashboard: priority panel + project columns
    projects.$id.tsx # Project detail page
public/
    bg.png           # light theme background
    bg-dark.png      # dark theme background
drizzle/
    migrations/      # Generated by drizzle-kit
    seed.sql         # Sample data (3 projects, 11 tasks)
agent-runner/
    src/             # Node service that polls planner and drives OpenHands Agent Server
    Dockerfile       # Runner container image
    Dockerfile.agent-server # OpenHands Agent Server container image (Playwright noble + Python 3.12)
```

## Notes on data flow

- Routes use `loader` to fetch SSR data (priority + projects, and per-project summaries on dashboard)
- `useProject` / `useProjectSummary` / `usePriority` / `useTask` use TanStack Query with the loader data as initial cache
- Mutations use `onSuccess` to `invalidateQueries` rather than optimistic cache writes — the visual "instant feel" comes from CSS transitions on the row (200ms slide-out) before the mutation dispatch fires
- Server functions: GET methods for reads (cacheable), POST methods for writes. All inputs validated with Zod.

## Agent runner

The "Give to Agent" feature is split across the Planner UI and an external Node.js runner:

1. UI: `AgentButton` calls `giveTaskToAgent(taskId)` which inserts a queued `agentRuns` row.
2. Dev-only REST bridge: `src/routes/api/runner/$.ts` exposes `/api/runner/*` so the runner can talk to the local planner without Cloudflare Workers.
3. `agent-runner/src/index.ts` polls `/api/runner/queue`, starts an OpenHands conversation for each queued run, streams events back as logs, and writes `.agent-pr-url` / `.agent-branch-name` marker files.
4. OpenHands Agent Server runs in Docker, clones the project's `repoUrl`, creates a branch, implements the task, pushes, and opens a PR.
5. Merge watcher: every 15s the runner fetches `/api/runner/awaiting-merge` (runs with `status='success'` + `prUrl`) and checks each PR via the GitHub REST API (`agent-runner/src/github.ts`, uses `GITHUB_TOKEN`). Merged PR → run status `merged` and the task is auto-completed (`updateAgentRun` sets task `done` + `completedAt`). PR closed without merging → run status `closed` (task untouched, retry available in the UI).

### Local Docker setup

Copy `.env.example` to `.env` and fill in:
- `LLM_API_KEY` — OpenCode Go API key
- `GITHUB_TOKEN` — GitHub PAT for the bot account (push branches + create PRs)
- `LLM_MODEL` / `LLM_API_BASE` — defaults target OpenCode Go. Note: `openai/kimi-k2.7-code` currently returns "Upstream request failed" from OpenCode Go, so the default is `openai/kimi-k2.6` until that model is restored.
- `PLANNER_BASE_URL` — URL the runner uses to reach the planner dev server. Docker Desktop Mac users often need to set this to the host's LAN IP (e.g. `http://192.168.1.22:3000`) instead of `http://host.docker.internal:3000`.

Run:
```bash
pnpm dev                           # start planner on localhost:3000 -- must bind to all interfaces (pnpm dev --host)
docker compose -f docker-compose.local.yml up --build
```

The runner will pick up queued agent runs automatically. Live logs and the final PR URL appear in the UI under the task's **Give to Agent** button.

> The seeded projects use fake repository URLs (`https://github.com/acme/*`). Clicking **Give to Agent** on a seeded task will run the agent but fail with "Repository not found or bot account lacks access." To test a successful PR flow, create a project whose `repoUrl` points to a repo the bot account can push to.

### Agent server image notes

`Dockerfile.agent-server` uses `mcr.microsoft.com/playwright/python:v1.50.0-noble` as its base so Python 3.12, Chromium, and Playwright browser dependencies are pre-installed. OpenHands' `browser_use` tool looks for Playwright browsers under `~/.cache/ms-playwright`, while the Playwright image installs them system-wide at `/ms-playwright`; the Dockerfile symlinks `/root/.cache/ms-playwright` to `/ms-playwright` so Chromium is discoverable.

## Acceptance for changes

Before any PR:
```bash
pnpm lint
npx tsc --noEmit
pnpm build  # smoke-test the production build
```
Run `pnpm dev` and click through: dashboard loads with seeded data, click a task title → modal opens with notes/subtasks, click checkbox → task slides out of list, click project name in column header → project page, ⌘K palette works, theme toggle persists across reloads.
