import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'

// Run after build:internal. This starts the actual production entry point.
test('production server enforces proxy identity, CSRF, machine token and persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planner-http-'))
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const token = 'internal-test-machine-token-32-characters'
  let child
  async function start() {
    child = spawn(process.execPath, ['deploy/node/server.mjs'], {
      env: {
        ...process.env,
        AUTH_MODE: 'oauth2_proxy',
        APP_ORIGIN: origin,
        PORT: String(port),
        RUNNER_API_TOKEN: token,
        PLANNER_DATA_DIR: dir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let logs = ''
    child.stdout.on('data', (b) => {
      logs += b
    })
    child.stderr.on('data', (b) => {
      logs += b
    })
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(logs)
      try {
        if ((await fetch(`${origin}/health/ready`)).ok) return
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Server startup timed out: ${logs}`)
  }
  async function stop() {
    if (!child || child.exitCode !== null) return
    const done = once(child, 'exit')
    child.kill('SIGTERM')
    await done
  }
  try {
    await start()
    assert.equal((await fetch(`${origin}/dashboard`)).status, 401)
    assert.equal(
      (
        await fetch(`${origin}/dashboard`, {
          headers: { 'x-forwarded-email': 'bad,identity@example.com' },
        })
      ).status,
      401,
    )
    const headers = { 'x-forwarded-email': 'test@example.com' }
    const response = await fetch(`${origin}/dashboard`, { headers })
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Planner/)
    assert.equal(
      (await fetch(`${origin}/api/auth/local-proof`, { headers })).status,
      404,
    )
    assert.equal(
      (await fetch(`${origin}/api/runner/queue`, { headers })).status,
      401,
    )
    const queue = await fetch(`${origin}/api/runner/queue`, {
      headers: { 'x-runner-token': token },
    })
    assert.equal(queue.status, 200)
    assert.deepEqual(await queue.json(), [])
    assert.equal(
      (await fetch(`${origin}/api/anything`, { method: 'POST', headers }))
        .status,
      403,
    )
    assert.equal(
      (
        await fetch(`${origin}/api/anything`, {
          method: 'POST',
          headers: { ...headers, origin: 'https://evil.example.com' },
        })
      ).status,
      403,
    )
    const { DatabaseSync } = await import('node:sqlite')
    let db = new DatabaseSync(join(dir, 'planner.sqlite'))
    const user = db.prepare('SELECT id, email FROM users').get()
    assert.equal(user.email, 'test@example.com')
    db.close()
    await stop()
    await start()
    assert.equal((await fetch(`${origin}/dashboard`, { headers })).status, 200)
    db = new DatabaseSync(join(dir, 'planner.sqlite'))
    assert.equal(db.prepare('SELECT id FROM users').get().id, user.id)
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1)
    db.close()
  } finally {
    await stop()
    await rm(dir, { recursive: true, force: true })
  }
})
