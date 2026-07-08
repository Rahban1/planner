import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, Pause, Sun, Search, Bot } from 'lucide-react'
import { usePriority, useProjects } from '#/lib/queries'
import { formatDue } from '#/lib/format'
import { useUI } from '#/lib/ui-context'

interface CommandPaletteProps {
  onToggleTheme: () => void
}

type CmdItem = {
  id: string
  kind: 'task' | 'project' | 'action'
  icon: React.ReactNode
  label: string
  sub?: string
  onSelect: () => void
}

export function CommandPalette({ onToggleTheme }: CommandPaletteProps) {
  const { cmdkOpen, closeCmdk, openTask, openNewTask } = useUI()
  const priority = usePriority()
  const projects = useProjects()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const items = useMemo<CmdItem[]>(() => {
    const tasks = priority.data ?? []
    const taskItems = tasks
      .filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 6)
      .map(
        (t): CmdItem => ({
          id: `task-${t.id}`,
          kind: 'task',
          icon: null,
          label: t.title,
          sub: `${t.priority}${t.dueAt ? ' · ' + (formatDue(t.dueAt) ?? '') : ''}`,
          onSelect: () => {
            openTask(t.id, t.project.name, t.project.repoUrl)
            closeCmdk()
          },
        }),
      )

    const projItems = (projects.data ?? [])
      .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
      .map(
        (p): CmdItem => ({
          id: `proj-${p.id}`,
          kind: 'project',
          icon: <Folder size={14} />,
          label: p.name,
          sub: 'Open project',
          onSelect: () => {
            navigate({ to: '/projects/$id', params: { id: p.id } })
            closeCmdk()
          },
        }),
      )

    const newInProj = (projects.data ?? []).map(
      (p): CmdItem => ({
        id: `new-${p.id}`,
        kind: 'action',
        icon: <Pause size={14} />,
        label: `New task in ${p.name}`,
        sub: 'Open modal',
        onSelect: () => {
          openNewTask(p.id, p.name, p.repoUrl)
          closeCmdk()
        },
      }),
    )

    const agentRunsItem: CmdItem = {
      id: 'agent-runs',
      kind: 'action',
      icon: <Bot size={14} />,
      label: 'Agent runs',
      sub: 'View all agent activity',
      onSelect: () => {
        navigate({ to: '/agent-runs' })
        closeCmdk()
      },
    }

    const themeItem: CmdItem = {
      id: 'theme',
      kind: 'action',
      icon: <Sun size={14} />,
      label: 'Toggle theme',
      sub: 'Light / dark',
      onSelect: () => {
        onToggleTheme()
        closeCmdk()
      },
    }

    const all: CmdItem[] = []
    if (tasks.length) all.push(...taskItems.slice(0, 6))
    all.push(...projItems.slice(0, 4))
    all.push(...newInProj.slice(0, 4))
    all.push(agentRunsItem)
    all.push(themeItem)
    return all
    }, [query, priority.data, projects.data])

  // Filter items by query when typing
  const visible = useMemo(() => {
    if (!query.trim()) return items
    return items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()) || i.sub?.toLowerCase().includes(query.toLowerCase()))
  }, [items, query])

  // Reset state on close
  useEffect(() => {
    if (!cmdkOpen) return
    setQuery('')
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [cmdkOpen])

  // Sync active index when list changes
  useEffect(() => {
    if (active >= visible.length) setActive(0)
  }, [visible.length, active])

  if (!cmdkOpen) return null

  const executeActive = () => {
    const item = visible[active]
    if (item) item.onSelect()
  }

  return (
    <div
      className="cmdk-backdrop open"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeCmdk()
      }}
    >
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-wrap" style={{ position: 'relative' }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: 22,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--g-500)',
              pointerEvents: 'none',
            }}
          />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Jump to task, project, or action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 44 }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, visible.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                executeActive()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeCmdk()
              }
            }}
          />
        </div>
        {visible.length === 0 ? (
          <div className="cmdk-list" style={{ padding: 24, textAlign: 'center', color: 'var(--g-700)' }}>
            No matches.
          </div>
        ) : (
          <div className="cmdk-list">
            {visible.map((item, i) => (
              <div
                key={item.id}
                className={`cmdk-item ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  item.onSelect()
                }}
              >
                <div className="ico">{item.icon}</div>
                <div className="lbl">{item.label}</div>
                <div className="sub">{item.sub}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}