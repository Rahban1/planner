import { join } from 'node:path'
import {
  loadProofPack,
  renderProofSection,
  upsertProofSection,
} from './proof.js'
import type { ProofPack } from './proof.js'
import type { SourceControlAdapter } from './source-control.js'

export interface PublishProofOptions {
  repoUrl: string
  prUrl: string | null
  branchName: string | null
  workspace: string
  repoDir?: string
  runId: string
  taskTitle: string
  sourceControl: SourceControlAdapter
}

export interface PublishProofResult {
  prUrl: string | null
  prNumber: number | null
  branchName: string | null
  proof: ProofPack
  createdFallback: boolean
}

export async function publishProofToPullRequest({
  repoUrl,
  prUrl,
  branchName,
  workspace,
  repoDir = join(workspace, 'repo'),
  runId,
  taskTitle,
  sourceControl,
}: PublishProofOptions): Promise<PublishProofResult> {
  let resolvedPrUrl = prUrl
  let createdFallback = false

  if (!resolvedPrUrl && branchName) {
    await sourceControl.pushBranch(repoDir, branchName)
    const incomplete = renderProofSection({
      state: 'incomplete',
      manifest: null,
      proofDir: null,
      errors: [
        'The runner created this ready pull request because the agent did not finish PR creation.',
      ],
    })
    const created = await sourceControl.createReviewForBranch(repoUrl, {
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

  const details = await sourceControl.getReviewDetails(resolvedPrUrl)
  const commitShas = await sourceControl.listReviewCommitShas(resolvedPrUrl)
  const committedPaths = await sourceControl.listReviewFilePaths(resolvedPrUrl)
  if (!commitShas.includes(details.headSha)) commitShas.push(details.headSha)

  const proof = await loadProofPack({
    repoDir,
    runId,
    allowedCommitShas: commitShas,
    committedPaths,
    artifactCommitSha: details.headSha,
  })
  const section = renderProofSection(proof, (commitSha, path, raw) =>
    sourceControl.reviewFileUrl(resolvedPrUrl, commitSha, path, raw),
  )
  const nextBody = upsertProofSection(details.body, section)
  if (nextBody !== details.body.trim()) {
    await sourceControl.updateReviewBody(resolvedPrUrl, nextBody)
  }

  return {
    prUrl: resolvedPrUrl,
    prNumber: details.number,
    branchName: details.headRef || branchName,
    proof,
    createdFallback,
  }
}
