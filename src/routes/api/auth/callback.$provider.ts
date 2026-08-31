import { createFileRoute } from '@tanstack/react-router'
import { clearOAuthStateCookie, completeOAuth } from '#/server/auth'
import type { AuthProvider } from '#/server/auth'

export const Route = createFileRoute('/api/auth/callback/$provider')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const url = new URL(request.url)
        const provider = params.provider
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (
          error ||
          !code ||
          !state ||
          (provider !== 'google' && provider !== 'github')
        ) {
          return Response.redirect(
            new URL('/login?error=cancelled', request.url),
            302,
          )
        }

        try {
          return await completeOAuth(
            request,
            provider as AuthProvider,
            code,
            state,
          )
        } catch (callbackError) {
          console.error('OAuth callback failed', callbackError)
          const message =
            callbackError instanceof Error
              ? callbackError.message
              : String(callbackError)
          return new Response(null, {
            status: 302,
            headers: {
              Location: new URL(
                `/login?error=failed&detail=${encodeURIComponent(message)}`,
                request.url,
              ).toString(),
              'Set-Cookie': clearOAuthStateCookie(request),
            },
          })
        }
      },
    },
  },
})
