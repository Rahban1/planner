import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export function MessageScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [children])
  return (
    <div ref={ref} className="task-chat-scroller" aria-live="polite">
      {children}
    </div>
  )
}

export function Message({ children, mine = false }: { children: ReactNode; mine?: boolean }) {
  return <article className={`task-chat-message ${mine ? 'mine' : ''}`}>{children}</article>
}

export function Bubble({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'agent' | 'system' }) {
  return <div className={`task-chat-bubble tone-${tone}`}>{children}</div>
}

export function Attachment({ name, href }: { name: string; href?: string }) {
  return href ? <a className="task-chat-attachment" href={href} target="_blank" rel="noreferrer">📎 {name}</a> : <span className="task-chat-attachment">📎 {name}</span>
}

export function Marker({ children }: { children: ReactNode }) {
  return <div className="task-chat-marker">{children}</div>
}
