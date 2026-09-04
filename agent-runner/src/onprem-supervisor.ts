import { execFile, spawn } from 'node:child_process'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { createPlannerFetch } from './planner-client.js'

const execFileAsync = promisify(execFile)

interface QueuedRun {
  id: string
  status: string
}

export interface SupervisorConfig {
  runtime: string
  runnerImage: string
  openhandsImage: string
  plannerBaseUrl: string
  plannerContainerBaseUrl: string
  runnerApiToken: string
  maxParallel: number
  pollIntervalMs: number
  mergeCheckIntervalMs: number
  cacheDir: string
  secretDir: string | null
  containerSelinuxLabel: '' | 'z' | 'Z'
  agentMemory: string
  agentCpus: string
}

export function loadSupervisorConfig(
  env: NodeJS.ProcessEnv = process.env,
): SupervisorConfig {
  return {
    runtime: env.CONTAINER_RUNTIME?.trim() || 'docker',
    runnerImage: env.RUNNER_IMAGE?.trim() || 'planner-agent-runner:local',
    openhandsImage:
      env.OPENHANDS_IMAGE?.trim() || 'planner-openhands-agent-server:local',
    plannerBaseUrl: env.PLANNER_BASE_URL?.trim() || '',
    plannerContainerBaseUrl:
      env.PLANNER_CONTAINER_BASE_URL?.trim() ||
      env.PLANNER_BASE_URL?.trim() ||
      '',
    runnerApiToken: readSecret(env, 'RUNNER_API_TOKEN'),
    maxParallel: positiveInteger(env.MAX_PARALLEL, 2),
    pollIntervalMs: positiveInteger(env.SUPERVISOR_POLL_INTERVAL_MS, 3000),
    mergeCheckIntervalMs: positiveInteger(
      env.SUPERVISOR_MERGE_CHECK_INTERVAL_MS,
      15_000,
    ),
    cacheDir:
      env.RUNNER_REPOSITORY_CACHE?.trim() || '/var/lib/planner-runner/mirrors',
    secretDir: env.ONPREM_SECRET_DIR?.trim() || null,
    containerSelinuxLabel: selinuxLabel(env.CONTAINER_SELINUX_LABEL),
    agentMemory: env.AGENT_MEMORY?.trim() || '6g',
    agentCpus: env.AGENT_CPUS?.trim() || '2',
  }
}

export function buildOpenHandsContainerArgs(
  config: SupervisorConfig,
  names: RunResourceNames,
): string[] {
  return [
    'run',
    '--detach',
    '--name',
    names.openhands,
    '--network',
    names.network,
    '--network-alias',
    'openhands-agent-server',
    '--volume',
    `${names.volume}:/workspace/runs`,
    '--security-opt',
    'no-new-privileges',
    '--cap-drop',
    'ALL',
    '--pids-limit',
    '512',
    '--memory',
    config.agentMemory,
    '--cpus',
    config.agentCpus,
    '--shm-size',
    '1g',
    '--env',
    'PYTHONUNBUFFERED=1',
    config.openhandsImage,
  ]
}

export function buildRunnerContainerArgs(
  config: SupervisorConfig,
  names: RunResourceNames,
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const args = [
    'run',
    '--rm',
    '--name',
    names.runner,
    '--network',
    names.network,
    '--volume',
    `${names.volume}:/workspace/runs`,
    '--volume',
    bindMount(
      config.cacheDir,
      '/var/lib/planner-runner/mirrors',
      false,
      config.containerSelinuxLabel,
    ),
    '--security-opt',
    'no-new-privileges',
    '--cap-drop',
    'ALL',
    '--pids-limit',
    '256',
    '--memory',
    '1g',
    '--cpus',
    '1',
    '--env',
    'OPENHANDS_BASE_URL=http://openhands-agent-server:8000',
    '--env',
    `RUNNER_RUN_ID=${runId}`,
    '--env',
    `RUNNER_JOB_ID=onprem:${hostname()}:${runId}`,
    '--env',
    'RUNNER_MANAGED_GIT=1',
    '--env',
    'RUNNER_WORKSPACE=/workspace/runs',
    '--env',
    'RUNNER_REPOSITORY_CACHE=/var/lib/planner-runner/mirrors',
  ]

  appendRunnerConfiguration(args, config, env)
  args.push(config.runnerImage)
  return args
}

export function buildMergeCheckContainerArgs(
  config: SupervisorConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const args = [
    'run',
    '--rm',
    '--name',
    'planner-merge-check',
    '--security-opt',
    'no-new-privileges',
    '--cap-drop',
    'ALL',
    '--pids-limit',
    '128',
    '--memory',
    '512m',
    '--cpus',
    '0.5',
    '--env',
    'RUNNER_MERGE_CHECK_ONLY=1',
  ]
  appendRunnerConfiguration(args, config, env)
  args.push(config.runnerImage)
  return args
}

function appendRunnerConfiguration(
  args: string[],
  config: SupervisorConfig,
  env: NodeJS.ProcessEnv,
): void {
  args.push('--env', `PLANNER_BASE_URL=${config.plannerContainerBaseUrl}`)
  for (const name of [
    'SCM_PROVIDER',
    'BITBUCKET_BASE_URL',
    'LLM_MODEL',
    'LLM_API_BASE',
  ]) {
    if (env[name]) args.push('--env', `${name}=${env[name]}`)
  }

  if (config.secretDir) {
    args.push(
      '--volume',
      bindMount(
        config.secretDir,
        '/run/secrets/planner',
        true,
        config.containerSelinuxLabel,
      ),
      '--env',
      'SCM_TOKEN_FILE=/run/secrets/planner/scm_token',
      '--env',
      'LLM_API_KEY_FILE=/run/secrets/planner/llm_api_key',
      '--env',
      'RUNNER_API_TOKEN_FILE=/run/secrets/planner/runner_api_token',
    )
    return
  }

  for (const name of [
    'SCM_TOKEN',
    'GITHUB_TOKEN',
    'LLM_API_KEY',
    'RUNNER_API_TOKEN',
  ]) {
    if (env[name]) args.push('--env', name)
  }
}

interface RunResourceNames {
  network: string
  volume: string
  openhands: string
  runner: string
}

function resourceNames(runId: string): RunResourceNames {
  const suffix = runId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 20)
    .toLowerCase()
  return {
    network: `planner-${suffix}`,
    volume: `planner-${suffix}`,
    openhands: `planner-openhands-${suffix}`,
    runner: `planner-runner-${suffix}`,
  }
}

async function main(): Promise<void> {
  const config = loadSupervisorConfig()
  await validateConfiguration(config)
  const plannerFetch = createPlannerFetch({
    baseUrl: config.plannerBaseUrl,
    token: config.runnerApiToken,
  })
  const active = new Map<string, Promise<void>>()
  let mergeCheck: Promise<void> | null = null
  let lastMergeCheckAt = 0

  console.log(
    `[supervisor] ready: runtime=${config.runtime} parallel=${config.maxParallel}`,
  )
  while (true) {
    try {
      if (
        !mergeCheck &&
        Date.now() - lastMergeCheckAt >= config.mergeCheckIntervalMs
      ) {
        lastMergeCheckAt = Date.now()
        mergeCheck = runMergeCheck(config)
          .catch((error) => {
            console.error('[supervisor] merge check failed:', error)
          })
          .finally(() => {
            mergeCheck = null
          })
      }
      if (active.size < config.maxParallel) {
        const queue = await plannerFetch<QueuedRun[]>('/api/runner/queue')
        const available = queue
          .filter((run) => run.status === 'queued' && !active.has(run.id))
          .slice(0, config.maxParallel - active.size)
        for (const run of available) {
          const promise = runOne(config, run.id, plannerFetch)
            .catch((error) => {
              console.error(`[supervisor] run ${run.id} failed:`, error)
            })
            .finally(() => active.delete(run.id))
          active.set(run.id, promise)
        }
      }
    } catch (error) {
      console.error('[supervisor] queue poll failed:', error)
    }
    await sleep(config.pollIntervalMs)
  }
}

async function runMergeCheck(config: SupervisorConfig): Promise<void> {
  const code = await spawnAndWait(
    config.runtime,
    buildMergeCheckContainerArgs(config),
    process.env,
  )
  if (code !== 0) {
    throw new Error(`merge-check container exited with code ${code}`)
  }
}

async function validateConfiguration(config: SupervisorConfig): Promise<void> {
  if (!config.plannerBaseUrl) throw new Error('PLANNER_BASE_URL is required.')
  if (
    process.env.SCM_PROVIDER === 'bitbucket_data_center' &&
    !process.env.BITBUCKET_BASE_URL
  ) {
    throw new Error('BITBUCKET_BASE_URL is required for Bitbucket Data Center.')
  }
  if (config.secretDir) {
    for (const file of ['scm_token', 'llm_api_key', 'runner_api_token']) {
      if (!readFileSync(join(config.secretDir, file), 'utf8').trim()) {
        throw new Error(`Secret file ${file} is empty.`)
      }
    }
  } else {
    if (
      !readSecret(process.env, 'SCM_TOKEN') &&
      !readSecret(process.env, 'GITHUB_TOKEN')
    ) {
      throw new Error('SCM_TOKEN is required.')
    }
    if (!readSecret(process.env, 'LLM_API_KEY')) {
      throw new Error('LLM_API_KEY is required.')
    }
  }
  await execFileAsync(config.runtime, ['info'], { timeout: 15_000 })
  await Promise.all(
    [config.runnerImage, config.openhandsImage].map((image) =>
      execFileAsync(config.runtime, ['image', 'inspect', image], {
        timeout: 15_000,
      }),
    ),
  )
  const plannerFetch = createPlannerFetch({
    baseUrl: config.plannerBaseUrl,
    token: config.runnerApiToken,
  })
  await plannerFetch('/api/runner/queue')
}

async function runOne(
  config: SupervisorConfig,
  runId: string,
  plannerFetch: ReturnType<typeof createPlannerFetch>,
): Promise<void> {
  const names = resourceNames(runId)
  console.log(`[supervisor] starting run ${runId}`)
  await execFileAsync(config.runtime, ['network', 'create', names.network])
  await execFileAsync(config.runtime, ['volume', 'create', names.volume])
  try {
    await execFileAsync(
      config.runtime,
      buildOpenHandsContainerArgs(config, names),
    )
    const code = await spawnAndWait(
      config.runtime,
      buildRunnerContainerArgs(config, names, runId),
      process.env,
    )
    if (code !== 0) {
      const run = await plannerFetch<{ status?: string }>(
        `/api/runner/runs/${runId}`,
      ).catch(() => null)
      if (run?.status === 'running') {
        await plannerFetch('/api/runner/update-run', {
          method: 'POST',
          body: JSON.stringify({
            runId,
            status: 'error',
            errorMessage: `On-premises runner container exited with code ${code}.`,
          }),
        })
      }
      throw new Error(`runner container exited with code ${code}`)
    }
    console.log(`[supervisor] completed run ${runId}`)
  } finally {
    await execFileAsync(config.runtime, [
      'rm',
      '--force',
      names.openhands,
    ]).catch(() => undefined)
    await execFileAsync(config.runtime, ['volume', 'rm', names.volume]).catch(
      () => undefined,
    )
    await execFileAsync(config.runtime, ['network', 'rm', names.network]).catch(
      () => undefined,
    )
  }
}

function spawnAndWait(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function selinuxLabel(value: string | undefined): '' | 'z' | 'Z' {
  const label = value?.trim() ?? ''
  if (label === '' || label === 'z' || label === 'Z') return label
  throw new Error('CONTAINER_SELINUX_LABEL must be empty, z, or Z.')
}

function bindMount(
  source: string,
  target: string,
  readOnly: boolean,
  selinux: '' | 'z' | 'Z',
): string {
  const options = [readOnly ? 'ro' : '', selinux].filter(Boolean)
  return `${source}:${target}${options.length ? `:${options.join(',')}` : ''}`
}

function readSecret(env: NodeJS.ProcessEnv, name: string): string {
  const path = env[`${name}_FILE`]?.trim()
  if (path) return readFileSync(path, 'utf8').trim()
  const direct = env[name]?.trim()
  if (direct) return direct
  const secretDir = env.ONPREM_SECRET_DIR?.trim()
  if (secretDir && name === 'RUNNER_API_TOKEN') {
    return readFileSync(join(secretDir, 'runner_api_token'), 'utf8').trim()
  }
  return ''
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

if (process.argv[1]?.endsWith('onprem-supervisor.js')) {
  main().catch((error) => {
    console.error('[supervisor] fatal:', error)
    process.exitCode = 1
  })
}
