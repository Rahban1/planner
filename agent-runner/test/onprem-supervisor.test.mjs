import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOpenHandsContainerArgs,
  buildMergeCheckContainerArgs,
  buildRunnerContainerArgs,
  loadSupervisorConfig,
} from '../dist/onprem-supervisor.js'

const config = loadSupervisorConfig({
  PLANNER_BASE_URL: 'https://planner.example.com',
  PLANNER_CONTAINER_BASE_URL: 'https://planner.internal.example.com',
  RUNNER_API_TOKEN: 'runner-secret',
  RUNNER_IMAGE: 'runner:test',
  OPENHANDS_IMAGE: 'openhands:test',
  RUNNER_REPOSITORY_CACHE: '/srv/planner/cache',
  ONPREM_SECRET_DIR: '/srv/planner/secrets',
  CONTAINER_SELINUX_LABEL: 'z',
  MAX_PARALLEL: '3',
})
const names = {
  network: 'planner-run',
  volume: 'planner-run',
  openhands: 'planner-openhands-run',
  runner: 'planner-runner-run',
}

test('loads bounded supervisor configuration', () => {
  assert.equal(config.maxParallel, 3)
  assert.equal(config.runtime, 'docker')
  assert.equal(
    config.plannerContainerBaseUrl,
    'https://planner.internal.example.com',
  )
})

test('keeps source-control credentials out of the agent container', () => {
  const args = buildOpenHandsContainerArgs(config, names)
  assert.equal(
    args.some((value) => /TOKEN|secret/i.test(value)),
    false,
  )
  assert.ok(args.includes('no-new-privileges'))
  assert.ok(args.includes('ALL'))
})

test('mounts credentials only in the trusted runner container', () => {
  const args = buildRunnerContainerArgs(config, names, 'run-1', {
    SCM_PROVIDER: 'bitbucket_data_center',
    BITBUCKET_BASE_URL: 'https://bitbucket.example.com',
  })
  assert.ok(args.includes('/srv/planner/secrets:/run/secrets/planner:ro,z'))
  assert.ok(args.includes('SCM_TOKEN_FILE=/run/secrets/planner/scm_token'))
  assert.ok(
    args.includes('/srv/planner/cache:/var/lib/planner-runner/mirrors:z'),
  )
  assert.ok(
    args.includes('PLANNER_BASE_URL=https://planner.internal.example.com'),
  )
  assert.equal(
    args.some((value) => value.includes('runner-secret')),
    false,
  )
})

test('rejects an invalid SELinux volume label', () => {
  assert.throws(
    () =>
      loadSupervisorConfig({
        PLANNER_BASE_URL: 'https://planner.example.com',
        CONTAINER_SELINUX_LABEL: 'disable',
      }),
    /must be empty, z, or Z/,
  )
})

test('runs merge checks without an OpenHands container', () => {
  const args = buildMergeCheckContainerArgs(config, {
    SCM_PROVIDER: 'bitbucket_data_center',
    BITBUCKET_BASE_URL: 'https://bitbucket.example.com',
  })
  assert.ok(args.includes('RUNNER_MERGE_CHECK_ONLY=1'))
  assert.ok(args.includes('SCM_TOKEN_FILE=/run/secrets/planner/scm_token'))
  assert.equal(
    args.some((value) => value.includes('openhands')),
    false,
  )
})
