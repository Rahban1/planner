import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useFocus } from '#/lib/focus-context'
import { useUI } from '#/lib/ui-context'

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  if (el.getAttribute('role') === 'textbox') return true
  // Inside modal/palette/overlay — let those handle their own keys
  if (el.closest('.modal-backdrop, .cmdk-backdrop, .shortcuts-overlay')) return true
  return false
}

export function useKeyboardShortcuts(onToggleTheme: () => void) {
  const navigate = useNavigate()
  const focus = useFocus()
  const ui = useUI()
  const chordRef = useRef<string | null>(null)
  const chordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // --- If a modal / palette / overlay is open, only handle Escape ---
      const anyOverlayOpen = ui.taskModal !== null || ui.cmdkOpen || ui.projectModalOpen || ui.shortcutsOpen || ui.confirmState !== null
      if (anyOverlayOpen) return

      // --- If typing in an input, only handle ⌘K and Escape ---
      if (isTypingTarget(e.target)) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault()
          ui.openCmdk()
        }
        return
      }

      const key = e.key
      const lower = key.toLowerCase()
      const hasMeta = e.metaKey || e.ctrlKey

      // Reset chord on any actionable key or if chord is stale
      const clearChord = () => {
        chordRef.current = null
        if (chordTimeoutRef.current) {
          clearTimeout(chordTimeoutRef.current)
          chordTimeoutRef.current = null
        }
      }

      const setChord = (c: string) => {
        chordRef.current = c
        if (chordTimeoutRef.current) clearTimeout(chordTimeoutRef.current)
        chordTimeoutRef.current = setTimeout(clearChord, 800)
      }

      // --- ⌘K / Ctrl+K: command palette ---
      if (hasMeta && lower === 'k') {
        e.preventDefault()
        clearChord()
        ui.openCmdk()
        return
      }

      // --- Escape: clear chord or focus ---
      if (key === 'Escape') {
        if (chordRef.current) {
          clearChord()
        } else {
          focus.clearFocus()
        }
        return
      }

      // --- Chord: g then d/p ---
      if (chordRef.current === 'g') {
        clearChord()
        if (lower === 'd') {
          e.preventDefault()
          navigate({ to: '/' })
          return
        }
        // 'g p' could go to project page of the focused column — we don't have column focus yet
        // fall through to let the key be processed normally
      }

      // --- Single-key shortcuts (no meta/ctrl, not typing) ---
      if (hasMeta) return // Let browser shortcuts pass through

      // Prevent default for keys we handle so they don't scroll the page
      const handledKeys = new Set([
        'j',
        'k',
        'h',
        'l',
        'n',
        'N',
        'x',
        'e',
        '#',
        '?',
        '/',
        ',',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Enter',
        ' ',
        'g',
      ])

      if (!handledKeys.has(lower) && !handledKeys.has(key)) {
        clearChord()
        return
      }

      e.preventDefault()
      clearChord()

      // === Navigation ===
      if (key === 'ArrowDown' || lower === 'j') {
        focus.next()
        return
      }
      if (key === 'ArrowUp' || lower === 'k') {
        focus.prev()
        return
      }

      // === Open focused task (Enter / e) ===
      if (key === 'Enter' || lower === 'e') {
        if (focus.focusedTaskId) {
          const actions = focus.getActions(focus.focusedTaskId)
          actions?.open()
        }
        return
      }

      // === Complete focused task (Space / x) ===
      if (key === ' ' || lower === 'x') {
        if (focus.focusedTaskId) {
          const actions = focus.getActions(focus.focusedTaskId)
          actions?.complete()
        }
        return
      }

      // === Delete focused task (#) ===
      if (key === '#') {
        if (focus.focusedTaskId) {
          const actions = focus.getActions(focus.focusedTaskId)
          if (actions) {
            ui.requestConfirm({
              title: 'Delete this task?',
              message: 'This cannot be undone.',
              confirmText: 'Delete',
              cancelText: 'Cancel',
              destructive: true,
            }).then((confirmed) => {
              if (confirmed) actions.delete()
            })
          }
        }
        return
      }

      // === New task (n) ===
      if (lower === 'n') {
        ui.openNewTask('')
        return
      }

      // === New project (N / Shift+N) ===
      if (key === 'N') {
        ui.openProjectModal()
        return
      }

      // === Command palette shortcut (/) ===
      if (key === '/') {
        ui.openCmdk()
        return
      }

      // === Toggle theme (,) ===
      if (key === ',') {
        onToggleTheme()
        return
      }

      // === Shortcuts help (?) ===
      if (key === '?') {
        ui.openShortcuts()
        return
      }

      // === Start chord (g) ===
      if (lower === 'g') {
        setChord('g')
        return
      }

      // ArrowLeft / ArrowRight: skip for now (column-level focus in v2)
      // We preventDefault but don't act — keeps focus inside the viewport
      if (key === 'ArrowLeft' || key === 'ArrowRight' || lower === 'h' || lower === 'l') {
        return
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (chordTimeoutRef.current) clearTimeout(chordTimeoutRef.current)
    }
  }, [navigate, focus, ui, onToggleTheme])
}