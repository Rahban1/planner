const LOCAL_PROOF_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function canUseLocalProofLogin(
  requestUrl: string | URL,
  isDevelopment: boolean,
) {
  if (!isDevelopment) return false
  return LOCAL_PROOF_HOSTS.has(new URL(requestUrl).hostname)
}
