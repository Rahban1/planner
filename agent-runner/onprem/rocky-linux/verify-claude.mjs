import { readFile } from 'node:fs/promises'

const keyFile =
  process.env.LLM_API_KEY_FILE || '/etc/planner-runner/secrets/llm_api_key'
const configuredModel = process.env.LLM_MODEL || 'anthropic/claude-sonnet-5'
const model = configuredModel.replace(/^anthropic\//, '')
const apiOrigin = (
  process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com'
).replace(/\/$/, '')

const apiKey = (await readFile(keyFile, 'utf8')).trim()
if (!apiKey) throw new Error(`Claude API key file is empty: ${keyFile}`)

const response = await fetch(
  `${apiOrigin}/v1/models/${encodeURIComponent(model)}`,
  {
    headers: {
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    signal: AbortSignal.timeout(15_000),
  },
)

if (!response.ok) {
  const detail = (await response.text()).slice(0, 500)
  throw new Error(`Claude API check failed: HTTP ${response.status}: ${detail}`)
}

const result = await response.json()
console.log(`Claude API check passed: ${result.id || model}`)
