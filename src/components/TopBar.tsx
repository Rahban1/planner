import { Link } from '@tanstack/react-router'
import { Sun, Moon, Bot } from 'lucide-react'

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
        Planner<span className="dot">.</span>
      </div>
      <div className="topbar-right">
        <Link to="/agent-runs" className="topbar-link" title="Agent runs">
          <Bot size={14} />
          <span>Agents</span>
        </Link>
        <div className="kbd-chip-wrap">
          <span className="kbd">⌘ K</span>
          <span className="kbd-hint">Press ? for shortcuts</span>
        </div>
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