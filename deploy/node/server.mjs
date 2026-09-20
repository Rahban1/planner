import { openDatabase } from './storage.mjs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'

if (Number(process.versions.node.split('.')[0]) < 24)
  throw new Error('The internal runtime requires Node.js 24 or later')
const origin = process.env.APP_ORIGIN
if (!origin || new URL(origin).origin !== origin)
  throw new Error('Set APP_ORIGIN to the public origin without a final slash')
if (
  new URL(origin).protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(new URL(origin).hostname)
) {
  throw new Error('APP_ORIGIN must use HTTPS')
}
if (process.env.AUTH_MODE !== 'oauth2_proxy')
  throw new Error('Set AUTH_MODE=oauth2_proxy')
const runnerToken = process.env.RUNNER_API_TOKEN
if (!runnerToken || runnerToken.length < 32)
  throw new Error('RUNNER_API_TOKEN must contain at least 32 characters')
const probeDatabase = openDatabase(
  resolve(process.env.PLANNER_DATA_DIR ?? './data', 'planner.sqlite'),
  resolve(process.env.PLANNER_MIGRATIONS_DIR ?? 'drizzle/migrations'),
)
// Import after validation. The runtime applies migrations before this server listens.
const { default: handler } = await import('../../dist/server/server.js')
const app = new Hono()
app.get('/health/live', (c) => c.text('ok'))
app.get('/health/ready', async (c) => {
  try {
    await access(
      resolve(process.env.PLANNER_DATA_DIR ?? './data', 'planner.sqlite'),
      constants.R_OK | constants.W_OK,
    )
    await probeDatabase.prepare('SELECT 1').first()
    return c.text('ok')
  } catch {
    return c.text('Storage unavailable', 503)
  }
})
function equal(a, b) {
  const first = Buffer.from(a ?? '')
  const second = Buffer.from(b)
  return first.length === second.length && timingSafeEqual(first, second)
}
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/runner/')) {
    if (!equal(c.req.header('x-runner-token'), runnerToken))
      return c.text('Unauthorized', 401)
  } else {
    // Only the OAuth2 Proxy pod can reach this port through the NetworkPolicy.
    // OAuth2 Proxy must replace this header with the authenticated email.
    if (
      !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(
        c.req.header('x-forwarded-email') ?? '',
      )
    )
      return c.text('Proxy identity required', 401)
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      c.req.header('origin') !== origin
    )
      return c.text('Origin check failed', 403)
    if (c.req.path.startsWith('/api/auth/')) {
      if (c.req.path === '/api/auth/logout')
        return c.redirect('/oauth2/sign_out', 303)
      return c.text('Use company sign-in', 404)
    }
    if (c.req.path === '/login') return c.redirect('/dashboard', 302)
  }
  await next()
})
app.use('*', serveStatic({ root: './dist/client' }))
app.all('*', (c) => {
  const request = c.req.raw
  const incoming = new URL(request.url)
  const url = new URL(origin)
  url.pathname = incoming.pathname
  url.search = incoming.search
  return handler.fetch(new Request(url, request))
})
const server = serve({
  fetch: app.fetch,
  hostname: '0.0.0.0',
  port: Number(process.env.PORT ?? 3000),
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 25_000).unref()
  })
}
console.log('Planner listens on port', process.env.PORT ?? 3000)
