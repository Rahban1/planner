import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlannerFetch } from '../dist/planner-client.js'

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body)
    },
  }
}

function networkError(code, hostname = 'planner.example.com') {
  const cause = Object.assign(new Error(`network error: ${code}`), { code, hostname })
  return Object.assign(new TypeError('fetch failed'), { cause })
}

test('retries transient network failures with exponential backoff', async () => {
  let attempts = 0
  const delays = []
  const plannerFetch = createPlannerFetch({
    baseUrl: 'https://planner.example.com/',
    fetchImpl: async () => {
      attempts += 1
      if (attempts < 3) throw networkError('ENOTFOUND')
      return response(200, { ok: true })
    },
    sleep: async (ms) => delays.push(ms),
    initialDelayMs: 100,
  })

  await assert.doesNotReject(async () => {
    assert.deepEqual(await plannerFetch('/api/runner/queue'), { ok: true })
  })
  assert.equal(attempts, 3)
  assert.deepEqual(delays, [100, 200])
})

test('retries transient HTTP responses', async () => {
  let attempts = 0
  const plannerFetch = createPlannerFetch({
    baseUrl: 'https://planner.example.com',
    fetchImpl: async () => {
      attempts += 1
      return attempts === 1 ? response(503, 'temporarily unavailable') : response(200, { ok: true })
    },
    sleep: async () => {},
  })

  assert.deepEqual(await plannerFetch('/api/runner/queue'), { ok: true })
  assert.equal(attempts, 2)
})

test('retries request timeouts', async () => {
  let attempts = 0
  const plannerFetch = createPlannerFetch({
    baseUrl: 'https://planner.example.com',
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
      return response(200, { ok: true })
    },
    sleep: async () => {},
  })

  assert.deepEqual(await plannerFetch('/api/runner/queue'), { ok: true })
  assert.equal(attempts, 2)
})

test('does not retry permanent HTTP failures', async () => {
  let attempts = 0
  const plannerFetch = createPlannerFetch({
    baseUrl: 'https://planner.example.com',
    fetchImpl: async () => {
      attempts += 1
      return response(401, 'Unauthorized')
    },
    sleep: async () => {},
  })

  await assert.rejects(
    () => plannerFetch('/api/runner/queue'),
    /Planner request failed: 401 Unauthorized/,
  )
  assert.equal(attempts, 1)
})

test('reports the network cause after retries are exhausted', async () => {
  const plannerFetch = createPlannerFetch({
    baseUrl: 'https://planner.example.com',
    maxAttempts: 2,
    fetchImpl: async () => {
      throw networkError('ENOTFOUND', 'planner.example.com')
    },
    sleep: async () => {},
  })

  await assert.rejects(
    () => plannerFetch('/api/runner/queue'),
    /Planner network request failed after 2 attempts: GET \/api\/runner\/queue \(ENOTFOUND: planner\.example\.com:/,
  )
})
