import {
  createPullRequestForBranch,
  getPullRequestDetails,
  getPullRequestState,
  listPullRequestCommitShas,
  listPullRequestFilePaths,
  pushBranchToRemote,
  updatePullRequestBody,
} from './github.js'
import type { SourceControlAdapter } from './source-control.js'

export function createGitHubAdapter(token: string): SourceControlAdapter {
  return {
    provider: 'github',
    gitEnvironment() {
      const basicAuth = Buffer.from(`x-access-token:${token}`).toString(
        'base64',
      )
      return {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basicAuth}`,
      }
    },
    pushBranch(repoDir, branchName) {
      return pushBranchToRemote(repoDir, branchName, token)
    },
    async getReviewState(reviewUrl) {
      const result = await getPullRequestState(reviewUrl, token)
      if (!result) return null
      return {
        state:
          result.state === 'open' ? ('open' as const) : ('closed' as const),
        merged: result.merged,
        mergedAt: result.mergedAt,
      }
    },
    getReviewDetails(reviewUrl) {
      return getPullRequestDetails(reviewUrl, token)
    },
    listReviewCommitShas(reviewUrl) {
      return listPullRequestCommitShas(reviewUrl, token)
    },
    listReviewFilePaths(reviewUrl) {
      return listPullRequestFilePaths(reviewUrl, token)
    },
    reviewFileUrl(_reviewUrl, commitSha, path, raw = false) {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/')
      return `../blob/${commitSha}/${encodedPath}${raw ? '?raw=true' : ''}`
    },
    updateReviewBody(reviewUrl, body) {
      return updatePullRequestBody(reviewUrl, token, body)
    },
    createReviewForBranch(repoUrl, input) {
      return createPullRequestForBranch(repoUrl, token, input)
    },
  }
}
