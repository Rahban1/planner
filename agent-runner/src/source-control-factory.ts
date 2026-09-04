import { createBitbucketDataCenterAdapter } from './bitbucket-data-center.js'
import { createGitHubAdapter } from './github-adapter.js'
import type { SourceControlAdapter } from './source-control.js'

export interface SourceControlConfig {
  provider?: string
  token?: string
  bitbucketBaseUrl?: string
}

export function createSourceControlAdapter(
  config: SourceControlConfig,
): SourceControlAdapter {
  const provider = config.provider?.trim() || 'github'
  const token = config.token?.trim() || ''

  if (provider === 'github') return createGitHubAdapter(token)
  if (provider === 'bitbucket_data_center') {
    return createBitbucketDataCenterAdapter({
      baseUrl: config.bitbucketBaseUrl?.trim() || '',
      token,
    })
  }
  throw new Error(
    `Unsupported SCM_PROVIDER ${provider}. Use github or bitbucket_data_center.`,
  )
}
