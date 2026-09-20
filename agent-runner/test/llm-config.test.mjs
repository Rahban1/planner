import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveLlmConfig } from '../dist/llm-config.js'
import { OpenHandsClient } from '../dist/openhands.js'

test('Claude defaults use the Anthropic key and endpoint, not an old OpenCode key', () => {
  assert.deepEqual(
    resolveLlmConfig({
      ANTHROPIC_API_KEY: 'claude-test',
      LLM_API_KEY: 'old-key',
    }),
    {
      model: 'anthropic/claude-sonnet-5',
      apiKey: 'claude-test',
      apiBase: 'https://api.anthropic.com',
    },
  )
  assert.equal(resolveLlmConfig({}).apiKey, '')
})

test('explicit model gateways and legacy keys remain supported', () => {
  assert.deepEqual(
    resolveLlmConfig({
      LLM_MODEL: 'anthropic/custom',
      LLM_API_KEY: 'legacy',
      LLM_API_BASE: 'https://gateway.internal',
    }),
    {
      model: 'anthropic/custom',
      apiKey: 'legacy',
      apiBase: 'https://gateway.internal',
    },
  )
  const other = resolveLlmConfig({
    LLM_MODEL: 'openai/custom',
    ANTHROPIC_API_KEY: 'must-not-leak',
  })
  assert.equal(other.apiKey, '')
  assert.equal(other.apiBase, undefined)
})

test('the runner passes Claude credentials to the agent session', async () => {
  const original = globalThis.fetch
  let body
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body)
    return Response.json({ id: 'test' })
  }
  try {
    const llm = resolveLlmConfig({ ANTHROPIC_API_KEY: 'test-only' })
    await new OpenHandsClient({
      baseUrl: 'http://127.0.0.1:8000',
      timeoutMs: 1000,
      llmModel: llm.model,
      llmApiKey: llm.apiKey,
      llmApiBase: llm.apiBase,
    }).startConversation('Plan the task', '/workspace')
    assert.equal(body.agent.llm.model, 'anthropic/claude-sonnet-5')
    assert.equal(body.agent.llm.api_key, 'test-only')
    assert.equal(body.agent.llm.base_url, 'https://api.anthropic.com')
  } finally {
    globalThis.fetch = original
  }
})
