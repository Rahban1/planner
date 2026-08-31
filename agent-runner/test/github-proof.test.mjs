import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createPullRequestForBranch,
  getPullRequestDetails,
  listPullRequestFilePaths,
  listPullRequestCommitShas,
  parseRepoUrl,
  updatePullRequestBody,
} from '../dist/github.js'

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

test('parses HTTPS and SSH GitHub repository URLs', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/acme/widget.git'), {
    owner: 'acme',
    repo: 'widget',
  })
  assert.deepEqual(parseRepoUrl('git@github.com:acme/widget.git'), {
    owner: 'acme',
    repo: 'widget',
  })
  assert.equal(parseRepoUrl('https://gitlab.com/acme/widget'), null)
})

test('reads pull request details and commit SHAs through GitHub public APIs', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/pulls/7/commits?per_page=100')) {
      return jsonResponse(200, [{ sha: 'a'.repeat(40) }, { sha: 'b'.repeat(40) }])
    }
    if (url.endsWith('/pulls/7/files?per_page=100')) {
      return jsonResponse(200, [{ filename: '.planner/proof/run-456/manifest.json' }])
    }
    return jsonResponse(200, {
      number: 7,
      html_url: 'https://github.com/acme/widget/pull/7',
      body: 'Existing body',
      draft: false,
      head: { sha: 'b'.repeat(40), ref: 'agent/proof' },
      base: { ref: 'main' },
    })
  }

  const details = await getPullRequestDetails(
    'https://github.com/acme/widget/pull/7',
    'token',
    fetchImpl,
  )
  const shas = await listPullRequestCommitShas(
    'https://github.com/acme/widget/pull/7',
    'token',
    fetchImpl,
  )
  const paths = await listPullRequestFilePaths(
    'https://github.com/acme/widget/pull/7',
    'token',
    fetchImpl,
  )

  assert.equal(details.headSha, 'b'.repeat(40))
  assert.equal(details.body, 'Existing body')
  assert.deepEqual(shas, ['a'.repeat(40), 'b'.repeat(40)])
  assert.deepEqual(paths, ['.planner/proof/run-456/manifest.json'])
  assert.equal(calls[0].init.headers.Authorization, 'Bearer token')
})

test('creates a ready pull request against the repository default branch', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })
    if (init.method === 'POST') {
      return jsonResponse(201, {
        number: 9,
        html_url: 'https://github.com/acme/widget/pull/9',
      })
    }
    return jsonResponse(200, { default_branch: 'trunk' })
  }

  const created = await createPullRequestForBranch(
    'https://github.com/acme/widget',
    'token',
    {
      head: 'agent/proof',
      title: 'Add proof',
      body: 'Honest incomplete proof',
    },
    fetchImpl,
  )

  const posted = JSON.parse(calls[1].init.body)
  assert.equal(created.url, 'https://github.com/acme/widget/pull/9')
  assert.equal(posted.base, 'trunk')
  assert.equal(posted.draft, false)
})

test('updates only the pull request body', async () => {
  let request
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return jsonResponse(200, {})
  }

  await updatePullRequestBody(
    'https://github.com/acme/widget/pull/7',
    'token',
    'New body',
    fetchImpl,
  )

  assert.equal(request.init.method, 'PATCH')
  assert.deepEqual(JSON.parse(request.init.body), { body: 'New body' })
})
