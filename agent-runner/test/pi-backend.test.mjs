import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { PiClient } from '../dist/pi.js'

function fixtureModels(responses) {
  const faux = fauxProvider({
    provider: 'pi-contract',
    models: [{ id: 'demo' }],
  })
  faux.setResponses(responses)
  const models = createModels()
  models.setProvider(faux.provider)
  return { models, model: { provider: 'pi-contract', modelId: 'demo' }, faux }
}

function call(name, args) {
  return fauxAssistantMessage(fauxToolCall(name, args), {
    stopReason: 'toolUse',
  })
}

test('Pi backend runs actual read/write/bash tools and maps results to the runner contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planner-pi-contract-'))
  const config = {
    stateDir: join(root, 'state'),
    ...fixtureModels([
      call('read', { path: 'README.md' }),
      call('write', { path: 'plan.md', content: 'Use Pi in the backend.\n' }),
      call('bash', { command: 'printf "Pi shell check\\n"' }),
      fauxAssistantMessage('The plan is ready.'),
    ]),
  }
  let client
  try {
    const workspace = join(root, 'repo')
    await mkdir(workspace)
    await writeFile(join(workspace, 'README.md'), 'Planner contract fixture.\n')
    client = await PiClient.create(config)
    const run = await client.startConversation('Create the plan.', workspace, {
      runId: 'contract-run',
    })
    await client.runConversation(run.id)
    const events = []
    let terminal = false
    await client.pollEvents(run.id, {
      intervalMs: 5,
      onEvent: (event) => events.push(event),
      onPoll: async () => {
        terminal =
          (await client.getConversation(run.id)).execution_status !== 'running'
      },
      shouldStop: () => terminal,
    })
    const result = await client.wait(run.id)
    assert.equal(result.status, 'done')
    assert.equal(
      await readFile(join(workspace, 'plan.md'), 'utf8'),
      'Use Pi in the backend.\n',
    )
    assert.deepEqual(
      events
        .filter((event) => event.kind === 'ActionEvent')
        .map((event) => event.summary),
      ['Pi read', 'Pi write', 'Pi bash'],
    )
    assert.ok(events.some((event) => event.message === 'The plan is ready.'))
    assert.ok(
      events.some((event) =>
        event.observation?.content?.some((part) =>
          part.text?.includes('Pi shell check'),
        ),
      ),
    )
    const record = JSON.parse(
      await readFile(join(root, 'state/contract-run/run.json'), 'utf8'),
    )
    await client.close()
    client = await PiClient.create(config)
    await client.startConversation('A repeated client request.', workspace, {
      runId: run.id,
    })
    const restored = await client.wait(run.id)
    assert.equal(restored.id, record.submissionId)
    assert.equal(restored.status, 'done')
    assert.equal(
      (await client.entries(run.id))
        .flatMap((entry) => entry.model ?? [])
        .filter((message) => message.role === 'user').length,
      1,
    )
  } finally {
    await client?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Pi read-only runs reject a file-change tool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planner-pi-readonly-'))
  let client
  try {
    const models = fixtureModels([
      call('write', { path: 'forbidden.txt', content: 'bad' }),
      fauxAssistantMessage('I can only read this repository.'),
    ])
    client = await PiClient.create({ stateDir: join(root, 'state'), ...models })
    const run = await client.startConversation('Answer a question.', root, {
      runId: 'question',
      readOnly: true,
    })
    assert.equal((await client.wait(run.id)).status, 'done')
    await assert.rejects(readFile(join(root, 'forbidden.txt')), {
      code: 'ENOENT',
    })
    assert.ok(
      (await client.entries(run.id))
        .flatMap((entry) => entry.model ?? [])
        .some((message) => message.role === 'toolResult' && message.isError),
    )
  } finally {
    await client?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Pi requires ChatGPT OAuth and does not fall back to a model API key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planner-pi-auth-'))
  try {
    await assert.rejects(
      PiClient.create({
        stateDir: join(root, 'state'),
        authDir: join(root, 'no-login'),
      }),
      /Pi needs your ChatGPT login/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Pi deduplicates a plan retry but admits a new plan version for the same run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planner-pi-plan-version-'))
  let client
  try {
    const fixture = fixtureModels([
      fauxAssistantMessage('Plan version one.'),
      fauxAssistantMessage('Plan version two.'),
    ])
    client = await PiClient.create({
      stateDir: join(root, 'state'),
      ...fixture,
    })
    const first = await client.startConversation('Create a plan.', root, {
      runId: 'plan',
      requestId: 'planner:plan:version:1',
    })
    const original = await client.wait(first.id)
    await client.release(first.id)
    await client.startConversation('Create a plan again.', root, {
      runId: 'plan',
      requestId: 'planner:plan:version:1',
    })
    assert.equal((await client.wait(first.id)).id, original.id)
    assert.equal(fixture.faux.state.callCount, 1)
    await client.release(first.id)
    await client.startConversation('Revise the plan.', root, {
      runId: 'plan',
      requestId: 'planner:plan:version:2',
    })
    const revised = await client.wait(first.id)
    assert.equal(revised.status, 'done')
    assert.notEqual(revised.id, original.id)
    assert.equal(fixture.faux.state.callCount, 2)
    assert.equal(
      (await client.entries(first.id))
        .flatMap((entry) => entry.model ?? [])
        .filter((message) => message.role === 'user').length,
      2,
    )
  } finally {
    await client?.close()
    await rm(root, { recursive: true, force: true })
  }
})
