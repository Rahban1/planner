import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PiClient } from './pi.js'

// A live subscription check uses only this scratch repository.
const root = resolve(process.env.PI_DEMO_DIR ?? '../.pi-prototype/live-demo')
const workspace = join(root, 'workspace')
await mkdir(workspace, { recursive: true })
await writeFile(
  join(workspace, 'README.md'),
  '# Planner prototype\n\nThe backend must use Pi and your ChatGPT subscription.\n',
)
const client = await PiClient.create({
  stateDir: join(root, 'state'),
  authDir: process.env.PI_AUTH_DIR,
  modelId: process.env.PI_MODEL,
})
try {
  const run = await client.startConversation(
    'Read README.md. Write a short plan to .agent-plan-md. Explain how the Pi backend can resume a task after a process failure. Use ASD-STE100. Use the read and write tools. Do not run shell commands.',
    workspace,
    { runId: 'live-plan' },
  )
  await client.runConversation(run.id)
  let terminal = false
  await client.pollEvents(run.id, {
    intervalMs: 500,
    onEvent: (event) =>
      console.log(event.message ?? event.summary ?? `Pi ${event.kind}`),
    onPoll: async () => {
      terminal =
        (await client.getConversation(run.id)).execution_status !== 'running'
    },
    shouldStop: () => terminal,
  })
  const result = await client.wait(run.id)
  if (result.status !== 'done')
    throw new Error('Pi did not complete the live plan.')
  const plan = await readFile(join(workspace, '.agent-plan-md'), 'utf8')
  if (!plan.trim()) throw new Error('Pi did not save a plan.')
  console.log(
    `PASS: Pi used the ChatGPT subscription and saved ${join(workspace, '.agent-plan-md')}`,
  )
} finally {
  await client.close()
}
