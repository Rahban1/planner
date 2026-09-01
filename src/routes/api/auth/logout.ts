import { createFileRoute } from '@tanstack/react-router'
import { clearSessionCookie } from '#/server/auth'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const response = Response.json({ ok: true })
        response.headers.set('Set-Cookie', clearSessionCookie(request))
        return response
      },
    },
  },
})
