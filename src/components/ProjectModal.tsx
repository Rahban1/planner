import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useCreateProjectMutation } from '#/lib/queries'
import { useUI } from '#/lib/ui-context'

export function ProjectModal() {
  const { projectModalOpen, closeProjectModal } = useUI()
  const createMut = useCreateProjectMutation()
  const [name, setName] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [fadeClass, setFadeClass] = useState<'closed' | 'open'>('closed')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (projectModalOpen) {
      setName('')
      setRepoUrl('')
      requestAnimationFrame(() => setFadeClass('open'))
      const t = setTimeout(() => nameRef.current?.focus(), 80)
      return () => clearTimeout(t)
    } else {
      setFadeClass('closed')
    }
  }, [projectModalOpen])

  useEffect(() => {
    if (!projectModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeProjectModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projectModalOpen, closeProjectModal])

  if (!projectModalOpen) return null

  const handleCreate = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      nameRef.current?.focus()
      return
    }
    const repo = repoUrl.trim() || null
    createMut.mutate(
      { data: { name: trimmed, repoUrl: repo } },
      { onSuccess: () => closeProjectModal() },
    )
  }

  return (
    <div
      className={`modal-backdrop ${fadeClass === 'open' ? 'open' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeProjectModal()
      }}
    >
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <input
            ref={nameRef}
            className="title-input"
            placeholder="Project name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreate()
            }}
          />
          <button className="modal-close" onClick={closeProjectModal} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-group">
            <div className="field-label">Repository URL (optional)</div>
            <input
              className="ctrl-input"
              style={{ width: '100%' }}
              type="url"
              placeholder="https://github.com/org/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="modal-foot">
          <div className="left" />
          <div className="right">
            <button className="btn btn-ghost" onClick={closeProjectModal}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={createMut.isPending}
            >
              {createMut.isPending ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}