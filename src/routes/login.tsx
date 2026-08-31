import { createFileRoute } from '@tanstack/react-router'
import { LoginPage } from '#/components/LoginPage'

export const Route = createFileRoute('/login')({
  validateSearch: (search) => {
    const error =
      search.error === 'cancelled' || search.error === 'failed' || search.error === 'access_failed'
        ? search.error
        : undefined

    return {
      redirect:
        typeof search.redirect === 'string' &&
        search.redirect.startsWith('/') &&
        !search.redirect.startsWith('//')
          ? search.redirect
          : '/dashboard',
      error,
      detail: typeof search.detail === 'string' ? search.detail.slice(0, 200) : undefined,
    }
  },
  component: LoginPage,
})
