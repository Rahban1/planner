import { useEffect } from 'react'

/** Keep sheets and the task composer above the software keyboard. */
export function AppleWebAppRuntime() {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    let frame = 0
    const sync = () => {
      if (viewport && viewport.scale > 1) return
      const height = viewport?.height ?? window.innerHeight
      const active = document.activeElement
      const editing =
        active instanceof HTMLElement &&
        active.matches(
          'textarea, input:not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]',
        )
      const keyboard = editing && window.innerHeight - height > 120
      root.toggleAttribute('data-keyboard-open', keyboard)
      root.style.setProperty('--visual-viewport-height', `${height}px`)
      root.style.setProperty(
        '--visual-viewport-top',
        `${viewport?.offsetTop ?? 0}px`,
      )
      root.style.setProperty('--page-height', `${root.scrollHeight}px`)
      if (keyboard) document.body.style.height = `${height}px`
      else document.body.style.removeProperty('height')
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
    }
    sync()
    viewport?.addEventListener('resize', schedule)
    viewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', schedule)
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      root.removeAttribute('data-keyboard-open')
      for (const name of [
        '--visual-viewport-height',
        '--visual-viewport-top',
        '--page-height',
      ])
        root.style.removeProperty(name)
      document.body.style.removeProperty('height')
    }
  }, [])
  return null
}
