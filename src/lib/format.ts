export function formatDue(dueAt: number | null | undefined): string | null {
  if (!dueAt) return null
  const now = new Date()
  const due = new Date(dueAt)
  const ms = due.getTime() - now.getTime()
  const MINS = 60_000
  const HOURS = 60 * MINS
  const DAYS = 24 * HOURS

  const isToday = due.toDateString() === now.toDateString()
  if (isToday) {
    const hr = due.getHours()
    const min = String(due.getMinutes()).padStart(2, '0')
    const ampm = hr >= 12 ? 'pm' : 'am'
    const hr12 = hr % 12 === 0 ? 12 : hr % 12
    if (ms < 0) return `overdue · ${hr12}:${min}${ampm}`
    return `${hr12}:${min}${ampm} today`
  }
  if (ms < DAYS) {
    const diffDays = Math.round((due.getTime() - new Date(now.toDateString()).getTime()) / DAYS)
    if (diffDays === 1) return 'tomorrow'
    if (diffDays === -1) return 'yesterday'
  }
  const month = due.toLocaleString('en-US', { month: 'short' })
  const day = due.getDate()
  const sameYear = due.getFullYear() === now.getFullYear()
  if (sameYear) return `${month} ${day}`
  return `${month} ${day} ${due.getFullYear()}`
}

export function priorityClass(priority: 'low' | 'medium' | 'high' | 'urgent') {
  if (priority === 'urgent') return 'urgent'
  if (priority === 'high') return 'high'
  return ''
}

export function priorityShort(priority: 'low' | 'medium' | 'high' | 'urgent') {
  if (priority === 'urgent') return 'urgent'
  if (priority === 'high') return 'high'
  if (priority === 'medium') return 'med'
  return 'low'
}