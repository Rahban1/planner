import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'planner-theme'
const THEME_COLORS = { dark: '#062318', light: '#fdfaf4' }
type Theme = 'dark' | 'light'

function readInitial(): Theme {
  if (typeof document !== 'undefined') {
    const html = document.documentElement
    if (html.dataset.theme === 'light' || html.dataset.theme === 'dark') {
      return html.dataset.theme
    }
  }
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
    if (window.matchMedia('(prefers-color-scheme: light)').matches)
      return 'light'
  }
  return 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark')
  const didReadInitialTheme = useRef(false)

  useEffect(() => {
    if (!didReadInitialTheme.current) {
      didReadInitialTheme.current = true
      const initialTheme = readInitial()
      if (initialTheme !== theme) {
        setTheme(initialTheme)
        return
      }
    }

    const apply = (next: Theme) => {
      document.documentElement.dataset.theme = next
      document
        .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute('content', THEME_COLORS[next]))
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // ignore quota / privacy-mode errors
      }
    }
    apply(theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggle }
}
