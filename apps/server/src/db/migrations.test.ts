import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'

import * as schema from './schema'
import { reconcileConsolidatedMigrationLedger, repairLegacyTextReplacementSchema, repairLibraryBooksDeletedAt, retargetBookIdReferences } from './client'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')
const baselineFile = path.join(migrationsDir, '0000_baseline.sql')
const releaseMigrationFile = path.join(migrationsDir, '0001_release_0_2_1.sql')
const replacementMigrationFile = path.join(migrationsDir, '0002_text_replacements.sql')
const replacementScopeMigrationFile = path.join(migrationsDir, '0003_text_replacement_scope.sql')
const legadoAccessKeyMigrationFile = path.join(migrationsDir, '0004_legado_access_keys.sql')
const accessTokenMigrationFile = path.join(migrationsDir, '0005_access_tokens.sql')
const annotationChapterHrefMigrationFile = path.join(migrationsDir, '0006_annotation_chapter_href.sql')
const librarySortTimestampsMigrationFile = path.join(migrationsDir, '0007_library_sort_timestamps.sql')
const libraryFoundationMigrationFile = path.join(migrationsDir, '0008_library_foundation.sql')
const readingEntitiesMigrationFile = path.join(migrationsDir, '0009_reading_entities.sql')

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

function applyAccessTokenMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(accessTokenMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyAnnotationChapterHrefMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(annotationChapterHrefMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyLibrarySortTimestampsMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(librarySortTimestampsMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyLibraryFoundationMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(libraryFoundationMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyReadingEntitiesMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(readingEntitiesMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

const bookVersionRefsMigrationFile = path.join(migrationsDir, '0010_book_version_refs.sql')
const revisionMetaMigrationFile = path.join(migrationsDir, '0011_revision_meta.sql')
const versionPinMigrationFile = path.join(migrationsDir, '0012_version_pin.sql')
const categoryPinMigrationFile = path.join(migrationsDir, '0013_category_pin.sql')
const annotationDedupMigrationFile = path.join(migrationsDir, '0015_annotation_dedup.sql')

function applyBookVersionRefsMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(bookVersionRefsMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyRevisionMetaMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(revisionMetaMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyVersionPinMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(versionPinMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyCategoryPinMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(categoryPinMigrationFile, 'utf8')
  for (const statement of sql.split('--> statement-breakpoint').map((part) => part.trim()).filter(Boolean)) {
    sqlite.exec(statement)
  }
}

function applyAnnotationDedupMigration(sqlite: Database.Database) {
  const sql = fs.readFileSync(annotationDedupMigrationFile, 'utf8')
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

describe('annotation chapter identity migration', () => {
  it('adds the TOC href column without changing existing annotations', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    applyBaseline(sqlite)
    applyAnnotationChapterHrefMigration(sqlite)

    expect(sqlite.prepare('PRAGMA table_info(annotations)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'chapter_href' })]))

    sqlite.close()
  })
})

describe('library membership timestamps migration', () => {
  function seed(sqlite: Database.Database) {
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO shelves (id, user_id, name, sort_order, created_at)
        VALUES ('s1', 'u1', 'S1', 0, 1), ('s2', 'u1', 'S2', 1, 1);
      INSERT INTO tags (id, user_id, name, sort_order) VALUES ('t1', 'u1', 'T1', 0), ('t2', 'u1', 'T2', 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at, shelf_id)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1, 's1');
      INSERT INTO book_tags (book_id, tag_id) VALUES ('b1', 't1');
    `)
  }

  function touchTimestamp(sqlite: Database.Database, table: 'shelves' | 'tags', id: string): number {
    return (sqlite.prepare(`SELECT updated_at AS ts FROM ${table} WHERE id = ?`).get(id) as { ts: number }).ts
  }

  it('adds the columns and backfills existing rows with the migration moment', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyBaseline(sqlite)
    applyReleaseMigration(sqlite)
    seed(sqlite)

    applyLibrarySortTimestampsMigration(sqlite)

    expect(sqlite.prepare('PRAGMA table_info(shelves)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'updated_at' })]))
    expect(sqlite.prepare('PRAGMA table_info(tags)').all())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'created_at' }),
        expect.objectContaining({ name: 'updated_at' }),
      ]))
    expect((sqlite.prepare('SELECT created_at AS ts FROM tags WHERE id = ?').get('t1') as { ts: number }).ts).toBeGreaterThan(1)
    for (const id of ['s1', 's2']) expect(touchTimestamp(sqlite, 'shelves', id)).toBeGreaterThan(1)
    for (const id of ['t1', 't2']) expect(touchTimestamp(sqlite, 'tags', id)).toBeGreaterThan(1)

    sqlite.close()
  })

  it('touches membership timestamps on shelf moves and tag attach/detach only', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyBaseline(sqlite)
    applyReleaseMigration(sqlite)
    applyLibrarySortTimestampsMigration(sqlite)
    seed(sqlite)
    sqlite.exec('UPDATE shelves SET updated_at = 100; UPDATE tags SET updated_at = 100;')

    // Shelf move touches both the old and the new shelf
    sqlite.exec("UPDATE books SET shelf_id = 's2' WHERE id = 'b1'")
    expect(touchTimestamp(sqlite, 'shelves', 's1')).toBeGreaterThan(100)
    expect(touchTimestamp(sqlite, 'shelves', 's2')).toBeGreaterThan(100)

    // A same-value rewrite of shelf_id is not a membership change
    sqlite.exec("UPDATE shelves SET updated_at = 100 WHERE id = 's2'")
    sqlite.exec("UPDATE books SET shelf_id = 's2' WHERE id = 'b1'")
    expect(touchTimestamp(sqlite, 'shelves', 's2')).toBe(100)

    // Renaming a shelf does not count as a membership change
    sqlite.exec("UPDATE shelves SET name = 'renamed' WHERE id = 's2'")
    expect(touchTimestamp(sqlite, 'shelves', 's2')).toBe(100)

    // Tag detach and attach touch the affected tag only
    sqlite.exec("DELETE FROM book_tags WHERE book_id = 'b1' AND tag_id = 't1'")
    expect(touchTimestamp(sqlite, 'tags', 't1')).toBeGreaterThan(100)
    expect(touchTimestamp(sqlite, 'tags', 't2')).toBe(100)
    sqlite.exec("INSERT INTO book_tags (book_id, tag_id) VALUES ('b1', 't2')")
    expect(touchTimestamp(sqlite, 'tags', 't2')).toBeGreaterThan(100)

    // New books touch their shelf; trashing and restoring touch shelf and tags
    sqlite.exec("UPDATE shelves SET updated_at = 100 WHERE id = 's2'; UPDATE tags SET updated_at = 100")
    sqlite.exec(`
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at, shelf_id)
        VALUES ('b2', 'u1', 'B2', 'txt', 'k2', 1, 1, 1, 's2');
    `)
    expect(touchTimestamp(sqlite, 'shelves', 's2')).toBeGreaterThan(100)
    sqlite.exec("UPDATE shelves SET updated_at = 100; UPDATE tags SET updated_at = 100")
    sqlite.exec("UPDATE books SET deleted_at = 500 WHERE id = 'b1'")
    expect(touchTimestamp(sqlite, 'shelves', 's2')).toBeGreaterThan(100)
    expect(touchTimestamp(sqlite, 'tags', 't2')).toBeGreaterThan(100)
    sqlite.exec("UPDATE shelves SET updated_at = 100; UPDATE tags SET updated_at = 100")
    sqlite.exec("UPDATE books SET deleted_at = NULL WHERE id = 'b1'")
    expect(touchTimestamp(sqlite, 'shelves', 's2')).toBeGreaterThan(100)
    expect(touchTimestamp(sqlite, 'tags', 't2')).toBeGreaterThan(100)

    // Hard-deleting a trashed book leaves shelf timestamps alone (it was
    // already out of the visible count); deleting a visible book touches it
    sqlite.exec("UPDATE books SET deleted_at = 500 WHERE id = 'b1'")
    sqlite.exec("UPDATE shelves SET updated_at = 100 WHERE id = 's2'")
    sqlite.exec("DELETE FROM books WHERE id = 'b1'")
    expect(touchTimestamp(sqlite, 'shelves', 's2')).toBe(100)
    sqlite.exec("DELETE FROM books WHERE id = 'b2'")
    expect(touchTimestamp(sqlite, 'shelves', 's2')).toBeGreaterThan(100)

    sqlite.close()
  })
})

describe('library foundation migration', () => {
  function fullChain(sqlite: Database.Database) {
    applyBaseline(sqlite)
    applyReleaseMigration(sqlite)
    applyReplacementMigration(sqlite)
    applyReplacementScopeMigration(sqlite)
    applyLegadoAccessKeyMigration(sqlite)
    applyAccessTokenMigration(sqlite)
    applyAnnotationChapterHrefMigration(sqlite)
    applyLibrarySortTimestampsMigration(sqlite)
    applyLibraryFoundationMigration(sqlite)
    applyReadingEntitiesMigration(sqlite)
  }

  it('creates the new tables and user columns without touching legacy rows', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    fullChain(sqlite)

    const tables = new Set(
      (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name),
    )
    for (const name of ['libraries', 'library_memberships', 'library_books', 'library_book_versions', 'book_versions', 'content_revisions', 'blobs', 'library_categories', 'library_tags', 'library_book_tags', 'instance', 'sessions', 'library_migration_log', 'book_states', 'highlights', 'bookmarks', 'ideas']) {
      expect(tables.has(name)).toBe(true)
    }

    const userColumns = (sqlite.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name)
    expect(userColumns).toContain('username_normalized')
    expect(userColumns).toContain('bio')
    const libraryBookColumns = (sqlite.prepare('PRAGMA table_info(library_books)').all() as { name: string }[]).map((c) => c.name)
    expect(libraryBookColumns).toContain('deleted_at')

    sqlite.exec(`INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1), ('u2', 'U2', 1)`)
    // Compat window: multiple NULL normalized values coexist.
    expect(sqlite.prepare('SELECT COUNT(*) AS c FROM users').get()).toEqual({ c: 2 })
    sqlite.exec(`UPDATE users SET username_normalized = 'u1', bio = 'hello' WHERE id = 'u1'`)
    expect(sqlite.prepare('SELECT bio AS b FROM users WHERE id = ?').get('u2')).toEqual({ b: '' })
    // Exact-duplicate normalized values are rejected; case rules stay app-side.
    expect(() => sqlite.exec(`UPDATE users SET username_normalized = 'u1' WHERE id = 'u2'`)).toThrow()

    sqlite.close()
  })

  it('enforces membership uniqueness, version restrict, and idea survival', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    fullChain(sqlite)
    sqlite.exec(`INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1)`)

    sqlite.exec(`INSERT INTO libraries (id, user_id, type, name, created_at, updated_at) VALUES ('l1', 'u1', 'shared', 'City', 1, 1)`)
    sqlite.exec(`INSERT INTO library_memberships (id, library_id, user_id, role, created_at, updated_at) VALUES ('m1', 'l1', 'u1', 'admin', 1, 1)`)
    expect(() => sqlite.exec(`INSERT INTO library_memberships (id, library_id, user_id, role, created_at, updated_at) VALUES ('m2', 'l1', 'u1', 'member', 1, 1)`)).toThrow()

    sqlite.exec(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s1', 'u1', 'h1', 1, 2)`)
    expect(() => sqlite.exec(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s2', 'u1', 'h1', 1, 2)`)).toThrow()

    sqlite.exec(`
      INSERT INTO book_versions (id, format, size, created_at, updated_at) VALUES ('v1', 'epub', 10, 1, 1);
      INSERT INTO content_revisions (id, book_version_id, revision_no, blob_key, size, created_at) VALUES ('r1', 'v1', 1, 'k1', 10, 1);
      INSERT INTO library_books (id, library_id, user_id, title, created_at, updated_at) VALUES ('b1', 'l1', 'u1', 'Work', 1, 1);
      INSERT INTO library_book_versions (id, library_id, library_book_id, book_version_id, kind, created_at, updated_at)
        VALUES ('lbv1', 'l1', 'b1', 'v1', 'personal', 1, 1);
    `)
    expect(() => sqlite.exec(`INSERT INTO content_revisions (id, book_version_id, revision_no, blob_key, size, created_at) VALUES ('r2', 'v1', 1, 'k2', 10, 1)`)).toThrow()
    // A version with library entries cannot be deleted (restrict, no cascade).
    expect(() => sqlite.exec(`DELETE FROM book_versions WHERE id = 'v1'`)).toThrow()

    // Deleting the library cascades memberships but never user-owned ideas.
    sqlite.exec(`INSERT INTO ideas (id, user_id, book_version_id, text, visibility, shared_library_id, created_at, updated_at)
      VALUES ('i1', 'u1', 'v1', 't', 'shared', 'l1', 1, 1)`)
    sqlite.exec(`DELETE FROM libraries WHERE id = 'l1'`)
    expect(sqlite.prepare('SELECT COUNT(*) AS c FROM library_memberships').get()).toEqual({ c: 0 })
    expect(sqlite.prepare('SELECT shared_library_id AS s FROM ideas WHERE id = ?').get('i1')).toEqual({ s: 'l1' })

    sqlite.close()
  })

  it('rejects duplicate book states for one user and version', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    fullChain(sqlite)
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO book_versions (id, format, size, created_at, updated_at) VALUES ('v1', 'txt', 10, 1, 1);
      INSERT INTO book_states (user_id, book_version_id, percent, updated_at) VALUES ('u1', 'v1', 10, 1);
    `)
    expect(() => sqlite.exec(`INSERT INTO book_states (user_id, book_version_id, percent, updated_at) VALUES ('u1', 'v1', 20, 2)`)).toThrow()

    sqlite.close()
  })
})

describe('book version reference migration', () => {
  it('adds nullable version references without touching legacy columns', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyBaseline(sqlite)
    applyReleaseMigration(sqlite)
    applyReplacementMigration(sqlite)
    applyReplacementScopeMigration(sqlite)
    applyLibraryFoundationMigration(sqlite)
    applyReadingEntitiesMigration(sqlite)
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1);
      INSERT INTO reading_records (id, user_id, book_id, date, duration_seconds)
        VALUES ('r1', 'u1', 'b1', '2026-09-26', 60);
    `)
    applyBookVersionRefsMigration(sqlite)

    for (const table of ['reading_records', 'reading_sessions', 'ai_threads', 'ai_book_indexes', 'ai_chunks', 'ai_chunk_embeddings', 'text_replacements', 'text_replacement_overrides']) {
      expect(sqlite.prepare(`PRAGMA table_info(${table})`).all())
        .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'book_version_id' })]))
    }
    expect(sqlite.prepare('PRAGMA table_info(book_states)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'last_read_at' })]))
    // Legacy rows keep working with NULL references until the service backfills.
    expect(sqlite.prepare('SELECT book_version_id AS v FROM reading_records WHERE id = ?').get('r1')).toEqual({ v: null })

    applyRevisionMetaMigration(sqlite)
    expect(sqlite.prepare('PRAGMA table_info(content_revisions)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'meta' })]))

    applyVersionPinMigration(sqlite)
    expect(sqlite.prepare('PRAGMA table_info(library_book_versions)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'pinned_at' })]))

    sqlite.close()
  })
})

describe('book id retarget repair', () => {
  it('retargets book FKs to versions preserving rows, indexes and FTS triggers', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyBaseline(sqlite)
    applyReleaseMigration(sqlite)
    applyReplacementMigration(sqlite)
    applyReplacementScopeMigration(sqlite)
    applyLegadoAccessKeyMigration(sqlite)
    applyAccessTokenMigration(sqlite)
    applyAnnotationChapterHrefMigration(sqlite)
    applyLibrarySortTimestampsMigration(sqlite)
    applyLibraryFoundationMigration(sqlite)
    applyReadingEntitiesMigration(sqlite)
    applyBookVersionRefsMigration(sqlite)
    applyRevisionMetaMigration(sqlite)
    applyVersionPinMigration(sqlite)
    applyCategoryPinMigration(sqlite)
    applyAnnotationDedupMigration(sqlite)
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1);
      INSERT INTO book_versions (id, format, size, created_at, updated_at)
        VALUES ('b1', 'txt', 1, 1, 1);
      INSERT INTO reading_records (id, user_id, book_id, date, duration_seconds)
        VALUES ('r1', 'u1', 'b1', '2026-09-26', 60);
      INSERT INTO text_replacements (id, user_id, match_type, created_at, updated_at)
        VALUES ('t1', 'u1', 'pattern', 1, 1);
      INSERT INTO text_replacement_overrides (id, user_id, book_id, replacement_id, enabled, created_at, updated_at)
        VALUES ('o1', 'u1', 'b1', 't1', 0, 1, 1);
      INSERT INTO ai_book_indexes (id, user_id, book_id, source_version, status, created_at, updated_at)
        VALUES ('i1', 'u1', 'b1', 'v1', 'ready', 1, 1);
      INSERT INTO ai_chunks (id, user_id, index_id, book_id, chapter_index, chapter_id, chapter_title, start_offset, end_offset, text, created_at)
        VALUES ('c1', 'u1', 'i1', 'b1', 0, 'ch1', 'Chapter 1', 0, 10, 'first text', 1);
    `)

    retargetBookIdReferences(drizzle(sqlite, { schema }))

    // All rows survive with identical values.
    expect(sqlite.prepare('SELECT duration_seconds AS d FROM reading_records WHERE id = ?').get('r1')).toEqual({ d: 60 })
    expect(sqlite.prepare('SELECT enabled AS e FROM text_replacement_overrides WHERE id = ?').get('o1')).toEqual({ e: 0 })
    expect(sqlite.prepare('SELECT text AS t FROM ai_chunks WHERE id = ?').get('c1')).toEqual({ t: 'first text' })
    // book_id now points at versions, not legacy rows.
    const refs = sqlite.prepare('PRAGMA foreign_key_list(reading_records)').all() as { from: string; table: string }[]
    expect(refs.find((r) => r.from === 'book_id')?.table).toBe('book_versions')
    // Indexes and the FTS sync triggers are back in place.
    expect(sqlite.prepare('PRAGMA index_list(reading_records)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'reading_records_user_book_date_idx' })]))
    const triggers = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'ai_chunks'").all() as { name: string }[])
      .map((t) => t.name)
    expect(triggers).toEqual(expect.arrayContaining(['ai_chunks_fts_insert', 'ai_chunks_fts_update', 'ai_chunks_fts_delete']))
    // FTS sync still works through the rebuilt table and triggers.
    expect(sqlite.prepare('SELECT text AS t FROM ai_chunks_fts WHERE chunk_id = ?').get('c1')).toEqual({ t: 'first text' })
    sqlite.exec(`INSERT INTO ai_chunks (id, user_id, index_id, book_id, chapter_index, chapter_id, chapter_title, start_offset, end_offset, text, created_at)
      VALUES ('c2', 'u1', 'i1', 'b1', 1, 'ch2', 'Chapter 2', 11, 20, 'second text', 2)`)
    expect(sqlite.prepare('SELECT text AS t FROM ai_chunks_fts WHERE chunk_id = ?').get('c2')).toEqual({ t: 'second text' })
    // Version-native writes validate; dangling book ids are rejected.
    sqlite.exec(`INSERT INTO reading_records (id, user_id, book_id, date, duration_seconds) VALUES ('r2', 'u1', 'b1', '2026-09-27', 5)`)
    expect(() => sqlite.exec(`INSERT INTO reading_records (id, user_id, book_id, date, duration_seconds) VALUES ('r3', 'u1', 'nope', '2026-09-27', 5)`)).toThrow()
    // Annotation dedup backstops exist for the retargeted annotation tables.
    expect(sqlite.prepare('PRAGMA index_list(highlights)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'highlights_user_version_cfi_unique' })]))
    expect(sqlite.prepare('PRAGMA index_list(bookmarks)').all())
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'bookmarks_user_version_cfi_unique' })]))
    // Reruns are no-ops once every table points at versions.
    retargetBookIdReferences(drizzle(sqlite, { schema }))

    sqlite.close()
  })

  it('refuses to boot with rows that never migrated instead of dropping history', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    applyBaseline(sqlite)
    applyReleaseMigration(sqlite)
    applyLibraryFoundationMigration(sqlite)
    sqlite.exec(`
      INSERT INTO users (id, username, created_at) VALUES ('u1', 'u1', 1);
      INSERT INTO books (id, user_id, title, format, file_path, size, created_at, updated_at)
        VALUES ('b1', 'u1', 'B1', 'txt', 'k1', 1, 1, 1);
      INSERT INTO reading_records (id, user_id, book_id, date, duration_seconds)
        VALUES ('r1', 'u1', 'b1', '2026-09-26', 60);
    `)
    expect(() => retargetBookIdReferences(drizzle(sqlite, { schema }))).toThrow('Phase 2 data migration')
    sqlite.close()
  })
})

describe('library book trash column repair', () => {
  it('adds deleted_at to a library_books table created before the column existed', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL);
      CREATE TABLE library_books (
        id TEXT PRIMARY KEY NOT NULL,
        library_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    const db = drizzle(sqlite, { schema })
    const columns = () => (sqlite.prepare('PRAGMA table_info(library_books)').all() as { name: string }[]).map((c) => c.name)

    expect(columns()).not.toContain('deleted_at')
    repairLibraryBooksDeletedAt(db)
    expect(columns()).toContain('deleted_at')
    // Idempotent: a healed database repairs to a no-op.
    repairLibraryBooksDeletedAt(db)
    expect(columns()).toContain('deleted_at')

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

  it('refuses downgrade boots instead of rewriting the ledger down', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder: migrationsDir })
    const before = sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get()
    // Simulate a newer release having migrated further: an unknown record on
    // top makes the ledger longer than this code's journal.
    sqlite.exec(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('newer-release-migration', 9999999999999)`)
    expect(() => reconcileConsolidatedMigrationLedger(db, migrationsDir)).toThrow(/newer release/)
    // The ledger is untouched, so the next boot with matching code still works.
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get())
      .toEqual({ count: (before as { count: number }).count + 1 })
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
    applyAccessTokenMigration(sqlite)
    applyAnnotationChapterHrefMigration(sqlite)
    applyLibrarySortTimestampsMigration(sqlite)
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
      // Journal holds baseline + 0001..0013 + 0015 (0014 was abandoned for the
      // client-side repair); reconcile rewrites the ledger to match it.
      .toEqual({ count: 15 })

    sqlite.close()
  })
})
