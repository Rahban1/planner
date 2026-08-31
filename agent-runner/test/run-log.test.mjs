import assert from 'node:assert/strict'
import test from 'node:test'

import { createResilientAppend } from '../dist/run-log.js'

test('keeps runner log delivery failures from terminating an active run', async () => {
  const logs = []
  const warnings = []
  const append = createResilientAppend({
    runId: 'run-1',
    logs,
    updateStatus: async () => {
      throw new Error('Planner is restarting')
    },
    writeLog: () => {},
    writeWarning: (message) => warnings.push(message),
  })

  await assert.doesNotReject(() => append('PR created'))
  assert.equal(logs.length, 1)
  assert.equal(logs[0].message, 'PR created')
  assert.match(warnings[0], /Planner is restarting/)
})
