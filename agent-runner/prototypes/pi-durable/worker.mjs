// PROTOTYPE: a scripted model drives the real Pi backend and real coding tools.
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createModels } from '@earendil-works/pi-ai/models'
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux'
import { defineTool } from '@earendil-works/pi-durable'
import { Type } from '@earendil-works/pi-ai'
import { PiClient } from '../../dist/pi.js'

const [phase, scenario, root] = process.argv.slice(2)
const workspace = join(root, 'workspace')
const plan =
  '# Prototype plan\n\n1. Read the repository instructions.\n2. Add the Pi backend.\n3. Verify recovery after a process failure.\n'
const model = fauxProvider({
  provider: 'planner-prototype',
  models: [{ id: 'demo' }],
})
const response = (transcript) => {
  const results = transcript.messages.filter(
    (message) => message.role === 'toolResult',
  )
  if (!results.some((message) => message.toolName === 'read')) {
    return fauxAssistantMessage(fauxToolCall('read', { path: 'README.md' }), {
      stopReason: 'toolUse',
    })
  }
  const gateName = scenario === 'receipt' ? 'publish_receipt' : 'prototype_gate'
  if (!results.some((message) => message.toolName === gateName)) {
    return fauxAssistantMessage(fauxToolCall(gateName, {}), {
      stopReason: 'toolUse',
    })
  }
  if (
    scenario === 'plan' &&
    !results.some((message) => message.toolName === 'write')
  ) {
    return fauxAssistantMessage(
      fauxToolCall('write', { path: '.agent-plan-md', content: plan }),
      { stopReason: 'toolUse' },
    )
  }
  return fauxAssistantMessage('The prototype task is complete.')
}
model.setResponses(Array.from({ length: 12 }, () => response))
const models = createModels()
models.setProvider(model.provider)

async function waitForAbort(signal) {
  await new Promise((_, reject) => {
    if (signal?.aborted) return reject(new Error('Prototype stopped.'))
    const timer = setInterval(() => {}, 1000)
    signal?.addEventListener(
      'abort',
      () => {
        clearInterval(timer)
        reject(new Error('Prototype stopped.'))
      },
      { once: true },
    )
  })
}

const gate = defineTool({
  name: scenario === 'receipt' ? 'publish_receipt' : 'prototype_gate',
  description: 'Pause the local proof at the crash boundary.',
  parameters: Type.Object({}),
  replay: scenario === 'unsafe' ? 'unsafe' : 'safe',
  execute: async (_args, _api, context) => {
    await appendFile(
      join(root, 'attempts.jsonl'),
      JSON.stringify({ phase, scenario }) + '\n',
    )
    if (scenario === 'receipt') {
      // A receipt makes this particular external-write adapter safe to replay.
      // This file represents a local service. It is not a GitHub PR.
      try {
        await writeFile(
          join(root, 'publication.json'),
          JSON.stringify({ id: 'local-receipt-1' }),
          { flag: 'wx' },
        )
        await appendFile(join(root, 'effects.jsonl'), 'publication\n')
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
    } else if (scenario === 'unsafe') {
      await appendFile(join(root, 'effects.jsonl'), 'unsafe-write\n')
    }
    await writeFile(
      join(root, 'ready.json'),
      JSON.stringify({ phase, scenario }),
    )
    if (phase === 'crash' || scenario === 'stop')
      await waitForAbort(context.abortSignal)
    return {
      content: [{ type: 'text', text: 'The checkpoint step is complete.' }],
    }
  },
})

const client = await PiClient.create({
  stateDir: join(root, 'state'),
  models,
  model: { provider: 'planner-prototype', modelId: 'demo' },
  extraTools: [gate],
})
try {
  const conversation = await client.startConversation(
    'Create a plan for the Pi backend prototype.',
    workspace,
    { runId: 'demo-run' },
  )
  await client.runConversation(conversation.id)
  if (scenario === 'stop') {
    while (true) {
      try {
        await readFile(join(root, 'ready.json'))
        break
      } catch {
        await new Promise((done) => setTimeout(done, 25))
      }
    }
    await client.pauseConversation(conversation.id)
  }
  const settled = await client.wait(conversation.id)
  const entries = await client.entries(conversation.id)
  const record = JSON.parse(
    await readFile(join(root, 'state/demo-run/run.json'), 'utf8'),
  )
  await writeFile(
    join(root, 'result.json'),
    JSON.stringify(
      {
        phase,
        scenario,
        submissionId: record.submissionId,
        status: settled.status,
        reason: settled.reason,
        userMessages: entries
          .flatMap((entry) => entry.model ?? [])
          .filter((message) => message.role === 'user').length,
        readResults: entries
          .flatMap((entry) => entry.model ?? [])
          .filter(
            (message) =>
              message.role === 'toolResult' && message.toolName === 'read',
          ).length,
        interruptedResults: entries
          .flatMap((entry) => entry.model ?? [])
          .filter((message) => message.role === 'toolResult' && message.isError)
          .length,
        eventCount: entries.length,
      },
      null,
      2,
    ),
  )
} finally {
  await client.close()
}
