import { createFileRoute } from '@tanstack/react-router'
import { startOAuth } from '#/server/auth'
import type { AuthProvider } from '#/server/auth'

export const Route = createFileRoute('/api/auth/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const provider = url.searchParams.get('provider')
        if (provider !== 'google' && provider !== 'github') {
          return new Response('Unknown sign-in provider', { status: 400 })
        }

        try {
          return await startOAuth(
            request,
            provider as AuthProvider,
            url.searchParams.get('redirect'),
          )
        } catch (error) {
          console.error('Unable to start OAuth', error)
          return new Response('This sign-in provider is not configured', {
            status: 503,
          })
        }
      },
    },
  },
})
