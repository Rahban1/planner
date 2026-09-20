import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase, fileBucket } from '../../deploy/node/storage.mjs'
import { drizzle } from 'drizzle-orm/d1'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

test('migrations, Drizzle row ordering, transactional rollback, and restart persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planner-storage-'))
  let db
  try {
    db = openDatabase(join(dir, 'db.sqlite'), resolve('drizzle/migrations'))
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
    assert.ok(tables.results.some((r) => r.name === 'task_messages'))
    const users = sqliteTable('users', {
      id: text('id'),
      email: text('email'),
      provider: text('provider'),
    })
    await db
      .prepare(
        'INSERT INTO users (id, email, provider, provider_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind('one', 'one@example.com', 'oauth2_proxy', 'one', 1, 1)
      .run()
    assert.deepEqual(
      await drizzle(db)
        .select({ email: users.email, id: users.id })
        .from(users),
      [{ email: 'one@example.com', id: 'one' }],
    )
    await assert.rejects(
      db.batch([
        db.prepare(
          "UPDATE users SET email = 'changed@example.com' WHERE id = 'one'",
        ),
        db.prepare("INSERT INTO users (id) VALUES ('one')"),
      ]),
    )
    assert.equal(
      await db
        .prepare("SELECT email FROM users WHERE id = 'one'")
        .first('email'),
      'one@example.com',
    )
    db.close()
    db = openDatabase(join(dir, 'db.sqlite'), resolve('drizzle/migrations'))
    assert.equal(
      await db.prepare('SELECT count(*) AS count FROM users').first('count'),
      1,
    )
  } finally {
    db?.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('migration checksum prevents a changed migration from starting the app', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planner-migrations-'))
  try {
    await mkdir(join(dir, 'sql'))
    const file = join(dir, 'sql', '001.sql')
    await writeFile(file, 'CREATE TABLE sample(id INTEGER)')
    openDatabase(join(dir, 'db.sqlite'), join(dir, 'sql')).close()
    await writeFile(file, 'CREATE TABLE sample(id TEXT)')
    assert.throws(
      () => openDatabase(join(dir, 'db.sqlite'), join(dir, 'sql')),
      /Migration changed/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('attachments persist and reject traversal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'planner-files-'))
  try {
    const bucket = fileBucket(dir)
    await bucket.put(
      'attachments/test-id',
      new TextEncoder().encode('persistent file').buffer,
    )
    const result = await fileBucket(dir).get('attachments/test-id')
    assert.equal(await new Response(result.body).text(), 'persistent file')
    assert.equal(result.size, 15)
    await assert.rejects(bucket.get('attachments/../../secret'), /Invalid/)
    await assert.rejects(
      bucket.put('/tmp/escape', new ArrayBuffer(0)),
      /Invalid/,
    )
    await bucket.delete('attachments/test-id')
    assert.equal(await bucket.get('attachments/test-id'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
