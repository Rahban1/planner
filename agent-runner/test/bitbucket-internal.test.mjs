import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bitbucketReviewJson,
  parseBitbucketIdentity,
} from '../dist/bitbucket-review.js'
import { buildPrompt } from '../dist/prompt.js'
import {
  getPullRequestDetails,
  parseRepoUrl,
  getPullRequestState,
} from '../dist/github.js'

const config = {
  baseUrl: 'https://bitbucket.example.com/bitbucket',
  token: 'test-token',
}
const repoUrl = `${config.baseUrl}/scm/TEAM/app.git`
const prUrl = `${config.baseUrl}/projects/TEAM/repos/app/pull-requests/7`
const ref = (branch) => ({
  displayId: branch,
  latestCommit: 'a'.repeat(40),
  repository: { slug: 'app', project: { key: 'TEAM' } },
})
const pr = {
  id: 7,
  title: 'Change',
  description: 'Details',
  state: 'OPEN',
  fromRef: ref('agent/change'),
  toRef: ref('master'),
  links: { self: [{ href: prUrl }] },
}

test('Bitbucket identity rejects a different host, repository, or context path', () => {
  assert.deepEqual(parseBitbucketIdentity(repoUrl, prUrl, config.baseUrl, 7), {
    owner: 'TEAM',
    repository: 'app',
    number: 7,
  })
  assert.throws(() =>
    parseBitbucketIdentity(
      repoUrl,
      prUrl.replace('bitbucket.example.com', 'evil.example.com'),
      config.baseUrl,
    ),
  )
  assert.throws(() =>
    parseBitbucketIdentity(
      repoUrl,
      prUrl.replace('/app/', '/other/'),
      config.baseUrl,
    ),
  )
  assert.throws(() =>
    parseBitbucketIdentity(
      repoUrl.replace('/bitbucket/', '/other/'),
      prUrl,
      config.baseUrl,
    ),
  )
})

test('Bitbucket review reads paged changes and maps a complete diff', async () => {
  const urls = []
  const mock = async (url, init) => {
    urls.push(url)
    assert.equal(init.headers.Authorization, 'Bearer test-token')
    assert.equal(init.redirect, 'error')
    if (url.includes('/changes'))
      return Response.json({
        values: [{ path: { toString: 'app.ts' }, type: 'MODIFY' }],
        isLastPage: true,
      })
    if (url.includes('/diff?'))
      return Response.json({
        diffs: [
          {
            destination: { toString: 'app.ts' },
            hunks: [
              {
                sourceLine: 1,
                sourceSpan: 1,
                destinationLine: 1,
                destinationSpan: 1,
                segments: [
                  { type: 'REMOVED', lines: [{ line: 'old' }] },
                  { type: 'ADDED', lines: [{ line: 'new' }] },
                ],
              },
            ],
          },
        ],
      })
    return Response.json(pr)
  }
  const files = await bitbucketReviewJson(
    config,
    '/repos/TEAM/app/pulls/7/files?per_page=100',
    mock,
  )
  assert.equal(files[0].patch, '@@ -1,1 +1,1 @@\n-old\n+new')
  assert.equal(files[0].additions, 1)
  assert.equal(files[0].deletions, 1)
  assert.ok(urls.every((url) => url.startsWith(`${config.baseUrl}/rest/`)))
})

test('Bitbucket response truncation removes unsafe line review data', async () => {
  const files = await bitbucketReviewJson(
    config,
    '/repos/TEAM/app/pulls/7/files',
    async (url) =>
      Response.json(
        url.includes('/changes')
          ? {
              values: [{ path: { toString: 'app.ts' }, type: 'MODIFY' }],
              isLastPage: true,
            }
          : {
              truncated: true,
              diffs: [{ destination: { toString: 'app.ts' }, hunks: [] }],
            },
      ),
  )
  assert.equal(files[0].patch, undefined)
})

test('runner uses Bitbucket for review state, revision metadata, and implementation instructions', async () => {
  process.env.SCM_PROVIDER = 'bitbucket_data_center'
  process.env.BITBUCKET_BASE_URL = config.baseUrl
  try {
    const details = await getPullRequestDetails(prUrl, config.token, async () =>
      Response.json(pr),
    )
    assert.equal(details.headRepo, 'TEAM/app')
    assert.equal(details.baseRepo, 'TEAM/app')
    assert.equal(details.headRef, 'agent/change')
    assert.equal(details.state, 'open')
    assert.equal(
      (
        await getPullRequestState(prUrl, config.token, async () =>
          Response.json({ ...pr, state: 'MERGED' }),
        )
      ).merged,
      true,
    )
    assert.equal(
      parseRepoUrl('https://evil.example.com/scm/TEAM/app.git'),
      null,
    )
    const prompt = buildPrompt(
      {
        title: 'Change',
        notes: null,
        projectName: 'App',
        repoUrl,
        priority: 'medium',
        attachments: [],
      },
      { runId: 'test' },
    )
    assert.match(
      prompt,
      /runner will push the branch and create the Bitbucket pull request/,
    )
    assert.doesNotMatch(prompt, /gh pr create|gh auth login|GITHUB_TOKEN/)
    assert.match(prompt, /\.git\/planner-agent-branch/)
  } finally {
    delete process.env.SCM_PROVIDER
    delete process.env.BITBUCKET_BASE_URL
  }
})

test('Bitbucket binary files retain their file entry without a text patch', async () => {
  const files = await bitbucketReviewJson(
    config,
    '/repos/TEAM/app/pulls/7/files',
    async (url) =>
      Response.json(
        url.includes('/changes')
          ? {
              values: [{ path: { toString: 'image.png' }, type: 'ADD' }],
              isLastPage: true,
            }
          : { diffs: [{ destination: { toString: 'image.png' } }] },
      ),
  )
  assert.equal(files[0].filename, 'image.png')
  assert.equal(files[0].patch, undefined)
})
