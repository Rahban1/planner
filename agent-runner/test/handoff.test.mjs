import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { publishProofToPullRequest } from '../dist/handoff.js'

const RUN_ID = 'run-456'
const TESTED_SHA = 'a'.repeat(40)

async function makeLibraryProof() {
  const workspace = await mkdtemp(join(tmpdir(), 'planner-handoff-'))
  const repoDir = join(workspace, 'repo')
  const proofDir = join(repoDir, '.planner', 'proof', RUN_ID)
  await mkdir(join(proofDir, 'logs'), { recursive: true })
  await writeFile(join(proofDir, 'report.md'), '# Report\n')
  await writeFile(join(proofDir, 'logs', 'test.txt'), 'pass\n')

  const artifacts = []
  for (const relativePath of ['report.md', 'logs/test.txt']) {
    const bytes = await readFile(join(proofDir, relativePath))
    artifacts.push({
      path: relativePath,
      type: relativePath.endsWith('.md') ? 'report' : 'log',
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }

  await writeFile(
    join(proofDir, 'manifest.json'),
    JSON.stringify({
      version: 1,
      runId: RUN_ID,
      testedCommitSha: TESTED_SHA,
      generatedAt: '2026-08-13T12:00:00.000Z',
      environment: { os: 'linux', runtime: 'node 22' },
      changeType: 'library',
      overall: 'pass',
      checks: [
        {
          id: 'test',
          title: 'Tests',
          layer: 'targeted',
          status: 'pass',
          command: 'npm test',
          exitCode: 0,
          durationMs: 50,
          outputPath: 'logs/test.txt',
          evidencePaths: [],
        },
      ],
      artifacts,
      limitations: [],
      reproduce: ['npm test'],
    }),
  )
  return { workspace, repoDir }
}

function sourceControlFixture(overrides = {}) {
  const updates = []
  const created = []
  return {
    updates,
    created,
    api: {
      provider: 'test',
      gitEnvironment() {
        return process.env
      },
      async pushBranch() {},
      async getReviewState() {
        return { state: 'open', merged: false, mergedAt: null }
      },
      async getReviewDetails(prUrl) {
        return {
          owner: 'acme',
          repo: 'widget',
          number: 7,
          url: prUrl,
          body: '## Problem\nKeep me.',
          draft: false,
          headSha: 'b'.repeat(40),
          headRef: 'agent/proof',
          baseRef: 'main',
        }
      },
      async listReviewCommitShas() {
        return [TESTED_SHA, 'b'.repeat(40)]
      },
      async listReviewFilePaths() {
        return [
          `.planner/proof/${RUN_ID}/manifest.json`,
          `.planner/proof/${RUN_ID}/report.md`,
          `.planner/proof/${RUN_ID}/logs/test.txt`,
        ]
      },
      reviewFileUrl(_reviewUrl, commitSha, path, raw = false) {
        return `../blob/${commitSha}/${path}${raw ? '?raw=true' : ''}`
      },
      async updateReviewBody(prUrl, body) {
        updates.push({ prUrl, body })
      },
      async createReviewForBranch(_repoUrl, input) {
        created.push(input)
        return { number: 7, url: 'https://github.com/acme/widget/pull/7' }
      },
      ...overrides,
    },
  }
}

test('publishes a validated PASS proof section to an existing pull request', async () => {
  const { workspace } = await makeLibraryProof()
  const sourceControl = sourceControlFixture()

  const result = await publishProofToPullRequest({
    repoUrl: 'https://github.com/acme/widget',
    prUrl: 'https://github.com/acme/widget/pull/7',
    branchName: 'agent/proof',
    workspace,
    runId: RUN_ID,
    taskTitle: 'Add proof',
    sourceControl: sourceControl.api,
  })

  assert.equal(result.proof.state, 'pass')
  assert.equal(sourceControl.updates.length, 1)
  assert.match(sourceControl.updates[0].body, /Verification result: PASS/)
  assert.match(sourceControl.updates[0].body, /## Problem\nKeep me/)
  assert.match(
    sourceControl.updates[0].body,
    /\.\.\/blob\/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\/\.planner\/proof/,
  )
})

test('publishes INCOMPLETE when the agent did not write a manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'planner-handoff-missing-'))
  await mkdir(join(workspace, 'repo'), { recursive: true })
  const sourceControl = sourceControlFixture()

  const result = await publishProofToPullRequest({
    repoUrl: 'https://github.com/acme/widget',
    prUrl: 'https://github.com/acme/widget/pull/7',
    branchName: 'agent/proof',
    workspace,
    runId: RUN_ID,
    taskTitle: 'Add proof',
    sourceControl: sourceControl.api,
  })

  assert.equal(result.proof.state, 'incomplete')
  assert.match(sourceControl.updates[0].body, /manifest\.json was not found/)
})

test('creates a ready fallback PR when a branch exists but the agent did not create the PR', async () => {
  const { workspace } = await makeLibraryProof()
  const sourceControl = sourceControlFixture()

  const result = await publishProofToPullRequest({
    repoUrl: 'https://github.com/acme/widget',
    prUrl: null,
    branchName: 'agent/proof',
    workspace,
    runId: RUN_ID,
    taskTitle: 'Add proof',
    sourceControl: sourceControl.api,
  })

  assert.equal(result.prUrl, 'https://github.com/acme/widget/pull/7')
  assert.equal(sourceControl.created.length, 1)
  assert.equal(sourceControl.created[0].draft, false)
  assert.match(
    sourceControl.created[0].body,
    /runner created this ready pull request/i,
  )
})

test('pushes a local branch before creating a fallback pull request', async () => {
  const { workspace } = await makeLibraryProof()
  let branchPushed = false
  const sourceControl = sourceControlFixture({
    async createReviewForBranch(_repoUrl, input) {
      if (!branchPushed) {
        throw new Error(
          'GitHub API 422: Validation Failed: PullRequest head invalid',
        )
      }
      sourceControl.created.push(input)
      return { number: 7, url: 'https://github.com/acme/widget/pull/7' }
    },
  })

  const result = await publishProofToPullRequest({
    repoUrl: 'https://github.com/acme/widget',
    prUrl: null,
    branchName: 'agent/proof',
    workspace,
    runId: RUN_ID,
    taskTitle: 'Add proof',
    sourceControl: {
      ...sourceControl.api,
      async pushBranch() {
        branchPushed = true
      },
    },
  })

  assert.equal(branchPushed, true)
  assert.equal(result.prUrl, 'https://github.com/acme/widget/pull/7')
})

test('surfaces source-control proof update failures', async () => {
  const { workspace } = await makeLibraryProof()
  const sourceControl = sourceControlFixture({
    async updateReviewBody() {
      throw new Error('GitHub API 500 while updating the PR body')
    },
  })

  await assert.rejects(
    () =>
      publishProofToPullRequest({
        repoUrl: 'https://github.com/acme/widget',
        prUrl: 'https://github.com/acme/widget/pull/7',
        branchName: 'agent/proof',
        workspace,
        runId: RUN_ID,
        taskTitle: 'Add proof',
        sourceControl: sourceControl.api,
      }),
    /GitHub API 500/,
  )
})
