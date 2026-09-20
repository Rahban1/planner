import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

// This adapter implements the D1 methods that the app and Drizzle use.
// All batch statements execute synchronously inside one SQLite transaction.
export function openDatabase(filename, migrationDirectory) {
  mkdirSync(dirname(resolve(filename)), { recursive: true })
  const sqlite = new DatabaseSync(filename)
  sqlite.exec(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
  )
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS planner_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)',
  )
  for (const name of readdirSync(migrationDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(migrationDirectory, name), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const applied = sqlite
      .prepare('SELECT checksum FROM planner_migrations WHERE name = ?')
      .get(name)
    if (applied) {
      if (applied.checksum !== checksum) {
        sqlite.close()
        throw new Error(`Migration changed: ${name}`)
      }
      continue
    }
    sqlite.exec('BEGIN IMMEDIATE')
    try {
      sqlite.exec(sql)
      sqlite
        .prepare('INSERT INTO planner_migrations VALUES (?, ?)')
        .run(name, checksum)
      sqlite.exec('COMMIT')
    } catch (error) {
      sqlite.exec('ROLLBACK')
      sqlite.close()
      throw error
    }
  }
  function prepare(sql, params = []) {
    const execute = (arrays = false) => {
      const statement = sqlite.prepare(sql)
      if (arrays) statement.setReturnArrays(true)
      const rows = statement.all(...params)
      const stats = sqlite
        .prepare(
          'SELECT changes() AS changes, last_insert_rowid() AS last_row_id',
        )
        .get()
      return { success: true, results: rows, meta: { ...stats, duration: 0 } }
    }
    return {
      bind: (...values) => prepare(sql, values),
      all: async () => execute(),
      run: async () => execute(),
      raw: async () => execute(true).results,
      first: async (column) => {
        const row = execute().results[0]
        return row ? (column ? row[column] : row) : null
      },
      execute,
    }
  }
  return {
    prepare,
    batch: async (statements) => {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map((statement) => statement.execute())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    close: () => sqlite.close(),
  }
}

export function fileBucket(directory) {
  const root = resolve(directory)
  mkdirSync(root, { recursive: true })
  function path(key) {
    if (!/^attachments\/[a-zA-Z0-9_-]+$/.test(key))
      throw new Error('Invalid attachment key')
    return join(root, key)
  }
  return {
    async put(key, bytes) {
      const target = path(key)
      await mkdir(dirname(target), { recursive: true })
      const temporary = `${target}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, new Uint8Array(bytes), { mode: 0o600 })
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true })
      }
    },
    async get(key) {
      try {
        const data = await readFile(path(key))
        return {
          body: new Blob([data]).stream(),
          size: data.length,
          httpMetadata: {},
        }
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async delete(key) {
      await rm(path(key), { force: true })
    },
  }
}
