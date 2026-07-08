import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUI } from '#/lib/ui-context'

interface ShortcutGroup {
  title: string
  items: { keys: string[]; label: string }[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['j', '↓'], label: 'Next task' },
      { keys: ['k', '↑'], label: 'Previous task' },
      { keys: ['Enter'], label: 'Open focused task' },
      { keys: ['e'], label: 'Edit focused task' },
      { keys: ['Esc'], label: 'Clear focus / close dialog' },
    ],
  },
  {
    title: 'Task actions',
    items: [
      { keys: ['Space'], label: 'Mark done' },
      { keys: ['x'], label: 'Complete focused task' },
      { keys: ['#'], label: 'Delete focused task' },
      { keys: ['n'], label: 'New task' },
      { keys: ['N'], label: 'New project' },
    ],
  },
  {
    title: 'Global',
    items: [
      { keys: ['⌘K'], label: 'Command palette' },
      { keys: ['/'], label: 'Quick search' },
      { keys: ['g', 'd'], label: 'Go to dashboard' },
      { keys: [','], label: 'Toggle theme' },
      { keys: ['?'], label: 'This help' },
    ],
  },
]

export function ShortcutsHelp() {
  const { shortcutsOpen, closeShortcuts } = useUI()

  useEffect(() => {
    if (!shortcutsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeShortcuts()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcutsOpen, closeShortcuts])

  if (!shortcutsOpen) return null

  return (
    <div
      className="shortcuts-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeShortcuts()
      }}
    >
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-head">
          <div className="serif" style={{ fontSize: 28, letterSpacing: '-0.025em' }}>
            Shortcuts
          </div>
          <button className="modal-close" onClick={closeShortcuts} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="shortcuts-grid">
          {GROUPS.map((group) => (
            <div key={group.title} className="shortcut-group">
              <div className="shortcut-group-title">{group.title}</div>
              {group.items.map((item) => (
                <div key={item.label} className="shortcut-row">
                  <span className="shortcut-label">{item.label}</span>
                  <span className="shortcut-keys">
                    {item.keys.map((k, i) => (
                      <span key={i}>
                        {i > 0 && <span className="shortcut-sep">then</span>}
                        <kbd className="shortcut-kbd">{k}</kbd>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}