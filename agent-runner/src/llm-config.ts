/** Resolve the server-only model settings. Never log the returned API key. */
export function resolveLlmConfig(env: Record<string, string | undefined>) {
  const model = env.LLM_MODEL?.trim() || 'anthropic/claude-sonnet-5'
  const anthropic = model.startsWith('anthropic/')
  return {
    model,
    apiKey: anthropic
      ? env.ANTHROPIC_API_KEY?.trim() || env.LLM_API_KEY?.trim() || ''
      : env.LLM_API_KEY?.trim() || '',
    apiBase:
      env.LLM_API_BASE?.trim() ||
      (anthropic ? 'https://api.anthropic.com' : undefined),
  }
}
