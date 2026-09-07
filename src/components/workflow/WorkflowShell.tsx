import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  Folder,
  Inbox,
  Keyboard,
  LogOut,
  Moon,
  Plus,
  Search,
  Sun,
} from 'lucide-react'
import { currentUserQueryOptions } from '#/lib/workflow-queries'
import { useUI } from '#/lib/ui-context'

export function WorkflowShell({
  children,
  theme,
  onToggleTheme,
  onLogout,
}: {
  children: React.ReactNode
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
}) {
  const user = useQuery(currentUserQueryOptions)
  const ui = useUI()
  return (
    <div className="wf-app">
      <aside className="wf-sidebar">
        <Link to="/dashboard" className="wf-brand" aria-label="Planner home">
          Planner<span>.</span>
        </Link>
        <nav className="wf-nav" aria-label="Main navigation">
          <Link to="/dashboard" activeProps={{ className: 'is-active' }}>
            <Inbox size={18} />
            <span>Needs you</span>
          </Link>
          <Link to="/projects" activeProps={{ className: 'is-active' }}>
            <Folder size={18} />
            <span>Projects</span>
          </Link>
          <Link
            to="/new-task"
            search={{ project: undefined }}
            activeProps={{ className: 'is-active' }}
          >
            <Plus size={18} />
            <span>New task</span>
          </Link>
        </nav>
        <button className="wf-search-trigger" aria-label="Search tasks" onClick={ui.openCmdk}>
          <Search size={16} />
          <span>Search tasks</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="wf-sidebar-foot">
          <span className="wf-account">
            {user.data?.name || user.data?.email || 'Your workspace'}
          </span>
          <div className="wf-tools">
            <button
              onClick={onToggleTheme}
              aria-label={
                theme === 'dark' ? 'Use light theme' : 'Use dark theme'
              }
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <Link to="/docs" aria-label="Documentation">
              <BookOpen size={18} />
            </Link>
            <button onClick={ui.openShortcuts} aria-label="Keyboard shortcuts">
              <Keyboard size={18} />
            </button>
            <button onClick={onLogout} aria-label="Sign out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="wf-content">{children}</div>
    </div>
  )
}
