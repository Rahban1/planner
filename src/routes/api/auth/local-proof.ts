import { createFileRoute } from '@tanstack/react-router'
import { createLocalProofSession } from '#/server/auth'
import { canUseLocalProofLogin } from '#/server/local-proof'

function unavailable() {
  return new Response('Not found', { status: 404 })
}

function isAvailable(request: Request) {
  return canUseLocalProofLogin(request.url, import.meta.env.DEV)
}

export const Route = createFileRoute('/api/auth/local-proof')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAvailable(request)) return unavailable()

        return new Response(
          `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Planner local proof</title></head>
  <body>
    <main>
      <h1>Planner local proof</h1>
      <p>This session uses local test data only.</p>
      <form method="post"><button type="submit">Open proof dashboard</button></form>
    </main>
  </body>
</html>`,
          {
            headers: {
              'Cache-Control': 'no-store',
              'Content-Type': 'text/html; charset=utf-8',
            },
          },
        )
      },
      POST: async ({ request }) => {
        if (!isAvailable(request)) return unavailable()
        const origin = request.headers.get('origin')
        if (origin && origin !== new URL(request.url).origin) {
          return new Response('Forbidden', { status: 403 })
        }
        return createLocalProofSession(request)
      },
    },
  },
})
