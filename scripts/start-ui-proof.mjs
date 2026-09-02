import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const statePath = mkdtempSync(join(tmpdir(), 'planner-ui-proof-'))
let cleaned = false

function cleanup() {
  if (cleaned) return
  cleaned = true
  rmSync(statePath, { force: true, recursive: true })
}

function run(args) {
  const result = spawnSync(pnpm, args, {
    env: { ...process.env, CI: '1' },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    cleanup()
    process.exit(result.status ?? 1)
  }
}

run([
  'wrangler',
  'd1',
  'migrations',
  'apply',
  'planner',
  '--local',
  '--persist-to',
  statePath,
])
run([
  'wrangler',
  'd1',
  'execute',
  'planner',
  '--local',
  '--persist-to',
  statePath,
  '--file=drizzle/seed.sql',
])

console.log('\nLocal UI proof environment is ready.')
console.log('Open http://127.0.0.1:3000/api/auth/local-proof')
console.log('Select "Open proof dashboard" to use local test data.\n')

const vite = spawn(
  pnpm,
  ['exec', 'vite', 'dev', '--port', '3000', '--host', '127.0.0.1'],
  {
    env: { ...process.env, PLANNER_UI_PROOF_STATE: statePath },
    stdio: 'inherit',
  },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => vite.kill(signal))
}

vite.on('exit', (code, signal) => {
  cleanup()
  process.exitCode = signal ? 0 : (code ?? 1)
})
