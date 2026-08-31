import { useEffect, useState } from 'react'
import { Users, X, Plus, Trash2 } from 'lucide-react'
import {
  useProjectMembers,
  useAddProjectMemberMutation,
  useRemoveProjectMemberMutation,
  useUpdateMemberRoleMutation,
  useCreateProjectInviteMutation,
} from '#/lib/queries'
import { useUI } from '#/lib/ui-context'

export function MembersModal() {
  const ui = useUI()
  const projectId = ui.membersModal?.projectId ?? null
  const isOpen = !!projectId

  const membersRes = useProjectMembers(projectId ?? '')
  const addMut = useAddProjectMemberMutation()
  const removeMut = useRemoveProjectMemberMutation()
  const roleMut = useUpdateMemberRoleMutation()
  const inviteMut = useCreateProjectInviteMutation()

  const [fadeClass, setFadeClass] = useState<'closed' | 'open'>('closed')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'owner' | 'manager' | 'member'>('member')
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const members = membersRes.data ?? []

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => setFadeClass('open'))
    } else {
      setFadeClass('closed')
      setEmail('')
      setName('')
      setRole('member')
      setInviteLink(null)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ui.closeMembers()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, ui])

  if (!isOpen || !projectId) return null

  const addMember = () => {
    const trimmed = email.trim()
    if (!trimmed) return
    addMut.mutate(
      { data: { projectId, email: trimmed, name: name.trim() || undefined, role } },
      { onSuccess: () => {
        setEmail('')
        setName('')
        setRole('member')
      }},
    )
  }

  const createInvite = () => {
    const trimmed = email.trim()
    if (!trimmed) return
    inviteMut.mutate(
      { data: { projectId, email: trimmed } },
      {
        onSuccess: (result) => {
          setInviteLink(`${window.location.origin}${result.invitePath}`)
          setEmail('')
        },
      },
    )
  }

  return (
    <div
      className={`modal-backdrop ${fadeClass === 'open' ? 'open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) ui.closeMembers()
      }}
    >
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="arm-title-wrap">
            <div className="arm-eyebrow">
              <Users size={13} />
              <span>Project members</span>
            </div>
            <div className="arm-title">Collaborators</div>
          </div>
          <button className="modal-close" onClick={ui.closeMembers} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          {/* Add member form */}
          <div className="field-group">
            <div className="field-label">Add collaborator</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--line-2)',
                  background: 'rgba(242,244,243,0.04)',
                  color: 'var(--g-1000)',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
              <input
                type="text"
                placeholder="Name (optional)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--line-2)',
                  background: 'rgba(242,244,243,0.04)',
                  color: 'var(--g-1000)',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'owner' | 'manager' | 'member')}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--line-2)',
                  background: 'rgba(242,244,243,0.04)',
                  color: 'var(--g-1000)',
                  fontSize: 14,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="member">Member</option>
                <option value="manager">Manager</option>
                <option value="owner">Owner</option>
              </select>
              <button
                className="btn btn-primary"
                onClick={addMember}
                disabled={addMut.isPending || !email.trim()}
                title="Add member"
              >
                <Plus size={14} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={createInvite}
                disabled={inviteMut.isPending || !email.trim()}
                title="Create invite link"
              >
                Invite
              </button>
            </div>
            {inviteLink && (
              <div className="invite-link-row">
                <span>Invite link ready</span>
                <button className="btn btn-ghost" onClick={() => void navigator.clipboard?.writeText(inviteLink)}>Copy link</button>
              </div>
            )}
          </div>

          {/* Member list */}
          <div className="field-group">
            <div className="field-label">Members ({members.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {members.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--line)',
                    background: 'rgba(242,244,243,0.03)',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9999,
                      background: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {(m.name ?? m.email).slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--g-1000)' }}>
                      {m.name || m.email}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--g-700)' }}>{m.email}</div>
                  </div>
                  <select
                    value={m.role}
                    onChange={(e) =>
                      roleMut.mutate({
                        data: { id: m.id, role: e.target.value as 'owner' | 'manager' | 'member' },
                      })
                    }
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--line-2)',
                      background: 'transparent',
                      color: 'var(--g-700)',
                      fontSize: 11,
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="member">Member</option>
                    <option value="manager">Manager</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    className="btn btn-ghost"
                    onClick={() => removeMut.mutate({ data: { id: m.id } })}
                    disabled={removeMut.isPending}
                    title="Remove member"
                    style={{ color: '#e57373' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {members.length === 0 && (
                <div className="serif italic" style={{ color: 'var(--g-700)', padding: '12px 0' }}>
                  No members yet. Add collaborators to share this project.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <div className="left" />
          <div className="right">
            <button className="btn btn-primary" onClick={ui.closeMembers}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
