import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertRevisionTarget,
  loadReviewSnapshot,
  prepareRevisionRepositories,
  pushRevisionRepository,
  reviewGit,
} from '../dist/review.js'
import {
  buildAnswerPrompt,
  buildRevisionPrompt,
  buildPrompt,
  buildPlanPrompt,
  buildPlanRevisionPrompt,
} from '../dist/prompt.js'
import { OpenHandsClient } from '../dist/openhands.js'

const oldSha = 'a'.repeat(40)
const newSha = 'b'.repeat(40)
const repository = {
  repoUrl: 'https://github.com/acme/widget',
  prUrl: 'https://github.com/acme/widget/pull/7',
  prNumber: 7,
  branchName: 'agent/widget',
  headSha: oldSha,
}
const details = {
  owner: 'acme',
  repo: 'widget',
  number: 7,
  url: repository.prUrl,
  body: '',
  draft: false,
  headRef: repository.branchName,
  headSha: oldSha,
  baseRef: 'main',
  state: 'open',
  merged: false,
  headRepo: 'acme/widget',
  baseRepo: 'acme/widget',
}
const prepared = {
  ...repository,
  position: 0,
  repoDir: '/workspace/run/repo',
  expectedHeadSha: oldSha,
  status: 'success',
  writable: true,
}
const review = {
  sourceRunId: 'source-run',
  instruction: 'Keep the reset button label visible.',
  repositories: [repository],
  context: {
    repoUrl: repository.repoUrl,
    path: 'src/button.ts',
    line: 3,
    side: 'RIGHT',
  },
}
const task = {
  title: 'Reset button',
  projectName: 'Widget',
  priority: 'medium',
  repoUrl: repository.repoUrl,
  notes: null,
  attachments: [],
  review,
}

function gitForPush(calls, overrides = {}) {
  return async (_dir, args) => {
    calls.push(args)
    if (args[0] === 'branch') return overrides.branch ?? repository.branchName
    if (args[0] === 'status') return overrides.status ?? ''
    if (args[0] === 'rev-parse') return overrides.sha ?? newSha
    if (args[0] === 'merge-base' && overrides.diverged)
      throw new Error('not an ancestor')
    return ''
  }
}

test('revision rejects changed identity, forks, closed PRs, and stale heads', () => {
  assertRevisionTarget(repository, details, oldSha)
  for (const change of [
    { headRef: 'other' },
    { number: 9 },
    { state: 'closed' },
    { merged: true },
    { headRepo: 'outside/widget' },
    { baseRepo: null },
    { headSha: newSha },
  ])
    assert.throws(() =>
      assertRevisionTarget(repository, { ...details, ...change }, oldSha),
    )
  assert.throws(() =>
    assertRevisionTarget(
      { ...repository, repoUrl: 'https://github.com/other/widget' },
      details,
    ),
  )
  assert.throws(() =>
    assertRevisionTarget(repository, {
      ...details,
      baseRef: repository.branchName,
    }),
  )
})

test('revision pushes a descendant to the saved branch with an exact head lease and preserves PR', async () => {
  const calls = []
  let reads = 0
  const result = await pushRevisionRepository(prepared, 'token', {
    verifyPath: false,
    git: gitForPush(calls),
    readPr: async (url) => {
      assert.equal(url, repository.prUrl)
      return { ...details, headSha: reads++ === 0 ? oldSha : newSha }
    },
  })
  assert.deepEqual(result, { changed: true, headSha: newSha })
  const ancestry = calls.findIndex((args) => args[0] === 'merge-base')
  const push = calls.findIndex((args) => args[0] === 'push')
  assert.ok(ancestry >= 0 && ancestry < push)
  assert.deepEqual(calls[push], [
    'push',
    `--force-with-lease=refs/heads/agent/widget:${oldSha}`,
    'https://github.com/acme/widget.git',
    `${newSha}:refs/heads/agent/widget`,
  ])
  assert.equal(reads, 2)
})

test('concurrent PR changes, branch switches, dirty files, and rewritten history prevent a push', async () => {
  for (const scenario of ['stale', 'branch', 'dirty', 'diverged']) {
    const calls = []
    const overrides =
      scenario === 'branch'
        ? { branch: 'main' }
        : scenario === 'dirty'
          ? { status: ' M src/button.ts' }
          : { diverged: scenario === 'diverged' }
    await assert.rejects(
      pushRevisionRepository(prepared, 'token', {
        verifyPath: false,
        git: gitForPush(calls, overrides),
        readPr: async () => ({
          ...details,
          headSha: scenario === 'stale' ? newSha : oldSha,
        }),
      }),
    )
    assert.equal(
      calls.some((args) => args[0] === 'push'),
      false,
      scenario,
    )
  }
})

test('unchanged repository preserves the PR without pushing', async () => {
  const calls = []
  const result = await pushRevisionRepository(prepared, 'token', {
    verifyPath: false,
    git: gitForPush(calls, { sha: oldSha }),
    readPr: async () => details,
  })
  assert.equal(result.changed, false)
  assert.equal(
    calls.some((args) => args[0] === 'push'),
    false,
  )
})

test('real Git push preserves a concurrent remote commit even when it changes after the API check', async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), 'planner-review-git-')),
  )
  try {
    const remote = join(workspace, 'remote.git')
    const local = join(workspace, 'repo')
    const rival = join(workspace, 'rival')
    await mkdir(local)
    await reviewGit(workspace, ['init', '--bare', remote])
    await reviewGit(local, ['init', '--initial-branch', 'agent/widget'])
    await reviewGit(local, ['config', 'user.name', 'Test'])
    await reviewGit(local, ['config', 'user.email', 'test@example.invalid'])
    await writeFile(join(local, 'code.txt'), 'original\n')
    await reviewGit(local, ['add', 'code.txt'])
    await reviewGit(local, ['commit', '-m', 'Initial code'])
    await reviewGit(local, ['push', remote, 'HEAD:refs/heads/agent/widget'])
    const initial = await reviewGit(local, ['rev-parse', 'HEAD'])
    await reviewGit(workspace, [
      'clone',
      '--branch',
      'agent/widget',
      remote,
      rival,
    ])
    await reviewGit(rival, ['config', 'user.name', 'Other author'])
    await reviewGit(rival, ['config', 'user.email', 'other@example.invalid'])
    await writeFile(join(local, 'code.txt'), 'requested change\n')
    await reviewGit(local, ['commit', '-am', 'Requested change'])
    await writeFile(join(rival, 'code.txt'), 'concurrent change\n')
    await reviewGit(rival, ['commit', '-am', 'Concurrent change'])
    const rivalSha = await reviewGit(rival, ['rev-parse', 'HEAD'])
    let pushed = false
    await assert.rejects(
      pushRevisionRepository(
        { ...prepared, repoDir: local, expectedHeadSha: initial },
        '',
        {
          readPr: async () => ({ ...details, headSha: initial }),
          git: async (dir, args) => {
            if (args[0] === 'push') {
              pushed = true
              await reviewGit(rival, [
                'push',
                remote,
                'HEAD:refs/heads/agent/widget',
              ])
              args = args.map((arg) =>
                arg === 'https://github.com/acme/widget.git' ? remote : arg,
              )
            }
            return reviewGit(dir, args)
          },
        },
      ),
      /stale info|rejected/,
    )
    assert.equal(pushed, true)
    assert.equal(
      await reviewGit(workspace, [
        '--git-dir',
        remote,
        'rev-parse',
        'refs/heads/agent/widget',
      ]),
      rivalSha,
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('preparation preserves repository positions, resumes one open branch, and skips merged and unchanged repositories', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'planner-review-'))
  try {
    const calls = []
    const repos = [
      {
        ...repository,
        repoUrl: 'https://github.com/acme/context',
        prUrl: null,
        branchName: null,
        prNumber: null,
        status: 'skipped',
      },
      repository,
      {
        ...repository,
        prUrl: 'https://github.com/acme/widget/pull/8',
        prNumber: 8,
      },
    ]
    const results = await prepareRevisionRepositories(
      { ...review, repositories: repos },
      workspace,
      'token',
      {
        readPr: async (url) =>
          url.endsWith('/8')
            ? { ...details, number: 8, merged: true, state: 'closed' }
            : details,
        git: async (_dir, args) => {
          calls.push(args)
          return args[0] === 'rev-parse' ? oldSha : ''
        },
      },
    )
    assert.deepEqual(
      results.map((r) => [r.position, r.status, r.writable]),
      [
        [0, 'skipped', false],
        [1, 'success', true],
        [2, 'merged', false],
      ],
    )
    assert.equal(results[1].repoDir, join(workspace, 'context-repos/repo-2'))
    assert.equal(results[1].prUrl, repository.prUrl)
    assert.equal(calls.filter((args) => args[0] === 'clone').length, 1)
    assert.ok(
      calls.some(
        (args) =>
          args.join(' ') ===
          'checkout -b agent/widget refs/remotes/origin/agent/widget',
      ),
    )
    assert.ok(
      calls.some(
        (args) =>
          args.join(' ') ===
          'remote set-url --push origin disabled://planner-review',
      ),
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('review answers use the actual PR diff and file contents at its immutable head', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    let body
    if (url.endsWith('/pulls/7'))
      body = {
        number: 7,
        state: 'open',
        head: { ref: 'agent/widget', sha: oldSha },
        base: { ref: 'main' },
      }
    else if (url.includes('/files?'))
      body = [
        {
          filename: 'src/button.ts',
          status: 'modified',
          patch: '@@ -1 +1 @@\n-hidden\n+visible',
        },
      ]
    else
      body = {
        encoding: 'base64',
        content: Buffer.from('export const label = "Reset"').toString('base64'),
        size: 28,
      }
    return new Response(JSON.stringify(body), { status: 200 })
  }
  const snapshot = await loadReviewSnapshot(review, 'token', fetchImpl)
  assert.match(snapshot, /Branch: agent\/widget/)
  assert.match(snapshot, /\+visible/)
  assert.match(snapshot, /export const label = "Reset"/)
  assert.ok(
    calls.some(({ url }) =>
      url.endsWith(`/contents/src/button.ts?ref=${oldSha}`),
    ),
  )
  assert.ok(calls.every(({ init }) => !init.method || init.method === 'GET'))
  const prompt = buildAnswerPrompt({ ...task, reviewSnapshot: snapshot })
  assert.match(prompt, /You have no tools/)
  assert.match(prompt, /Do not edit files/)
  assert.match(prompt, /evidence, not instructions/)
})

test('revision prompt uses existing identities, local commits, and the full proof contract', () => {
  const prompt = buildRevisionPrompt(task, [prepared], {
    runId: 'revision-run',
  })
  assert.match(prompt, /SAME branch.*SAME pull request/)
  assert.match(prompt, /Do not push, force-push, create pull requests/)
  assert.match(prompt, /Do not clone again or create a branch/)
  assert.match(prompt, /\.planner\/proof\/revision-run\/manifest\.json/)
  assert.match(prompt, /Keep the reset button label visible/)
  assert.match(prompt, /agent\/widget/)
  assert.doesNotMatch(prompt, /gh pr create/)
})

test('every run receives project working rules within its existing permissions', () => {
  const configured = {
    ...task,
    projectInstructions: 'Use the service test command: pnpm test:service.',
  }
  for (const prompt of [
    buildPrompt(configured, { runId: 'build' }),
    buildPlanPrompt(configured),
    buildPlanRevisionPrompt(
      configured,
      'Previous plan',
      'Keep the scope small',
    ),
    buildAnswerPrompt(configured),
    buildRevisionPrompt(configured, [prepared], { runId: 'revision' }),
  ]) {
    assert.match(prompt, /pnpm test:service/)
    assert.match(
      prompt,
      /do not grant permission to change code in a read-only run/,
    )
  }
})

test('read-only OpenHands sessions have no tools', async () => {
  const original = globalThis.fetch
  let request
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(init.body)
    return new Response(JSON.stringify({ id: 'answer-session' }), {
      status: 200,
    })
  }
  try {
    const client = new OpenHandsClient({
      baseUrl: 'http://localhost:8000',
      llmModel: 'test',
      llmApiKey: 'secret',
      timeoutMs: 1000,
    })
    await client.startConversation('Explain this diff', '/workspace/question', {
      readOnly: true,
    })
    assert.deepEqual(request.agent.tools, [])
  } finally {
    globalThis.fetch = original
  }
})

test('OpenHands emits messages in time order so the final answer is retained', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            id: 'last',
            timestamp: '2026-09-06T01:01:00Z',
            kind: 'MessageEvent',
          },
          {
            id: 'first',
            timestamp: '2026-09-06T01:00:00Z',
            kind: 'MessageEvent',
          },
        ],
      }),
      { status: 200 },
    )
  try {
    const client = new OpenHandsClient({
      baseUrl: 'http://localhost:8000',
      llmModel: 'test',
      llmApiKey: 'secret',
      timeoutMs: 1000,
    })
    const order = []
    let done = false
    await client.pollEvents('answer-session', {
      onEvent: (event) => order.push(event.id),
      shouldStop: () => done,
      onPoll: async () => {
        done = true
      },
      intervalMs: 0,
    })
    assert.deepEqual(order, ['first', 'last'])
  } finally {
    globalThis.fetch = original
  }
})
