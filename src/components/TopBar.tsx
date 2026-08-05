import { Link } from '@tanstack/react-router'
import { Sun, Moon, Bot, LogOut } from 'lucide-react'

function LogoMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      style={{ color: 'var(--accent)', flexShrink: 0 }}
    >
      <rect x="15" y="16" width="16" height="4" rx="2" fill="currentColor" fillOpacity={0.4} />
      <rect x="15" y="27" width="10" height="4" rx="2" fill="currentColor" fillOpacity={0.22} />
      <path
        d="M15 42 L22 49 L38 33"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface TopBarProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onWordmarkClick?: () => void
  onLogout?: () => void
}

export function TopBar({ theme, onToggleTheme, onWordmarkClick, onLogout }: TopBarProps) {
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
        <LogoMark />
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
          className="topbar-icon-btn theme-toggle"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          className="topbar-icon-btn"
          onClick={onLogout}
          aria-label="Log out"
          title="Log out"
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
  )
}