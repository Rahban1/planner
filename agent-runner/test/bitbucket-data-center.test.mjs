import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createBitbucketDataCenterAdapter,
  parseBitbucketDataCenterPullRequestUrl,
  parseBitbucketDataCenterRepoUrl,
} from '../dist/bitbucket-data-center.js'

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
    async text() {
      return JSON.stringify(body)
    },
  }
}

test('parses Bitbucket Data Center HTTPS, SSH, and pull request URLs', () => {
  assert.deepEqual(
    parseBitbucketDataCenterRepoUrl(
      'https://bitbucket.example.com/scm/PROJ/widget.git',
    ),
    { projectKey: 'PROJ', repositorySlug: 'widget' },
  )
  assert.deepEqual(
    parseBitbucketDataCenterRepoUrl(
      'https://bitbucket.example.com/bitbucket/scm/PROJ/widget.git',
    ),
    { projectKey: 'PROJ', repositorySlug: 'widget' },
  )
  assert.deepEqual(
    parseBitbucketDataCenterRepoUrl(
      'ssh://git@bitbucket.example.com:7999/PROJ/widget.git',
    ),
    { projectKey: 'PROJ', repositorySlug: 'widget' },
  )
  assert.deepEqual(
    parseBitbucketDataCenterPullRequestUrl(
      'https://bitbucket.example.com/projects/PROJ/repos/widget/pull-requests/17',
    ),
    { projectKey: 'PROJ', repositorySlug: 'widget', number: 17 },
  )
})

test('creates a pull request against the Bitbucket default branch', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.endsWith('/default-branch')) {
      return jsonResponse(200, {
        id: 'refs/heads/main',
        displayId: 'main',
      })
    }
    return jsonResponse(201, {
      id: 17,
      links: {
        self: [
          {
            href: 'https://bitbucket.example.com/projects/PROJ/repos/widget/pull-requests/17',
          },
        ],
      },
    })
  }
  const adapter = createBitbucketDataCenterAdapter({
    baseUrl: 'https://bitbucket.example.com',
    token: 'secret-token',
    fetchImpl,
  })

  const created = await adapter.createReviewForBranch(
    'https://bitbucket.example.com/scm/PROJ/widget.git',
    {
      head: 'agent/fix-17',
      title: 'Fix widget',
      body: 'Proof follows.',
    },
  )

  assert.equal(created.number, 17)
  assert.equal(
    created.url,
    'https://bitbucket.example.com/projects/PROJ/repos/widget/pull-requests/17',
  )
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token')
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    title: 'Fix widget',
    description: 'Proof follows.',
    fromRef: { id: 'refs/heads/agent/fix-17' },
    toRef: { id: 'refs/heads/main' },
  })
})

test('reads proof metadata and updates a Bitbucket pull request', async () => {
  const calls = []
  const pullRequest = {
    id: 17,
    version: 3,
    title: 'Fix widget',
    description: 'Old body',
    state: 'OPEN',
    open: true,
    closed: false,
    fromRef: {
      id: 'refs/heads/agent/fix-17',
      displayId: 'agent/fix-17',
      latestCommit: 'b'.repeat(40),
    },
    toRef: { id: 'refs/heads/main', displayId: 'main' },
    reviewers: [],
    links: {
      self: [
        {
          href: 'https://bitbucket.example.com/projects/PROJ/repos/widget/pull-requests/17',
        },
      ],
    },
  }
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })
    if (url.includes('/commits')) {
      return jsonResponse(200, {
        values: [{ id: 'a'.repeat(40) }, { id: 'b'.repeat(40) }],
        isLastPage: true,
      })
    }
    if (url.includes('/changes')) {
      return jsonResponse(200, {
        values: [{ path: { toString: '.planner/proof/run-17/manifest.json' } }],
        isLastPage: true,
      })
    }
    if (init.method === 'PUT') return jsonResponse(200, pullRequest)
    return jsonResponse(200, pullRequest)
  }
  const adapter = createBitbucketDataCenterAdapter({
    baseUrl: 'https://bitbucket.example.com',
    token: 'secret-token',
    fetchImpl,
  })
  const url =
    'https://bitbucket.example.com/projects/PROJ/repos/widget/pull-requests/17'

  const details = await adapter.getReviewDetails(url)
  const commits = await adapter.listReviewCommitShas(url)
  const paths = await adapter.listReviewFilePaths(url)
  await adapter.updateReviewBody(url, 'New proof body')

  assert.equal(details.headSha, 'b'.repeat(40))
  assert.equal(details.headRef, 'agent/fix-17')
  assert.deepEqual(commits, ['a'.repeat(40), 'b'.repeat(40)])
  assert.deepEqual(paths, ['.planner/proof/run-17/manifest.json'])
  const updated = JSON.parse(calls.at(-1).init.body)
  assert.equal(updated.version, 3)
  assert.equal(updated.title, 'Fix widget')
  assert.equal(updated.description, 'New proof body')
  assert.deepEqual(updated.fromRef, pullRequest.fromRef)
  assert.deepEqual(updated.toRef, pullRequest.toRef)
})

test('maps Bitbucket merged and declined states', async () => {
  let state = 'MERGED'
  const adapter = createBitbucketDataCenterAdapter({
    baseUrl: 'https://bitbucket.example.com',
    token: 'secret-token',
    fetchImpl: async () =>
      jsonResponse(200, {
        id: 17,
        state,
        open: state === 'OPEN',
        closed: state !== 'OPEN',
      }),
  })
  const url =
    'https://bitbucket.example.com/projects/PROJ/repos/widget/pull-requests/17'

  assert.deepEqual(await adapter.getReviewState(url), {
    state: 'closed',
    merged: true,
    mergedAt: null,
  })
  state = 'DECLINED'
  assert.deepEqual(await adapter.getReviewState(url), {
    state: 'closed',
    merged: false,
    mergedAt: null,
  })
})

test('builds Bitbucket proof links for browser and raw evidence', () => {
  const adapter = createBitbucketDataCenterAdapter({
    baseUrl: 'https://bitbucket.example.com',
    token: 'secret',
    fetchImpl: async () => response({}),
  })
  const reviewUrl =
    'https://bitbucket.example.com/projects/PROJ/repos/widget/pull-requests/17'

  assert.equal(
    adapter.reviewFileUrl(reviewUrl, 'abc123', 'proof/report.md'),
    'https://bitbucket.example.com/projects/PROJ/repos/widget/browse/proof/report.md?at=abc123',
  )
  assert.equal(
    adapter.reviewFileUrl(reviewUrl, 'abc123', 'proof/desktop.png', true),
    'https://bitbucket.example.com/projects/PROJ/repos/widget/raw/proof/desktop.png?at=abc123',
  )
})
