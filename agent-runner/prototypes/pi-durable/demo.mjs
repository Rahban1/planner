import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const output = resolve(here, '../../../.pi-prototype', `proof-${Date.now()}`)
await mkdir(output, { recursive: true })

function worker(phase, scenario, root) {
  const child = spawn(
    process.execPath,
    [join(here, 'worker.mjs'), phase, scenario, root],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let diagnostics = ''
  child.stdout.on('data', (data) => {
    diagnostics += data
  })
  child.stderr.on('data', (data) => {
    diagnostics += data
  })
  const closed = new Promise((done) => {
    child.on('error', (error) =>
      done({ code: -1, signal: null, diagnostics: String(error) }),
    )
    child.on('close', (code, signal) => done({ code, signal, diagnostics }))
  })
  return { child, closed }
}

async function waitForFile(path, child, milliseconds = 25_000) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (child.exitCode !== null)
      throw new Error(`The worker exited before it saved ${path}.`)
    await new Promise((done) => setTimeout(done, 50))
  }
  throw new Error(`The worker did not save ${path} before the timeout.`)
}

async function finish(job) {
  const timer = setTimeout(() => job.child.kill('SIGKILL'), 40_000)
  const result = await job.closed
  clearTimeout(timer)
  assert.equal(result.code, 0, result.diagnostics)
}

const results = []
for (const scenario of ['plan', 'unsafe', 'receipt']) {
  const root = join(output, scenario)
  await mkdir(join(root, 'workspace'), { recursive: true })
  await writeFile(
    join(root, 'workspace/README.md'),
    'Planner prototype repository. Use Pi as the backend agent.\n',
  )
  console.log(`[prototype] Start ${scenario} crash check.`)
  const first = worker('crash', scenario, root)
  try {
    await waitForFile(join(root, 'ready.json'), first.child)
    const initial = JSON.parse(
      await waitForFile(join(root, 'state/demo-run/run.json'), first.child),
    )
    first.child.kill('SIGKILL')
    const terminated = await first.closed
    assert.equal(terminated.signal, 'SIGKILL', terminated.diagnostics)
    await finish(worker('resume', scenario, root))
    const result = JSON.parse(await readFile(join(root, 'result.json'), 'utf8'))
    assert.equal(result.status, 'done')
    assert.equal(result.submissionId, initial.submissionId)
    assert.equal(result.userMessages, 1)
    assert.equal(result.readResults, 1)
    const attempts = (await readFile(join(root, 'attempts.jsonl'), 'utf8'))
      .trim()
      .split('\n').length
    if (scenario === 'unsafe') {
      assert.equal(attempts, 1)
      assert.equal(result.interruptedResults, 1)
    } else {
      assert.equal(attempts, 2)
    }
    if (scenario === 'receipt' || scenario === 'unsafe') {
      assert.equal(
        (await readFile(join(root, 'effects.jsonl'), 'utf8')).trim().split('\n')
          .length,
        1,
      )
    }
    if (scenario === 'plan') {
      assert.match(
        await readFile(join(root, 'workspace/.agent-plan-md'), 'utf8'),
        /Verify recovery/,
      )
    }
    results.push({
      check: scenario,
      state: 'PASS',
      ...result,
      toolAttempts: attempts,
    })
    console.log(
      `[prototype] PASS ${scenario}: same submission ${result.submissionId}, one repository read.`,
    )
  } finally {
    if (first.child.exitCode === null && first.child.signalCode === null)
      first.child.kill('SIGKILL')
  }
}

const stopRoot = join(output, 'stop')
await mkdir(join(stopRoot, 'workspace'), { recursive: true })
await writeFile(
  join(stopRoot, 'workspace/README.md'),
  'Planner prototype repository.\n',
)
await finish(worker('run', 'stop', stopRoot))
const stopped = JSON.parse(
  await readFile(join(stopRoot, 'result.json'), 'utf8'),
)
assert.equal(stopped.status, 'unanswered')
// The stop receipt persists. A restart does not start the same submission again.
await finish(worker('resume', 'stop', stopRoot))
const reopened = JSON.parse(
  await readFile(join(stopRoot, 'result.json'), 'utf8'),
)
assert.equal(reopened.status, 'unanswered')
assert.equal(reopened.submissionId, stopped.submissionId)
assert.equal(
  (await readFile(join(stopRoot, 'attempts.jsonl'), 'utf8')).trim().split('\n')
    .length,
  1,
)
results.push({ check: 'stop', state: 'PASS', ...reopened })
console.log(
  '[prototype] PASS stop: the stopped submission remains stopped after restart.',
)

const report = {
  createdAt: new Date().toISOString(),
  engine: 'Pi coding-agent tools + Pi Durable 1.0.0',
  model: 'Pi local model simulator',
  liveChatGPT: 'NOT RUN: complete Pi login before the live check.',
  githubPublication:
    'NOT RUN: the receipt check uses a local simulated service.',
  results,
}
await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log(`[prototype] Evidence: ${join(output, 'report.json')}`)
