import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'planner-theme'
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
  }
  return 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitial)

  useEffect(() => {
    const apply = (next: Theme) => {
      document.documentElement.dataset.theme = next
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