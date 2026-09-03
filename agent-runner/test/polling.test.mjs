import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getTerminalExecutionStatus,
  hasExceededIdleLimit,
  shouldStopPolling,
} from '../dist/polling.js'

test('does not stop polling while conversation is still running', () => {
  assert.equal(
    shouldStopPolling({
      timedOut: false,
      startedAt: 0,
      now: 9_000,
      maxRuntimeMs: 15 * 60 * 1000,
      terminalStatus: getTerminalExecutionStatus('running'),
    }),
    false,
  )
})

test('stops polling once a terminal status is reached', () => {
  assert.equal(
    shouldStopPolling({
      timedOut: false,
      startedAt: 0,
      now: 9_000,
      maxRuntimeMs: 15 * 60 * 1000,
      terminalStatus: getTerminalExecutionStatus('finished'),
    }),
    true,
  )
})

test('stops polling when the runtime limit is exceeded', () => {
  assert.equal(
    shouldStopPolling({
      timedOut: false,
      startedAt: 0,
      now: 15 * 60 * 1000 + 1,
      maxRuntimeMs: 15 * 60 * 1000,
      terminalStatus: null,
    }),
    true,
  )
})

test('detects a conversation that has produced no events for five minutes', () => {
  assert.equal(
    hasExceededIdleLimit({
      lastEventAt: 1_000,
      now: 5 * 60 * 1000 + 1_001,
      maxIdleMs: 5 * 60 * 1000,
    }),
    true,
  )
  assert.equal(
    hasExceededIdleLimit({
      lastEventAt: 1_000,
      now: 5 * 60 * 1000 + 1_000,
      maxIdleMs: 5 * 60 * 1000,
    }),
    false,
  )
})
