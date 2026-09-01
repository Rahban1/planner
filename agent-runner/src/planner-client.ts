export interface PlannerClientOptions {
  baseUrl: string
  token?: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
  initialDelayMs?: number
  requestTimeoutMs?: number
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const RETRYABLE_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
])

export function createPlannerFetch(options: PlannerClientOptions) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const sleep = options.sleep ?? defaultSleep
  const maxAttempts = options.maxAttempts ?? 4
  const initialDelayMs = options.initialDelayMs ?? 500
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000
  const baseUrl = options.baseUrl.replace(/\/$/, '')

  return async function plannerFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${baseUrl}${path}`
    const method = init?.method ?? 'GET'

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response
      try {
        const timeoutSignal = AbortSignal.timeout(requestTimeoutMs)
        const signal = init?.signal
          ? AbortSignal.any([init.signal, timeoutSignal])
          : timeoutSignal
        const headers = new Headers(init?.headers)
        headers.set('Content-Type', 'application/json')
        if (options.token) headers.set('X-Runner-Token', options.token)

        response = await fetchImpl(url, { ...init, headers, signal })
      } catch (error) {
        if (init?.signal?.aborted || !isRetryableNetworkError(error) || attempt >= maxAttempts) {
          throw new Error(
            `Planner network request failed after ${attempt} attempt${attempt === 1 ? '' : 's'}: ${formatNetworkError(error, method, path)}`,
          )
        }

        await sleep(retryDelay(attempt, initialDelayMs))
        continue
      }

      if (response.ok) return (await response.json()) as T

      if (RETRYABLE_STATUSES.has(response.status) && attempt < maxAttempts) {
        await sleep(retryDelay(attempt, initialDelayMs))
        continue
      }

      const text = await response.text()
      throw new Error(`Planner request failed: ${response.status} ${text.slice(0, 500)}`)
    }

    throw new Error(`Planner request failed after ${maxAttempts} attempts: ${method} ${path}`)
  }
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
  if (error.message === 'fetch failed') return true

  const cause = error.cause
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return RETRYABLE_NETWORK_CODES.has(String(cause.code))
  }

  return false
}

function formatNetworkError(error: unknown, method: string, path: string): string {
  if (!(error instanceof Error)) return `${method} ${path}`

  const cause = error.cause
  if (cause && typeof cause === 'object') {
    const code = 'code' in cause ? String(cause.code) : null
    const hostname = 'hostname' in cause ? String(cause.hostname) : null
    const detail = 'message' in cause ? String(cause.message) : error.message
    return `${method} ${path} (${[code, hostname, detail].filter(Boolean).join(': ')})`
  }

  return `${method} ${path} (${error.message})`
}

function retryDelay(attempt: number, initialDelayMs: number): number {
  return initialDelayMs * 2 ** (attempt - 1)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
