import { Sun, Moon } from 'lucide-react'

interface TopBarProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onWordmarkClick?: () => void
}

export function TopBar({ theme, onToggleTheme, onWordmarkClick }: TopBarProps) {
  return (
    <header className="topbar">
      <div
        className="wordmark serif"
        onClick={onWordmarkClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onWordmarkClick?.()
        }}
      >
        rg-planner<span className="dot">.</span>
      </div>
      <div className="topbar-right">
        <span className="kbd">⌘ K</span>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  )
}