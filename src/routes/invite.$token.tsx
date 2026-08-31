import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { acceptProjectInvite } from '#/server/collaboration'
import { getCurrentUser } from '#/server/projects'

export const Route = createFileRoute('/invite/$token')({
  loader: async ({ params, location }) => {
    const user = await getCurrentUser()
    if (!user) throw redirect({ to: '/login', search: { redirect: location.href, error: undefined, detail: undefined } })
    return { token: params.token }
  },
  component: InvitePage,
})

function InvitePage() {
  const { token } = Route.useParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const accept = async () => {
    setPending(true)
    setError(null)
    try {
      const result = await acceptProjectInvite({ data: { token } })
      await navigate({ to: '/projects/$id', params: { id: result.projectId } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invite could not be accepted')
    } finally {
      setPending(false)
    }
  }
  return <main className="landing-page"><section className="landing-shell login-shell"><div className="login-card"><p className="landing-eyebrow">Project invite</p><h1>Join this <em>Planner.</em> project</h1><p className="login-sub">Accept the invite to collaborate in the shared task chats.</p><button className="btn btn-primary" onClick={accept} disabled={pending}>{pending ? 'Joining…' : 'Accept invite'}</button>{error && <p className="login-error">{error}</p>}</div></section></main>
}
