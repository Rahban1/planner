import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  readRepositoryHandoffs,
  repositoryWorkspaces,
  uniqueRepoUrls,
} from '../dist/repository-workspaces.js'

test('maps every repository to the runner clone layout', () => {
  assert.deepEqual(repositoryWorkspaces('/workspace', ['front', 'back']), [
    { repoUrl: 'front', position: 0, repoDir: '/workspace/repo' },
    {
      repoUrl: 'back',
      position: 1,
      repoDir: '/workspace/context-repos/repo-2',
    },
  ])
})

test('deduplicates repository URLs while keeping the primary repository first', () => {
  assert.deepEqual(uniqueRepoUrls('front', ['front', 'back']), [
    'front',
    'back',
  ])
})

test('reads an independent branch and pull request marker for every repository', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'planner-repositories-'))
  const repoDirs = [
    join(workspace, 'repo', '.git'),
    join(workspace, 'context-repos', 'repo-2', '.git'),
  ]
  await Promise.all(
    repoDirs.map((directory) => mkdir(directory, { recursive: true })),
  )
  await Promise.all([
    writeFile(join(repoDirs[0], 'planner-agent-branch'), 'agent/full-stack\n'),
    writeFile(
      join(repoDirs[0], 'planner-agent-pr-url'),
      'https://github.com/acme/front/pull/1\n',
    ),
    writeFile(join(repoDirs[1], 'planner-agent-branch'), 'agent/full-stack\n'),
    writeFile(
      join(repoDirs[1], 'planner-agent-pr-url'),
      'https://github.com/acme/back/pull/2\n',
    ),
  ])

  const results = await readRepositoryHandoffs(workspace, [
    'https://github.com/acme/front',
    'https://github.com/acme/back',
  ])

  assert.deepEqual(
    results.map(({ repoUrl, branchName, prUrl }) => ({
      repoUrl,
      branchName,
      prUrl,
    })),
    [
      {
        repoUrl: 'https://github.com/acme/front',
        branchName: 'agent/full-stack',
        prUrl: 'https://github.com/acme/front/pull/1',
      },
      {
        repoUrl: 'https://github.com/acme/back',
        branchName: 'agent/full-stack',
        prUrl: 'https://github.com/acme/back/pull/2',
      },
    ],
  )
})
