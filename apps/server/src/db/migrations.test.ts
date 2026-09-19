import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { describe, expect, it } from 'vitest'

import * as schema from './schema'
import { reconcileConsolidatedMigrationLedger, repairLegacyTextReplacementSchema } from './client'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
const baselineFile = path.join(migrationsDir, '0000_baseline.sql')
const releaseMigrationFile = path.join(migrationsDir, '0001_release_0_2_1.sql')
const replacementMigrationFile = path.join(migrationsDir, '0002_text_replacements.sql')
const replacementScopeMigrationFile = path.join(migrationsDir, '0003_text_replacement_scope.sql')
const legadoAccessKeyMigrationFile = path.join(migrationsDir, '0004_legado_access_keys.sql')

function applyBaseline(sqlite: Database.Database) {
  const sql = fs.readFileSync(baselineFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyReleaseMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(releaseMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyReplacementMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(replacementMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyReplacementScopeMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(replacementScopeMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyLegadoAccessKeyMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(legadoAccessKeyMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

describe('database baseline', () => {
  it('creates the current schema without removed tables', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    applyBaseline(sqlite)

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
    const tableNames = tables.map((table) => table.name)

    expect(tableNames).toEqual(expect.arrayContaining([
      'users',
      'books',
      'settings',
      'annotations',
      'tts_services',
      'ai_threads',
      'ai_messages',
      'ai_chunks',
      'ai_chunks_fts',
    ]))
    expect(tableNames).not.toEqual(expect.arrayContaining(['book_shelves', 'reading_progress', 'tts_configs']))

    sqlite.close()
  })

  it('keeps the lexical index synchronized through its triggers', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyBaseline(sqlite)

    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1);
      INSERT INTO ai_book_indexes (id, user_id, book_id, source_version, status, created_at, updated_at)
        VALUES ('i1', 'u1', 'b1', 'v1', 'ready', 1, 1);
      INSERT INTO ai_chunks (id, user_id, index_id, book_id, chapter_index, chapter_id, chapter_title, start_offset, end_offset, text, created_at)
        VALUES ('c1', 'u1', 'i1', 'b1', 0, 'ch1', 'Chapter 1', 0, 10, 'first text', 1);
    `)
    expect(sqlite.prepare('SELECT text FROM ai_chunks_fts WHERE chunk_id = ?').get('c1')).toEqual({ text: 'first text' })

    sqlite.exec("UPDATE ai_chunks SET text = 'updated text' WHERE id = 'c1'")
    expect(sqlite.prepare('SELECT text FROM ai_chunks_fts WHERE chunk_id = ?').get('c1')).toEqual({ text: 'updated text' })

    sqlite.exec("DELETE FROM ai_chunks WHERE id = 'c1'")
    expect(sqlite.prepare('SELECT text FROM ai_chunks_fts WHERE chunk_id = ?').all('c1')).toHaveLength(0)

    sqlite.close()
  })
})

describe('database release migration', () => {
  it('upgrades the v0.2.0 baseline in one forward migration', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    applyBaseline(sqlite)
    applyReleaseMigration(sqlite)

    const tagColumns = sqlite.prepare('PRAGMA table_info(tags)').all() as { name: string }[]
    const tocRuleColumns = sqlite.prepare('PRAGMA table_info(toc_rules)').all() as { name: string }[]
    const tocRuleIndexes = sqlite.prepare('PRAGMA index_list(toc_rules)').all() as { name: string }[]

    expect(tagColumns.map((column) => column.name)).toContain('sort_order')
    expect(tocRuleColumns.map((column) => column.name)).toContain('seed_key')
    expect(tocRuleIndexes.map((index) => index.name)).toContain('toc_rules_user_seed_key_unique')

    sqlite.close()
  })
})

describe('text replacement migration', () => {
  it('renames replacement tables and preserves existing rules and overrides', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    applyBaseline(sqlite)
    applyReleaseMigration(sqlite)
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1);
      INSERT INTO text_transforms (id, user_id, pattern, replacement, created_at, updated_at)
        VALUES ('r1', 'u1', 'old', 'new', 1, 1);
      INSERT INTO text_transform_overrides (id, user_id, book_id, transform_id, enabled, created_at, updated_at)
        VALUES ('o1', 'u1', 'b1', 'r1', 0, 1, 1);
    `)

    applyReplacementMigration(sqlite)
    applyReplacementScopeMigration(sqlite)

    expect(sqlite.prepare('SELECT pattern, replacement FROM text_replacements WHERE id = ?').get('r1'))
      .toEqual({ pattern: 'old', replacement: 'new' })
    expect(sqlite.prepare('PRAGMA table_info(text_replacements)').all())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'apply_to' }),
      ]))
    expect(sqlite.prepare('SELECT replacement_id, enabled FROM text_replacement_overrides WHERE id = ?').get('o1'))
      .toEqual({ replacement_id: 'r1', enabled: 0 })
    expect(sqlite.prepare('PRAGMA index_list(text_replacement_overrides)').all())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'text_replacement_overrides_book_replacement_unique' }),
        expect.objectContaining({ name: 'text_replacement_overrides_user_book_idx' }),
      ]))

    sqlite.close()
  })

  it('repairs legacy replacement tables when the migration ledger is ahead', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    applyBaseline(sqlite)
    applyReleaseMigration(sqlite)
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1);
      INSERT INTO text_transforms (id, user_id, pattern, replacement, created_at, updated_at)
        VALUES ('r1', 'u1', 'old', 'new', 1, 1);
      INSERT INTO text_transform_overrides (id, user_id, book_id, transform_id, enabled, created_at, updated_at)
        VALUES ('o1', 'u1', 'b1', 'r1', 0, 1, 1);
    `)

    applyReplacementMigration(sqlite)
    applyReplacementScopeMigration(sqlite)
    applyLegadoAccessKeyMigration(sqlite)
    sqlite.exec(`
      CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC);
      INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future-development-migration', 9999999999999);
    `)

    const db = drizzle(sqlite, { schema })
    repairLegacyTextReplacementSchema(db)
    reconcileConsolidatedMigrationLedger(db, migrationsDir)

    expect(sqlite.prepare('SELECT pattern, replacement FROM text_replacements WHERE id = ?').get('r1'))
      .toEqual({ pattern: 'old', replacement: 'new' })
    expect(sqlite.prepare('SELECT replacement_id, enabled FROM text_replacement_overrides WHERE id = ?').get('o1'))
      .toEqual({ replacement_id: 'r1', enabled: 0 })
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get())
      .toEqual({ count: 5 })

    sqlite.close()
  })
})
