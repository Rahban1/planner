import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import {
  useCreateProjectMutation,
  useProject,
  useUpdateProjectMutation,
} from '#/lib/queries'
import { useUI } from '#/lib/ui-context'

export function ProjectModal() {
  const { projectModalOpen, projectModalProjectId, closeProjectModal } = useUI()
  const createMut = useCreateProjectMutation()
  const updateMut = useUpdateProjectMutation()
  const projectRes = useProject(projectModalProjectId ?? undefined)
  const [name, setName] = useState('')
  const [repoUrls, setRepoUrls] = useState([''])
  const [fadeClass, setFadeClass] = useState<'closed' | 'open'>('closed')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (projectModalOpen) {
      if (!projectModalProjectId) {
        setName('')
        setRepoUrls([''])
      }
      requestAnimationFrame(() => setFadeClass('open'))
      const t = setTimeout(() => nameRef.current?.focus(), 80)
      return () => clearTimeout(t)
    } else {
      setFadeClass('closed')
    }
  }, [projectModalOpen, projectModalProjectId])

  useEffect(() => {
    if (!projectModalOpen || !projectModalProjectId || !projectRes.data) return
    setName(projectRes.data.name)
    setRepoUrls(projectRes.data.repoUrls.length > 0 ? projectRes.data.repoUrls : [''])
  }, [projectModalOpen, projectModalProjectId, projectRes.data])

  useEffect(() => {
    if (!projectModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeProjectModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projectModalOpen, closeProjectModal])

  if (!projectModalOpen) return null

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      nameRef.current?.focus()
      return
    }
    const repositories = [...new Set(repoUrls.map((url) => url.trim()).filter(Boolean))]
    const options = { onSuccess: () => closeProjectModal() }

    if (projectModalProjectId) {
      updateMut.mutate(
        { data: { id: projectModalProjectId, name: trimmed, repoUrls: repositories } },
        options,
      )
      return
    }

    createMut.mutate({ data: { name: trimmed, repoUrls: repositories } }, options)
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
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave()
            }}
          />
          <button className="modal-close" onClick={closeProjectModal} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field-group repository-field-group">
            <div className="field-label">Repositories (optional)</div>
            <div className="field-help">
              The agent changes the primary repository and reads the other repositories as context.
            </div>
            <div className="repository-inputs">
              {repoUrls.map((repoUrl, index) => (
                <div className="repository-input-row" key={index}>
                  <div className="repository-input-main">
                    <label htmlFor={`repository-${index}`}>
                      {index === 0 ? 'Primary repository' : `Context repository ${index}`}
                    </label>
                    <input
                      id={`repository-${index}`}
                      className="ctrl-input"
                      type="url"
                      placeholder="https://github.com/org/repo"
                      value={repoUrl}
                      onChange={(event) =>
                        setRepoUrls((current) =>
                          current.map((url, urlIndex) =>
                            urlIndex === index ? event.target.value : url,
                          ),
                        )
                      }
                    />
                  </div>
                  {repoUrls.length > 1 && (
                    <button
                      className="repository-remove"
                      type="button"
                      aria-label={`Remove repository ${index + 1}`}
                      onClick={() =>
                        setRepoUrls((current) => current.filter((_, urlIndex) => urlIndex !== index))
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {repoUrls.length < 8 && (
              <button
                className="add-repository"
                type="button"
                onClick={() => setRepoUrls((current) => [...current, ''])}
              >
                <Plus size={14} />
                Add another repository
              </button>
            )}
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
              onClick={handleSave}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {createMut.isPending || updateMut.isPending
                ? 'Saving…'
                : projectModalProjectId
                  ? 'Save project'
                  : 'Create project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
