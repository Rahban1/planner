import { createFileRoute } from '@tanstack/react-router'
import { completeCloudflareAccessLogin } from '#/server/auth'

export const Route = createFileRoute('/api/auth/cloudflare/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        try {
          return await completeCloudflareAccessLogin(
            request,
            url.searchParams.get('redirect'),
          )
        } catch (error) {
          console.error('Cloudflare Access callback failed', error)
          return Response.redirect(new URL('/login?error=access_failed', request.url), 302)
        }
      },
    },
  },
})
