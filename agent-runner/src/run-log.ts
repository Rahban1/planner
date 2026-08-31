export interface LogEntry {
  t: number
  level: 'info' | 'warn' | 'error'
  message: string
}

export type AppendFn = (
  message: string,
  level?: LogEntry['level'],
) => Promise<void>

interface ResilientAppendOptions {
  runId: string
  logs: LogEntry[]
  updateStatus: (entry: LogEntry) => Promise<void>
  writeLog?: (message: string) => void
  writeWarning?: (message: string) => void
}

export function createResilientAppend({
  runId,
  logs,
  updateStatus,
  writeLog = console.log,
  writeWarning = console.warn,
}: ResilientAppendOptions): AppendFn {
  return async (message, level = 'info') => {
    const entry: LogEntry = { t: Date.now(), level, message }
    logs.push(entry)
    writeLog(`[run:${runId}] ${level}: ${message}`)

    try {
      await updateStatus(entry)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      writeWarning(
        `[run:${runId}] Planner log delivery failed; the agent run will continue: ${reason}`,
      )
    }
  }
}
