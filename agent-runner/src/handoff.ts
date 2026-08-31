import { join } from 'node:path'
import {
  createPullRequestForBranch,
  getPullRequestDetails,
  listPullRequestCommitShas,
  listPullRequestFilePaths,
  updatePullRequestBody,
} from './github.js'
import type {
  CreatePullRequestInput,
  CreatedPullRequest,
  PullRequestDetails,
} from './github.js'
import {
  loadProofPack,
  renderProofSection,
  upsertProofSection,
} from './proof.js'
import type { ProofPack } from './proof.js'

export interface ProofGithubApi {
  getPullRequestDetails: (
    prUrl: string,
    token: string,
  ) => Promise<PullRequestDetails>
  listPullRequestCommitShas: (prUrl: string, token: string) => Promise<string[]>
  listPullRequestFilePaths: (prUrl: string, token: string) => Promise<string[]>
  updatePullRequestBody: (
    prUrl: string,
    token: string,
    body: string,
  ) => Promise<void>
  createPullRequestForBranch: (
    repoUrl: string,
    token: string,
    input: CreatePullRequestInput,
  ) => Promise<CreatedPullRequest>
}

export interface PublishProofOptions {
  repoUrl: string
  prUrl: string | null
  branchName: string | null
  workspace: string
  repoDir?: string
  runId: string
  taskTitle: string
  token: string
  github?: ProofGithubApi
}

export interface PublishProofResult {
  prUrl: string | null
  prNumber: number | null
  branchName: string | null
  proof: ProofPack
  createdFallback: boolean
}

const defaultGithub: ProofGithubApi = {
  getPullRequestDetails,
  listPullRequestCommitShas,
  listPullRequestFilePaths,
  updatePullRequestBody,
  createPullRequestForBranch,
}

export async function publishProofToPullRequest({
  repoUrl,
  prUrl,
  branchName,
  workspace,
  repoDir = join(workspace, 'repo'),
  runId,
  taskTitle,
  token,
  github = defaultGithub,
}: PublishProofOptions): Promise<PublishProofResult> {
  let resolvedPrUrl = prUrl
  let createdFallback = false

  if (!resolvedPrUrl && branchName && token) {
    const incomplete = renderProofSection({
      state: 'incomplete',
      manifest: null,
      proofDir: null,
      errors: [
        'The runner created this ready pull request because the agent did not finish PR creation.',
      ],
    })
    const created = await github.createPullRequestForBranch(repoUrl, token, {
      head: branchName,
      title: taskTitle,
      body: `## Problem\n${taskTitle}\n\n## Approach\nThe agent reached its handoff window after pushing the branch. The proof report below states what completed.\n\n${incomplete}`,
      draft: false,
    })
    resolvedPrUrl = created.url
    createdFallback = true
  }

  if (!resolvedPrUrl) {
    return {
      prUrl: null,
      prNumber: null,
      branchName,
      proof: {
        state: 'incomplete',
        manifest: null,
        proofDir: null,
        errors: ['No pull request URL or pushed branch was available.'],
      },
      createdFallback,
    }
  }

  if (!token) {
    throw new Error('GITHUB_TOKEN is required to publish the proof section.')
  }

  const details = await github.getPullRequestDetails(resolvedPrUrl, token)
  const commitShas = await github.listPullRequestCommitShas(
    resolvedPrUrl,
    token,
  )
  const committedPaths = await github.listPullRequestFilePaths(
    resolvedPrUrl,
    token,
  )
  if (!commitShas.includes(details.headSha)) commitShas.push(details.headSha)

  const proof = await loadProofPack({
    repoDir,
    runId,
    allowedCommitShas: commitShas,
    committedPaths,
    artifactCommitSha: details.headSha,
  })
  const section = renderProofSection(proof)
  const nextBody = upsertProofSection(details.body, section)
  if (nextBody !== details.body.trim()) {
    await github.updatePullRequestBody(resolvedPrUrl, token, nextBody)
  }

  return {
    prUrl: resolvedPrUrl,
    prNumber: details.number,
    branchName: details.headRef || branchName,
    proof,
    createdFallback,
  }
}
