import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type * as schema from './schema'

// Both LF and CRLF hashes occurred in the unreleased Windows development files.
const historicalSteps = [
  { when: 1793500000000, statements: 4, hashes: ['edf7648dbc6c70621b84e84f1073ab3d5dd2f3858cca7ea13161a41c02ed46fe', '45dd3535e9a8612863bbba0b94b4a30c8ff499c70415e88d5756490e1a1fb41b'] },
  { when: 1793600000000, statements: 1, hashes: ['bfe0b310f31817af7027571e6779ea07b19b9b3a496a2be2fd51786f66d37c1f', '274aa1235c8342d042099d43fa87d32897e476cdcbbceb47830e3a01e43446d3'] },
  { when: 1793700000000, statements: 3, hashes: ['c870167cc445b5b6a8882af2058cfd9529c0f2fc44e24bb5cddfe4f7070b7297'] },
  { when: 1793800000000, statements: 2, hashes: ['3acd59c326e8c85e366eee576716e98e92c744e4df4d69f29143b5f7511de5ae'] },
  { when: 1793900000000, statements: 1, hashes: ['020efbb2fe1d20003eb96625828dd2bfedaa83351ffc4dc22be4d552c9c5d134'] },
  { when: 1794000000000, statements: 2, hashes: ['7ee188f0416570facfa9da096b2e76d00273537e7a9ceb127ff5337690a84fa9'] },
]

export function reconcileContentEditorMigration(
  db: ReturnType<typeof drizzle<typeof schema>>,
  migrationsFolder: string,
) {
  const migration = readMigrationFiles({ migrationsFolder })
    .find((entry) => entry.folderMillis === historicalSteps[0].when)
  if (!migration) throw new Error('Consolidated content editor migration is missing')
  const records = db.all<{ hash: string; createdAt: number }>(sql`
    SELECT hash, created_at AS "createdAt" FROM __drizzle_migrations
    WHERE created_at >= ${historicalSteps[0].when} ORDER BY created_at
  `)
  if (!records.length) return
  const source = readFileSync(path.join(migrationsFolder, '0057_content_editor.sql'), 'utf8').replace(/\r\n/g, '\n')
  const consolidatedHashes = [source, source.replace(/\n/g, '\r\n')]
    .map((text) => createHash('sha256').update(text).digest('hex'))
  if (Number(records[0].createdAt) === migration.folderMillis && consolidatedHashes.includes(records[0].hash)) return
  if (records.length > historicalSteps.length || records.some((record, index) => {
    const step = historicalSteps[index]
    return Number(record.createdAt) !== step.when || !step.hashes.includes(record.hash)
  })) {
    throw new Error('Unrecognized content editor migration history; refusing to rewrite the ledger')
  }

  // Keep SQL statement order fixed so a known partial development upgrade can
  // finish without rerunning CREATE/ALTER against columns it already has.
  const statements = migration.sql.filter((statement) => statement.trim())
  const total = historicalSteps.reduce((count, step) => count + step.statements, 0)
  if (statements.length !== total) throw new Error('Content editor migration statement boundaries changed')
  const completed = historicalSteps.slice(0, records.length).reduce((count, step) => count + step.statements, 0)
  db.transaction((tx) => {
    for (const statement of statements.slice(completed)) tx.run(sql.raw(statement))
    tx.all(sql`SELECT source_sections, target_sections, structural_ranges FROM content_revision_maps LIMIT 0`)
    tx.all(sql`SELECT progress_revision_id, coverage_revision_id FROM book_states LIMIT 0`)
    for (const table of ['bookmarks', 'ideas', 'text_replacements']) {
      tx.all(sql.raw(`SELECT relocation FROM ${table} LIMIT 0`))
    }
    for (const record of records) {
      tx.run(sql`DELETE FROM __drizzle_migrations WHERE hash = ${record.hash} AND created_at = ${record.createdAt}`)
    }
    tx.run(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`)
  })
}
