import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
const baselineFile = path.join(migrationsDir, '0000_baseline.sql')
const releaseMigrationFile = path.join(migrationsDir, '0001_release_0_2_1.sql')

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
