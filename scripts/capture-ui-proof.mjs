import { mkdtempSync, rmSync, mkdirSync, renameSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const runId = process.argv[2]
if (!runId) {
  console.error('Usage: node scripts/capture-ui-proof.mjs <run-id>')
  process.exit(1)
}

const proofDir = join(process.cwd(), '.planner', 'proof', runId)
const screenshotDir = join(proofDir, 'screenshots')
const videoDir = join(proofDir, 'video')
const logsDir = join(proofDir, 'logs')
mkdirSync(screenshotDir, { recursive: true })
mkdirSync(videoDir, { recursive: true })
mkdirSync(logsDir, { recursive: true })

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const statePath = mkdtempSync(join(tmpdir(), 'planner-ui-proof-'))
let cleaned = false
let viteProcess = null

function cleanup() {
  if (cleaned) return
  cleaned = true
  if (viteProcess) {
    viteProcess.kill('SIGTERM')
    viteProcess = null
  }
  try {
    rmSync(statePath, { force: true, recursive: true })
  } catch {
    // ignore
  }
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

async function waitForReady(url, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.status === 200) return true
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`)
}

async function main() {
  console.log('Applying D1 migrations...')
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

  console.log('Seeding test data...')
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

  console.log('Starting Vite dev server...')
  viteProcess = spawn(
    pnpm,
    ['exec', 'vite', 'dev', '--port', '3000', '--host', '127.0.0.1'],
    {
      env: { ...process.env, PLANNER_UI_PROOF_STATE: statePath },
      stdio: 'inherit',
    },
  )

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      cleanup()
      process.exit(0)
    })
  }

  const readyUrl = 'http://127.0.0.1:3000/api/auth/local-proof'
  console.log(`Waiting for ${readyUrl} to be ready...`)
  await waitForReady(readyUrl)
  console.log('Server is ready.')

  console.log('Launching Playwright Chromium...')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  })
  const page = await context.newPage()

  console.log('Navigating to local proof page...')
  await page.goto('http://127.0.0.1:3000/api/auth/local-proof')

  console.log('Clicking Open proof dashboard...')
  await page.click('button[type="submit"]')
  await page.waitForLoadState('networkidle')

  console.log('Capturing desktop screenshot...')
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.screenshot({
    path: join(screenshotDir, 'desktop.png'),
    fullPage: false,
  })

  console.log('Capturing mobile screenshot...')
  await page.setViewportSize({ width: 375, height: 667 })
  await page.screenshot({
    path: join(screenshotDir, 'mobile.png'),
    fullPage: false,
  })

  await context.close()
  await browser.close()

  const webmFiles = readdirSync(videoDir).filter((f) => f.endsWith('.webm'))
  if (webmFiles.length === 1) {
    renameSync(
      join(videoDir, webmFiles[0]),
      join(videoDir, 'ui-flow.webm'),
    )
    console.log('Video saved to video/ui-flow.webm')
  } else if (webmFiles.length === 0) {
    console.error('No WebM video file was produced.')
    process.exitCode = 1
  } else {
    console.error('Multiple WebM files found; expected exactly one.')
    process.exitCode = 1
  }

  console.log('UI proof capture complete.')
  console.log(`  Screenshots: ${screenshotDir}`)
  console.log(`  Video:       ${videoDir}`)
}

try {
  await main()
} catch (err) {
  console.error(err)
  process.exitCode = 1
} finally {
  cleanup()
}
