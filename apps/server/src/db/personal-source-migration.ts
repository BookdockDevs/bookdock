import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type * as schema from './schema'

const SOURCE_MIGRATION_WHEN = 1793600000000
const DETAIL_MIGRATION_WHEN = 1793700000000
// Both line endings occurred in the unreleased development migrations.
const sourceHashes = new Set([
  '9f6cd81b3863910447e42fb6541cec2a4354ae181236e38ea0d7d42ec4ed8f9a',
  '640bdaf23319e66171e865ec7fd9cac779059a5abfbc9712d3e181635e6524eb',
])
const detailHashes = new Set([
  'd642c610ceda342693fb9abc13818f9b8f4a45e8ada4314e8e886b2b6df67d35',
  '30cc279ead94416a2c55cf04db27c5e9ea4d1b8800559d4fdec2a9d6cc1d6c11',
])

export function reconcilePersonalSourceMigration(
  db: ReturnType<typeof drizzle<typeof schema>>,
  migrationsFolder: string,
) {
  const migrations = readMigrationFiles({ migrationsFolder })
  const migration = migrations.find((entry) => entry.folderMillis === SOURCE_MIGRATION_WHEN)
  if (!migration) throw new Error('Consolidated personal source migration is missing')
  const records = db.all<{ hash: string; createdAt: number }>(sql`
    SELECT hash, created_at AS "createdAt" FROM __drizzle_migrations
    WHERE created_at >= ${SOURCE_MIGRATION_WHEN} ORDER BY created_at
  `)
  if (!records.length) return
  const source = readFileSync(path.join(migrationsFolder, '0058_personal_metadata_sources.sql'), 'utf8').replace(/\r\n/g, '\n')
  const consolidatedHashes = new Set([source, source.replace(/\n/g, '\r\n')]
    .map((text) => createHash('sha256').update(text).digest('hex')))
  if (Number(records[0].createdAt) === SOURCE_MIGRATION_WHEN && consolidatedHashes.has(records[0].hash)) return
  if (records.length > 2
    || Number(records[0].createdAt) !== SOURCE_MIGRATION_WHEN
    || !sourceHashes.has(records[0].hash)
    || (records[1] && (Number(records[1].createdAt) !== DETAIL_MIGRATION_WHEN || !detailHashes.has(records[1].hash)))) {
    throw new Error('Unrecognized personal source migration history; refusing to rewrite the ledger')
  }

  db.transaction((tx) => {
    const columns = tx.all<{ name: string }>(sql`PRAGMA table_info(personal_metadata_sources)`)
    if (!columns.length) throw new Error('Personal source migration is recorded but its table is missing')
    if (!columns.some((column) => column.name === 'has_detail')) {
      if (records.length === 2) throw new Error('Personal source detail migration is recorded but its column is missing')
      tx.run(sql`ALTER TABLE personal_metadata_sources ADD COLUMN has_detail INTEGER NOT NULL DEFAULT 1`)
    }
    for (const record of records) {
      tx.run(sql`DELETE FROM __drizzle_migrations WHERE hash = ${record.hash} AND created_at = ${record.createdAt}`)
    }
    tx.run(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`)
  })
}
