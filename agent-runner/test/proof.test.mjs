import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  loadProofPack,
  renderProofSection,
  upsertProofSection,
} from '../dist/proof.js'

const RUN_ID = 'run-123'
const TESTED_SHA = '1'.repeat(40)

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function makeProofPack(overrides = {}) {
  const repoDir = await mkdtemp(join(tmpdir(), 'planner-proof-'))
  const proofDir = join(repoDir, '.planner', 'proof', RUN_ID)
  await mkdir(join(proofDir, 'logs'), { recursive: true })
  await mkdir(join(proofDir, 'screenshots'), { recursive: true })
  await mkdir(join(proofDir, 'video'), { recursive: true })

  const files = {
    'report.md': '# Proof report\n',
    'logs/test.txt': '8 tests passed\n',
    'screenshots/desktop.png': 'desktop-image',
    'screenshots/mobile.png': 'mobile-image',
    'video/ui-flow.webm': 'video-bytes',
  }

  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(join(proofDir, relativePath), content)
  }

  const artifacts = []
  for (const [relativePath] of Object.entries(files)) {
    const absolutePath = join(proofDir, relativePath)
    const bytes = (await readFile(absolutePath)).byteLength
    const type = relativePath.endsWith('.png')
      ? 'screenshot'
      : relativePath.endsWith('.webm')
        ? 'video'
        : relativePath.endsWith('.txt')
          ? 'log'
          : 'report'
    artifacts.push({
      path: relativePath,
      type,
      bytes,
      sha256: await sha256(absolutePath),
    })
  }

  const manifest = {
    version: 1,
    runId: RUN_ID,
    testedCommitSha: TESTED_SHA,
    generatedAt: '2026-08-13T10:00:00.000Z',
    environment: {
      os: 'linux',
      runtime: 'node 22',
      browser: 'chromium',
    },
    changeType: 'ui',
    overall: 'pass',
    checks: [
      {
        id: 'targeted-tests',
        title: 'Targeted regression tests',
        layer: 'targeted',
        status: 'pass',
        command: 'npm test',
        exitCode: 0,
        durationMs: 1200,
        outputPath: 'logs/test.txt',
        evidencePaths: ['screenshots/desktop.png', 'screenshots/mobile.png'],
      },
    ],
    artifacts,
    limitations: [],
    reproduce: ['npm test'],
    ...overrides,
  }

  await writeFile(
    join(proofDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
  return { repoDir, proofDir, manifest }
}

test('loads a complete UI proof pack through the manifest contract', async () => {
  const { repoDir } = await makeProofPack()

  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: [TESTED_SHA],
  })

  assert.equal(proof.state, 'pass')
  assert.equal(proof.manifest?.checks[0].status, 'pass')
  assert.deepEqual(proof.errors, [])
})

test('reports FAIL, BLOCKED, and NOT RUN checks without rejecting honest proof', async () => {
  const statuses = ['fail', 'blocked', 'not_run']
  const checks = statuses.map((status, index) => ({
    id: `check-${index}`,
    title: `Check ${index}`,
    layer: 'integration',
    status,
    ...(status === 'fail' ? { durationMs: 10 } : {}),
    evidencePaths: [],
  }))
  const { repoDir } = await makeProofPack({ overall: 'fail', checks })

  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: [TESTED_SHA],
  })

  assert.equal(proof.state, 'fail')
  assert.deepEqual(proof.errors, [])
})

test('accepts partial UI proof when browser capture is blocked', async () => {
  const { repoDir, manifest, proofDir } = await makeProofPack()
  const missingMedia = [
    'screenshots/desktop.png',
    'screenshots/mobile.png',
    'video/ui-flow.webm',
  ]

  for (const path of missingMedia) {
    await unlink(join(proofDir, path))
  }
  manifest.artifacts = manifest.artifacts.filter(
    (artifact) => !missingMedia.includes(artifact.path),
  )
  manifest.checks = [
    {
      id: 'targeted-tests',
      title: 'Targeted regression tests',
      layer: 'targeted',
      status: 'pass',
      command: 'npm test',
      exitCode: 0,
      durationMs: 1200,
      outputPath: 'logs/test.txt',
      evidencePaths: [],
    },
    {
      id: 'browser-proof',
      title: 'Browser proof',
      layer: 'browser',
      status: 'blocked',
      evidencePaths: [],
    },
  ]
  manifest.overall = 'partial'
  manifest.limitations = ['Browser recording tool was unavailable.']
  await writeFile(
    join(proofDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: [TESTED_SHA],
  })

  assert.equal(proof.state, 'partial')
  assert.deepEqual(proof.errors, [])
})

test('rejects a tested commit that is not part of the pull request', async () => {
  const { repoDir } = await makeProofPack()

  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: ['2'.repeat(40)],
  })

  assert.equal(proof.state, 'incomplete')
  assert.match(proof.errors.join('\n'), /tested commit is not in the pull request/i)
})

test('rejects proof files that are not committed in the pull request', async () => {
  const { repoDir } = await makeProofPack()

  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: [TESTED_SHA],
    committedPaths: [`.planner/proof/${RUN_ID}/manifest.json`],
  })

  assert.equal(proof.state, 'incomplete')
  assert.match(proof.errors.join('\n'), /is not committed in the pull request/i)
})

test('rejects artifact path traversal', async () => {
  const { repoDir, manifest, proofDir } = await makeProofPack()
  manifest.artifacts[0].path = '../secret.txt'
  await writeFile(join(proofDir, 'manifest.json'), JSON.stringify(manifest))

  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: [TESTED_SHA],
  })

  assert.equal(proof.state, 'incomplete')
  assert.match(proof.errors.join('\n'), /safe relative path/i)
})

test('rejects symlink artifacts', async () => {
  const { repoDir, manifest, proofDir } = await makeProofPack()
  await writeFile(join(proofDir, 'outside.txt'), 'outside')
  await symlink(join(proofDir, 'outside.txt'), join(proofDir, 'logs', 'linked.txt'))
  manifest.artifacts.push({
    path: 'logs/linked.txt',
    type: 'log',
    bytes: 7,
    sha256: createHash('sha256').update('outside').digest('hex'),
  })
  await writeFile(join(proofDir, 'manifest.json'), JSON.stringify(manifest))

  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: [TESTED_SHA],
  })

  assert.equal(proof.state, 'incomplete')
  assert.match(proof.errors.join('\n'), /must not be a symbolic link/i)
})

test('rejects files above 10 MB from declared size before reading them', async () => {
  const { repoDir, manifest, proofDir } = await makeProofPack()
  manifest.artifacts[0].bytes = 10 * 1024 * 1024 + 1
  await writeFile(join(proofDir, 'manifest.json'), JSON.stringify(manifest))

  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: [TESTED_SHA],
  })

  assert.equal(proof.state, 'incomplete')
  assert.match(proof.errors.join('\n'), /10 MB limit/i)
})

test('accepts a plain-text command exit-code artifact', async () => {
  const { repoDir, manifest, proofDir } = await makeProofPack()
  const exitPath = join(proofDir, 'logs', 'test.exit')
  await writeFile(exitPath, '0\n')
  manifest.artifacts.push({
    path: 'logs/test.exit',
    type: 'log',
    bytes: 2,
    sha256: await sha256(exitPath),
  })
  await writeFile(join(proofDir, 'manifest.json'), JSON.stringify(manifest))

  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: [TESTED_SHA],
  })

  assert.equal(proof.state, 'pass')
  assert.deepEqual(proof.errors, [])
})

test('renders an honest proof section with permanent media links', async () => {
  const { repoDir } = await makeProofPack()
  const proof = await loadProofPack({
    repoDir,
    runId: RUN_ID,
    allowedCommitShas: [TESTED_SHA],
  })

  const section = renderProofSection(proof)

  assert.match(section, /Verification result: PASS/)
  assert.match(section, /This report proves only the checks shown below/)
  assert.match(section, /\.\.\/blob\/1111111111111111111111111111111111111111\/\.planner\/proof\/run-123\/screenshots\/desktop\.png\?raw=true/)
  assert.match(section, /ui-flow\.webm/)
  assert.doesNotMatch(section, /100% verified/i)
})

test('replaces the managed proof section without changing the rest of the PR body', () => {
  const original = `## Problem\nKeep this text.\n\n<!-- planner-proof:start -->\nold\n<!-- planner-proof:end -->\n\n## Notes\nKeep this too.`
  const replacement = '<!-- planner-proof:start -->\nnew\n<!-- planner-proof:end -->'

  const once = upsertProofSection(original, replacement)
  const twice = upsertProofSection(once, replacement)

  assert.equal(once, twice)
  assert.match(once, /## Problem\nKeep this text/)
  assert.match(once, /## Notes\nKeep this too/)
  assert.doesNotMatch(once, /old/)
})

test('renders missing proof as INCOMPLETE instead of claiming success', () => {
  const section = renderProofSection({
    state: 'incomplete',
    manifest: null,
    proofDir: null,
    errors: ['manifest.json was not found'],
  })

  assert.match(section, /Verification result: INCOMPLETE/)
  assert.match(section, /manifest\.json was not found/)
  assert.doesNotMatch(section, /100% verified/i)
})
