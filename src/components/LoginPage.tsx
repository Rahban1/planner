import { useSearch } from '@tanstack/react-router'
import { ArrowRight, Building2 } from 'lucide-react'

const authErrorMessage = {
  cancelled: 'Sign-in was cancelled. Please try again.',
  failed:
    'Sign-in could not be completed. Please try again or contact the administrator.',
  access_failed:
    'Company sign-in could not be completed. Please try again or contact the administrator.',
} as const

export function LoginPage() {
  const search = useSearch({ from: '/login' })

  const ssoUrl = `/api/auth/sso?redirect=${encodeURIComponent(search.redirect)}`

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

            <div className="login-provider-list">
              <a className="login-provider" href={ssoUrl}>
                <Building2 size={16} />
                <span>Continue with TI SSO</span>
                <ArrowRight size={15} className="login-provider-arrow" />
              </a>
            </div>
          </div>

          <p className="login-note">
            You will be authenticated through Texas Instruments single sign-on.
          </p>
        </div>
      </section>
    </main>
  )
}
