import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { expect, it } from 'vitest'

import { retargetBookIdReferences } from './client'
import { reconcileContentEditorMigration } from './content-editor-migration'
import { migrateBeforeBookRetirement, migrateWithTagFilter } from './migration-stage'
import * as schema from './schema'

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))
const oldHashes = [
  'edf7648dbc6c70621b84e84f1073ab3d5dd2f3858cca7ea13161a41c02ed46fe',
  'bfe0b310f31817af7027571e6779ea07b19b9b3a496a2be2fd51786f66d37c1f',
  'c870167cc445b5b6a8882af2058cfd9529c0f2fc44e24bb5cddfe4f7070b7297',
  '3acd59c326e8c85e366eee576716e98e92c744e4df4d69f29143b5f7511de5ae',
  '020efbb2fe1d20003eb96625828dd2bfedaa83351ffc4dc22be4d552c9c5d134',
  '7ee188f0416570facfa9da096b2e76d00273537e7a9ceb127ff5337690a84fa9',
]
const stepSizes = [4, 1, 3, 2, 1, 2]

function beforeEditor() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrateBeforeBookRetirement(db, { migrationsFolder })
  retargetBookIdReferences(db)
  migrateWithTagFilter(db, { migrationsFolder }, ({ tag }) => tag < '0057_content_editor')
  return { sqlite, db }
}

it.each([0, 1, 2, 3, 4, 5, 6])('preserves data and repeats safely after %i historical development migrations', (steps) => {
  const { sqlite, db } = beforeEditor()
  try {
    const migration = readMigrationFiles({ migrationsFolder }).find((entry) => entry.folderMillis === 1793500000000)!
    const statements = migration.sql.filter((statement) => statement.trim())
    let offset = 0
    for (let index = 0; index < steps; index++) {
      for (const statement of statements.slice(offset, offset + stepSizes[index])) sqlite.exec(statement)
      offset += stepSizes[index]
      sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(oldHashes[index], 1793500000000 + index * 100000000)
    }
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u-old', 'old', 1);
      INSERT INTO book_versions (id, format, size, created_at, updated_at) VALUES ('bv-old', 'txt', 1, 1, 1);
      INSERT INTO content_revisions (id, book_version_id, revision_no, blob_key, size, created_at) VALUES ('rev-old', 'bv-old', 1, 'blob', 1, 1);
      INSERT INTO book_states (user_id, book_version_id, percent, progress_data, updated_at)
        VALUES ('u-old', 'bv-old', 25, '{"progressRevisionId":"rev-old","intervals":[[0,0.25]]}', 1);
    `)
    if (steps >= 2) sqlite.exec("UPDATE book_states SET progress_revision_id = 'rev-old'")
    if (steps >= 4) sqlite.exec("UPDATE book_states SET coverage_revision_id = 'rev-old'")
    if (steps >= 1) sqlite.exec(`
      INSERT INTO content_revision_maps (id, book_version_id, source_revision_id, target_revision_id, segments, created_at)
        VALUES ('map-old', 'bv-old', 'source', 'rev-old', '[]', 1);
    `)
    reconcileContentEditorMigration(db, migrationsFolder)
    migrate(db, { migrationsFolder })
    const ledger = sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()
    reconcileContentEditorMigration(db, migrationsFolder)
    migrate(db, { migrationsFolder })
    expect(sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()).toEqual(ledger)
    expect(sqlite.prepare('SELECT percent, coverage_revision_id FROM book_states').get())
      .toEqual({ percent: 25, coverage_revision_id: 'rev-old' })
    if (steps >= 1) expect(sqlite.prepare('SELECT target_sections, source_sections, structural_ranges FROM content_revision_maps').get())
      .toEqual({ target_sections: '[]', source_sections: '[]', structural_ranges: '[]' })
    expect(sqlite.prepare('SELECT hash FROM __drizzle_migrations WHERE created_at = 1793500000000').all())
      .toEqual([{ hash: migration.hash }])
    for (const table of ['bookmarks', 'ideas', 'text_replacements']) {
      const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; dflt_value: string }>
      expect(columns.find((column) => column.name === 'relocation')?.dflt_value).toBe("'ok'")
    }
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    sqlite.close()
  }
})

it('rejects unknown history without changing schema or ledger', () => {
  const { sqlite, db } = beforeEditor()
  try {
    sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('unknown', 1793500000000)
    expect(() => reconcileContentEditorMigration(db, migrationsFolder)).toThrow('Unrecognized content editor migration history')
    expect(sqlite.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get()).toEqual({ hash: 'unknown' })
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'content_revision_maps'").get()).toBeUndefined()
  } finally {
    sqlite.close()
  }
})

it('rolls back schema additions and preserves the ledger when completion fails', () => {
  const { sqlite, db } = beforeEditor()
  try {
    const migration = readMigrationFiles({ migrationsFolder }).find((entry) => entry.folderMillis === 1793500000000)!
    for (const statement of migration.sql.filter((statement) => statement.trim()).slice(0, 4)) sqlite.exec(statement)
    sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(oldHashes[0], 1793500000000)
    sqlite.exec('DROP TABLE ideas')
    expect(() => reconcileContentEditorMigration(db, migrationsFolder)).toThrow()
    const columns = sqlite.prepare('PRAGMA table_info(book_states)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).not.toContain('progress_revision_id')
    expect(sqlite.prepare('SELECT hash FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get()).toEqual({ hash: oldHashes[0] })
  } finally {
    sqlite.close()
  }
})

it('accepts a consolidated ledger recorded with different checkout line endings', () => {
  const { sqlite, db } = beforeEditor()
  try {
    migrate(db, { migrationsFolder })
    const source = readFileSync(new URL('./migrations/0057_content_editor.sql', import.meta.url), 'utf8')
      .replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
    const hash = createHash('sha256').update(source).digest('hex')
    sqlite.prepare('UPDATE __drizzle_migrations SET hash = ? WHERE created_at = 1793500000000').run(hash)
    expect(() => reconcileContentEditorMigration(db, migrationsFolder)).not.toThrow()
    expect(sqlite.prepare('SELECT hash FROM __drizzle_migrations WHERE created_at = 1793500000000').get()).toEqual({ hash })
  } finally {
    sqlite.close()
  }
})
