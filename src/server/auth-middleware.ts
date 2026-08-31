import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import type { User } from '#/db/schema'
import { getUserFromCookie } from './auth'

export const requireUser = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const request = getRequest()
    let user: User | null = null

    // The runner route has its own machine token check. Calls that it makes to
    // server functions stay inside the same request and must not need a user
    // cookie.
    if (!new URL(request.url).pathname.startsWith('/api/runner/')) {
      user = await getUserFromCookie(request.headers.get('cookie'))
      if (!user) throw new Error('Unauthorized')
    }

    return next({ context: { user } })
  },
)
