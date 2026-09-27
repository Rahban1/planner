import { createFileRoute } from '@tanstack/react-router'
import { completeSSOLogin } from '#/server/auth'

export const Route = createFileRoute('/api/auth/sso')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        try {
          return await completeSSOLogin(
            request,
            url.searchParams.get('redirect'),
          )
        } catch (error) {
          console.error('SSO login failed', error)
          const message =
            error instanceof Error ? error.message : String(error)
          return new Response(null, {
            status: 302,
            headers: {
              Location: new URL(
                `/login?error=failed&detail=${encodeURIComponent(message)}`,
                request.url,
              ).toString(),
            },
          })
        }
      },
    },
  },
})
