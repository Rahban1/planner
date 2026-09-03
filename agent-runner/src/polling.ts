export type TerminalExecutionStatus = 'finished' | 'error' | 'stuck'

export function getTerminalExecutionStatus(
  status: string | null | undefined,
): TerminalExecutionStatus | null {
  if (status === 'finished' || status === 'error' || status === 'stuck') {
    return status
  }
  return null
}

export function hasExceededIdleLimit({
  lastEventAt,
  now,
  maxIdleMs,
}: {
  lastEventAt: number
  now: number
  maxIdleMs: number
}): boolean {
  return now - lastEventAt > maxIdleMs
}

export function shouldStopPolling({
  timedOut,
  startedAt,
  now,
  maxRuntimeMs,
  terminalStatus,
}: {
  timedOut: boolean
  startedAt: number
  now: number
  maxRuntimeMs: number
  terminalStatus: TerminalExecutionStatus | null
}): boolean {
  if (timedOut) return true
  if (now - startedAt > maxRuntimeMs) return true
  return terminalStatus !== null
}
