import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'

type AuthProvider = { name: string; href: string }

type State =
  | { status: 'loading' }
  | { status: 'authenticated' }
  | { status: 'ready'; providers: AuthProvider[] }
  | { status: 'error'; message: string }

function GoogleIcon() {
  return (
    <svg viewBox="0 0 256 262" width="18" height="18" aria-hidden>
      <path fill="#4285F4" d="M255.9 133.5c0-9.3-.8-18.2-2.4-26.8H130.6v50.7h70.3c-3 16.1-12.3 29.8-26.1 38.9v32.4h42.3c24.7-22.8 39-56.4 39-95.2z" />
      <path fill="#34A853" d="M130.6 261.1c35.4 0 65.1-11.7 86.8-31.8l-42.3-32.4c-11.7 7.8-26.8 12.5-44.5 12.5-34.2 0-63.2-23.1-73.5-54.2H13.9v33.4c21.5 42.8 65.8 72.5 116.7 72.5z" />
      <path fill="#FBBC05" d="M57.1 155.2c-2.6-7.8-4.1-16.2-4.1-24.7s1.5-16.9 4.1-24.7V72.4H13.9C5 90.7 0 111.3 0 130.5s5 39.8 13.9 58.1l43.2-33.4z" />
      <path fill="#EA4335" d="M130.6 50.8c19.2 0 36.5 6.6 50.1 19.6l37.6-37.6C195.6 11.7 166 0 130.6 0 79.7 0 35.4 29.7 13.9 72.4l43.2 33.4c10.3-31.1 39.3-54.2 73.5-54.2z" />
    </svg>
  )
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

const PROVIDER_META: Record<string, { label: string; icon: React.ReactNode }> = {
  Google: { label: 'Continue with Google', icon: <GoogleIcon /> },
  GitHub: { label: 'Continue with GitHub', icon: <GithubIcon /> },
}

export function LoginPage() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    // If Access is in front, an unauthenticated request to a protected path
    // redirects (302) to the login page. A 200 means we already hold a valid
    // CF_Authorization cookie -> go straight to the dashboard.
    const checkAuth = () =>
      fetch('/dashboard', { method: 'GET', redirect: 'manual', credentials: 'include' })

    checkAuth()
      .then((authRes) => {
        if (cancelled) return
        if (authRes.status === 200) {
          setState({ status: 'authenticated' })
          return
        }
        // 302 (or anything else) -> not authenticated; load providers.
        return fetch('/api/auth/providers', { headers: { Accept: 'application/json' } })
          .then((r) => r.json())
          .then((data: unknown) => {
            if (cancelled) return
            const result = data as { providers?: AuthProvider[] }
            setState({
              status: 'ready',
              providers: (result.providers ?? []).filter(
                (p) => p.name === 'Google' || p.name === 'GitHub',
              ),
            })
          })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', message: 'Could not reach the sign-in service.' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'authenticated') {
    window.location.assign('/dashboard')
    return null
  }

  return (
    <main className="landing-page login-page">
      <section className="landing-shell login-shell">
        <div className="login-card">
          <p className="landing-eyebrow">Welcome</p>
          <h1>
            Sign in to <em>Planner.</em>
          </h1>
          <p className="login-sub">
            Choose how you&apos;d like to continue. Your projects, tasks, and agent runs follow your
            account.
          </p>

          <div className="login-providers">
            {state.status === 'loading' && (
              <div className="login-loading">
                <Loader2 size={18} className="spin" /> Checking sign-in…
              </div>
            )}

            {state.status === 'error' && (
              <div className="login-error">{state.message}</div>
            )}

            {state.status === 'ready' &&
              (state.providers.length > 0 ? (
                state.providers.map((p) => {
                  const meta = PROVIDER_META[p.name] ?? {
                    label: `Continue with ${p.name}`,
                    icon: null,
                  }
                  return (
                    <a key={p.name} className="login-provider" href={p.href}>
                      {meta.icon}
                      <span>{meta.label}</span>
                      <ArrowRight size={15} className="login-provider-arrow" />
                    </a>
                  )
                })
              ) : (
                <div className="login-error">
                  No sign-in providers are configured yet. Add Google or GitHub in Cloudflare Access
                  to enable sign-in.
                </div>
              ))}
          </div>

          <p className="login-note">
            Sign-in is powered by Cloudflare Access. You can use your GitHub or Google account.
          </p>
        </div>
      </section>
    </main>
  )
}
