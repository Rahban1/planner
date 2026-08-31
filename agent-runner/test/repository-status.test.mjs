import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregateRepositoryStatus } from '../dist/repository-status.js'

test('waits until every changed repository PR is merged', () => {
  assert.equal(aggregateRepositoryStatus(['merged', 'success']), 'success')
  assert.equal(
    aggregateRepositoryStatus(['merged', 'merged', 'skipped']),
    'merged',
  )
})

test('keeps the task incomplete when one repository PR closes', () => {
  assert.equal(aggregateRepositoryStatus(['merged', 'closed']), 'closed')
})
