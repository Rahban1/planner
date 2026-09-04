import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { OpenHandsClient } from '../dist/openhands.js'

test('uses Claude defaults in every runner entry point', async () => {
  const files = await Promise.all(
    [
      '../src/index.ts',
      '../Dockerfile',
      '../.env.onprem.example',
      '../../docker-compose.local.yml',
      '../../.github/workflows/planner-agent-run.yml',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  )

  for (const content of files) {
    assert.match(content, /anthropic\/claude-sonnet-5/)
    assert.doesNotMatch(content, /opencode\.ai|kimi-k2/)
  }
})

test('omits an empty model gateway URL from the OpenHands request', async () => {
  const originalFetch = globalThis.fetch
  let requestBody
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body)
    return new Response(JSON.stringify({ id: 'conversation-1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const client = new OpenHandsClient({
      baseUrl: 'http://openhands.test',
      llmModel: 'anthropic/claude-sonnet-5',
      llmApiKey: 'test-only',
      llmApiBase: '',
      timeoutMs: 1000,
    })
    await client.startConversation('test', '/workspace')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(requestBody.agent.llm.model, 'anthropic/claude-sonnet-5')
  assert.equal('base_url' in requestBody.agent.llm, false)
})
