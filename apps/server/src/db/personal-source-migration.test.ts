import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { expect, it } from 'vitest'

import { runDatabaseMigrations } from './client'
import { reconcilePersonalSourceMigration } from './personal-source-migration'
import * as schema from './schema'

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))
const sourceWhen = 1793600000000
const detailWhen = 1793700000000
const sourceHashes = ['9f6cd81b3863910447e42fb6541cec2a4354ae181236e38ea0d7d42ec4ed8f9a', '640bdaf23319e66171e865ec7fd9cac779059a5abfbc9712d3e181635e6524eb']
const detailHashes = ['d642c610ceda342693fb9abc13818f9b8f4a45e8ada4314e8e886b2b6df67d35', '30cc279ead94416a2c55cf04db27c5e9ea4d1b8800559d4fdec2a9d6cc1d6c11']

it('creates a fresh database with the consolidated migration and repeats safely', async () => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    await runDatabaseMigrations(db)
    const columns = sqlite.prepare('PRAGMA table_info(personal_metadata_sources)').all() as Array<{ name: string; dflt_value: string }>
    expect(columns.find((column) => column.name === 'has_detail')?.dflt_value).toBe('1')
    const ledger = sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()
    await runDatabaseMigrations(db)
    expect(sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()).toEqual(ledger)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally { sqlite.close() }
})

it.each([0, 1, 2, 3])('preserves installed sources from historical state %i', async (state) => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    await runDatabaseMigrations(db)
    const hasDetail = state >= 2
    if (!hasDetail) sqlite.exec('ALTER TABLE personal_metadata_sources DROP COLUMN has_detail')
    sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at >= ?').run(sourceWhen)
    sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(sourceHashes[state % 2], sourceWhen)
    if (hasDetail) sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(detailHashes[state % 2], detailWhen)
    sqlite.exec("INSERT INTO users (id, username, created_at) VALUES ('source-owner', 'source-owner', 1)")
    sqlite.exec(`INSERT INTO personal_metadata_sources (id, user_id, source_id, name, version, api_version, origin_type, entry_path, created_at, updated_at)
      VALUES ('source-row', 'source-owner', 'example', 'Example', '1.0.0', 1, 'zip', 'index.js', 1, 1)`)
    if (hasDetail) sqlite.exec('UPDATE personal_metadata_sources SET has_detail = 0')
    const before = sqlite.prepare('SELECT id, user_id, source_id, name, version, origin_type, entry_path, created_at FROM personal_metadata_sources').all()
    await runDatabaseMigrations(db)
    await runDatabaseMigrations(db)
    expect(sqlite.prepare('SELECT id, user_id, source_id, name, version, origin_type, entry_path, created_at FROM personal_metadata_sources').all()).toEqual(before)
    expect(sqlite.prepare('SELECT has_detail FROM personal_metadata_sources').get()).toEqual({ has_detail: hasDetail ? 0 : 1 })
    const migration = readMigrationFiles({ migrationsFolder }).find((entry) => entry.folderMillis === sourceWhen)!
    expect(sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations WHERE created_at >= ?').all(sourceWhen))
      .toEqual([{ hash: migration.hash, created_at: sourceWhen }])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally { sqlite.close() }
})

it('rejects unknown history without modifying the ledger or installed sources', async () => {
  const sqlite = new Database(':memory:')
  try {
    const db = drizzle(sqlite, { schema })
    await runDatabaseMigrations(db)
    sqlite.prepare('UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?').run('unknown', sourceWhen)
    const before = sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all()
    expect(() => reconcilePersonalSourceMigration(db, migrationsFolder)).toThrow('Unrecognized personal source migration history')
    expect(sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all()).toEqual(before)
  } finally { sqlite.close() }
})

it('accepts consolidated history across checkout line endings', async () => {
  const sqlite = new Database(':memory:')
  try {
    const db = drizzle(sqlite, { schema })
    await runDatabaseMigrations(db)
    const source = readFileSync(new URL('./migrations/0058_personal_metadata_sources.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const hash = createHash('sha256').update(source.replace(/\n/g, '\r\n')).digest('hex')
    sqlite.prepare('UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?').run(hash, sourceWhen)
    await runDatabaseMigrations(db)
    expect(sqlite.prepare('SELECT hash FROM __drizzle_migrations WHERE created_at = ?').get(sourceWhen)).toEqual({ hash })
  } finally { sqlite.close() }
})
