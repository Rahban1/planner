import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const browserScripts = [
  'flush-events.js',
  'rrweb-loader.js',
  'start-recording-simple.js',
  'start-recording.js',
  'stop-recording.js',
  'wait-for-rrweb.js',
]

test('agent image supplies every browser recording asset omitted by OpenHands 1.32.0', async () => {
  const dockerfile = await readFile(
    new URL('../Dockerfile.agent-server', import.meta.url),
    'utf8',
  )

  assert.match(dockerfile, /apt-get install[\s\S]*\btime\b/)
  assert.match(dockerfile, /corepack\/dist\/corepack\.js/)
  assert.match(dockerfile, /COPY openhands-browser-js\//)
  assert.match(dockerfile, /wait-for-rrweb\.js/)

  for (const script of browserScripts) {
    await access(new URL(`../openhands-browser-js/${script}`, import.meta.url))
  }
})

test('hosted runner validates the browser recording assets before a task starts', async () => {
  const workflow = await readFile(
    new URL('../../.github/workflows/planner-agent-run.yml', import.meta.url),
    'utf8',
  )

  assert.match(workflow, /docker exec planner-openhands \/usr\/bin\/time --version/)
  assert.match(workflow, /docker exec planner-openhands corepack --version/)
  assert.match(workflow, /wait-for-rrweb\.js/)
})
