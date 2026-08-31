import { createFileRoute } from '@tanstack/react-router'
import { providerCredentialsConfigured } from '#/server/auth'

export const Route = createFileRoute('/api/auth/providers')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url)
        const base = new URL('/api/auth/start', request.url)
        const providerUrl = (provider: 'google' | 'github') => {
          const url = new URL(base)
          url.searchParams.set('provider', provider)
          const redirect = requestUrl.searchParams.get('redirect')
          url.searchParams.set(
            'redirect',
            redirect?.startsWith('/') && !redirect.startsWith('//')
              ? redirect
              : '/dashboard',
          )
          return url.pathname + url.search
        }

        return Response.json({
          providers: [
            {
              name: 'Google',
              href: providerUrl('google'),
              configured: providerCredentialsConfigured('google'),
            },
            {
              name: 'GitHub',
              href: providerUrl('github'),
              configured: providerCredentialsConfigured('github'),
            },
          ],
        })
      },
    },
  },
})
