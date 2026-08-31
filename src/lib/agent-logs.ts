export type AgentLogEntry = {
  t: number
  level: 'info' | 'warn' | 'error'
  message: string
}

type AgentLogExport = {
  title: string
  status: string
  errorMessage?: string | null
  logs: AgentLogEntry[]
}

/** Create a plain-text diagnostic bundle that is easy to paste into an issue or agent prompt. */
export function formatAgentLogs({ title, status, errorMessage, logs }: AgentLogExport): string {
  const lines = [`Agent run: ${title}`, `Status: ${status}`]

  if (errorMessage) lines.push(`Error: ${errorMessage}`)

  lines.push('', 'Logs:')
  lines.push(
    ...logs.map((log) => {
      const time = Number.isFinite(log.t) ? new Date(log.t).toISOString() : 'Unknown time'
      return `${time} [${log.level.toUpperCase()}] ${log.message}`
    }),
  )

  return lines.join('\n')
}

/** Copy text even in older browsers where the modern clipboard API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy copy path below.
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } finally {
    textarea.remove()
  }
}
