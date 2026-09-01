import { useEffect, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { ArrowRight, Github, Loader2, Mail } from 'lucide-react'

type AuthProvider = { name: string; href: string; configured: boolean }
type ProviderResponse = { providers?: AuthProvider[] }

type State =
  | { status: 'loading' }
  | { status: 'ready'; providers: AuthProvider[] }
  | { status: 'error'; message: string }

const authErrorMessage = {
  cancelled: 'Sign-in was cancelled. Please choose a provider to try again.',
  failed:
    'Sign-in could not be completed. Please try again or contact the administrator.',
  access_failed:
    'Company sign-in could not be completed. Please try again or contact the administrator.',
} as const

export function LoginPage() {
  const search = useSearch({ from: '/login' })
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ redirect: search.redirect })

    fetch(`/api/auth/providers?${params}`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => {
        if (!r.ok) throw new Error('provider request failed')
        return r.json()
      })
      .then((data: unknown) => {
        if (cancelled) return
        const result = data as ProviderResponse
        setState({
          status: 'ready',
          providers: (result.providers ?? []).filter(
            (p) => p.name === 'Google' || p.name === 'GitHub',
          ),
        })
      })
      .catch(() => {
        if (!cancelled)
          setState({
            status: 'error',
            message: 'Could not reach the sign-in service.',
          })
      })

    return () => {
      cancelled = true
    }
  }, [search.redirect])

  return (
    <main className="landing-page login-page">
      <section className="landing-shell login-shell">
        <div className="login-card">
          <p className="landing-eyebrow">Welcome</p>
          <h1>
            Sign in to <em>Planner.</em>
          </h1>
          <p className="login-sub">
            Your projects, tasks, and agent runs follow your account.
          </p>

          <div className="login-providers">
            {search.error && (
              <div className="login-error">
                {
                  authErrorMessage[
                    search.error as keyof typeof authErrorMessage
                  ]
                }
                {search.detail && (
                  <span className="login-error-detail">{search.detail}</span>
                )}
              </div>
            )}

            {state.status === 'loading' && (
              <div className="login-loading">
                <Loader2 size={18} className="spin" /> Loading sign-in options…
              </div>
            )}

            {state.status === 'error' && (
              <div className="login-error">{state.message}</div>
            )}

            {state.status === 'ready' && (
              <>
                <div className="login-provider-list">
                  {state.providers.map((provider) =>
                    provider.configured ? (
                      <a
                        key={provider.name}
                        className="login-provider"
                        href={provider.href}
                      >
                        {provider.name === 'GitHub' ? (
                          <Github size={16} />
                        ) : (
                          <Mail size={16} />
                        )}
                        <span>Continue with {provider.name}</span>
                        <ArrowRight
                          size={15}
                          className="login-provider-arrow"
                        />
                      </a>
                    ) : (
                      <button
                        key={provider.name}
                        className="login-provider login-provider-disabled"
                        type="button"
                        disabled
                      >
                        {provider.name === 'GitHub' ? (
                          <Github size={16} />
                        ) : (
                          <Mail size={16} />
                        )}
                        <span>Continue with {provider.name}</span>
                      </button>
                    ),
                  )}
                </div>
                {state.providers.some((provider) => !provider.configured) && (
                  <div className="login-error">
                    Local OAuth credentials are missing. Add the four provider
                    values to the local environment file, then restart Planner.
                  </div>
                )}
              </>
            )}

            {state.status === 'ready' && state.providers.length === 0 && (
              <div className="login-error">
                No sign-in providers are configured. Contact the administrator.
              </div>
            )}
          </div>

          <p className="login-note">
            Sign-in stays in Planner. You will only leave the app briefly to
            authenticate with Google or GitHub.
          </p>
        </div>
      </section>
    </main>
  )
}
