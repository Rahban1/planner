import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useUI } from '#/lib/ui-context'

export function ConfirmDialog() {
  const { confirmState, resolveConfirm } = useUI()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirmState) {
      confirmRef.current?.focus()
    }
  }, [confirmState])

  useEffect(() => {
    if (!confirmState) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        resolveConfirm(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        resolveConfirm(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmState, resolveConfirm])

  if (!confirmState) return null

  const {
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    destructive = false,
  } = confirmState

  return (
    <div
      className="modal-backdrop open"
      onClick={(e) => {
        if (e.target === e.currentTarget) resolveConfirm(false)
      }}
      role="presentation"
    >
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-head">
          {destructive && <AlertTriangle size={20} className="confirm-icon" aria-hidden="true" />}
          <h3 id="confirm-title" className="confirm-title">
            {title}
          </h3>
        </div>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="confirm-btn cancel" onClick={() => resolveConfirm(false)}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            className={`confirm-btn ${destructive ? 'destructive' : 'primary'}`}
            onClick={() => resolveConfirm(true)}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
