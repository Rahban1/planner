import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { PriorityCard } from '#/server/priority'
import { formatDue, priorityClass } from '#/lib/format'

interface PriorityPanelProps {
  items: PriorityCard[]
  onTaskClick?: (id: string) => void
}

export function PriorityPanel({ items, onTaskClick }: PriorityPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <section className="priority-section">
      <div className="priority-head">
        <span className="label">
          <span className="dot" />
          Priority
        </span>
        <span
          className="hide"
          onClick={() => setCollapsed((c) => !c)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setCollapsed((c) => !c)
          }}
        >
          {collapsed ? 'show' : 'hide'}
          <ChevronDown size={10} />
        </span>
      </div>

      {!collapsed && (
        <div className="priority-list">
          {items.length === 0 ? (
            <div className="pcard" style={{ cursor: 'default' }}>
              <div className="title">Nothing urgent right now.</div>
            </div>
          ) : (
            items.map((t) => {
              const due = formatDue(t.dueAt)
              return (
                <div
                  key={t.id}
                  className="pcard"
                  onClick={() => onTaskClick?.(t.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onTaskClick?.(t.id)
                  }}
                >
                  <div className="meta">
                    <span className={`urg ${priorityClass(t.priority)}`}>
                      {t.priority}
                    </span>
                    {due && (
                      <>
                        <span className="sep">·</span>
                        {due}
                      </>
                    )}
                  </div>
                  <div className="title">{t.title}</div>
                  <div className="proj">{t.project.name}</div>
                </div>
              )
            })
          )}
        </div>
      )}
    </section>
  )
}