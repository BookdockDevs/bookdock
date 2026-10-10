import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import * as client from './client'
import { migrateBeforeBookRetirement, migrateWithTagFilter } from './migration-stage'
import { prepareBookRetirement } from './retire-legacy-books'
import * as schema from './schema'
import * as storage from '../storage'
import { LocalFsDriver } from '../storage/localfs'

const state = vi.hoisted(() => ({ dir: '' }))
vi.mock('../config', () => ({ config: { get dataDir() { return state.dir }, dbPath: ':memory:' } }))
const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))
let sqlite: Database.Database
let db: ReturnType<typeof client.getDb>

beforeEach(async () => {
  state.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookdock-release-upgrade-'))
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  db = drizzle(sqlite, { schema })
  vi.spyOn(client, 'getDb').mockReturnValue(db)
  vi.spyOn(storage, 'getStorage').mockReturnValue(new LocalFsDriver(path.join(state.dir, 'files')))
})

afterEach(async () => {
  sqlite.close()
  vi.restoreAllMocks()
  await fs.rm(state.dir, { recursive: true, force: true })
})

it('upgrades the populated 0.4.4 schema without losing books, personal data or AI history', async () => {
  const journal = JSON.parse(await fs.readFile(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: unknown[] }
  migrateBeforeBookRetirement(db, { migrationsFolder })
  await prepareBookRetirement(db)
  client.retargetBookIdReferences(db)
  // 0.4.4 ends at 0041; keep the old AI tables populated until the upgrade.
  migrateWithTagFilter(db, { migrationsFolder }, ({ tag }) => tag <= '0041_idea_discussion')
  sqlite.exec(`
    INSERT INTO users (id, username, username_normalized, password_hash, created_at)
      VALUES ('u', 'owner', 'owner', 'fixture-credential', 1);
    INSERT INTO instance (id, owner_user_id, created_at, updated_at) VALUES ('instance', 'u', 1, 1);
    INSERT INTO book_versions (id, format, size, created_at, updated_at) VALUES ('b', 'txt', 4, 1, 1);
    INSERT INTO blobs (key, size, kind, created_at) VALUES ('book.txt', 4, 'book', 1);
    INSERT INTO content_revisions (id, book_version_id, revision_no, blob_key, size, created_at)
      VALUES ('r', 'b', 1, 'book.txt', 4, 1);
    INSERT INTO libraries (id, user_id, type, name, visibility, created_at, updated_at)
      VALUES ('library', 'u', 'shared', 'Shared library', 'public', 1, 1);
    INSERT INTO library_books (id, library_id, user_id, title, created_at, updated_at)
      VALUES ('work', 'library', 'u', 'Book', 1, 1);
    INSERT INTO library_book_versions (id, library_id, library_book_id, book_version_id, kind,
      pinned_revision_id, created_at, updated_at)
      VALUES ('link', 'library', 'work', 'b', 'personal', 'r', 1, 1);
    INSERT INTO book_states (user_id, book_version_id, percent, cfi, updated_at)
      VALUES ('u', 'b', 42, 'chapter:0', 1);
    INSERT INTO settings (id, user_id, key, value) VALUES ('s', 'u', 'readingConfig', '{"fontSize":20}');
    INSERT INTO bookmarks (id, user_id, book_version_id, cfi, context_text, created_at, updated_at)
      VALUES ('m', 'u', 'b', 'chapter:0', 'Saved excerpt', 1, 1);
    INSERT INTO ideas (id, user_id, book_version_id, text, note, created_at, updated_at)
      VALUES ('i', 'u', 'b', 'Quote', 'Personal note', 1, 1);
    INSERT INTO ai_threads (id, user_id, book_id, title, created_at, updated_at)
      VALUES ('t', 'u', 'b', 'Saved chat', 1, 1);
    INSERT INTO ai_messages (id, user_id, thread_id, role, content, created_at)
      VALUES ('a', 'u', 't', 'assistant', 'Saved answer', 1);
    INSERT INTO ai_book_indexes (id, user_id, book_id, status, source_version, created_at, updated_at)
      VALUES ('idx', 'u', 'b', 'ready', 'v1', 1, 1);
    INSERT INTO ai_chunks (id, user_id, index_id, book_id, chapter_index, chapter_id, chapter_title,
      start_offset, end_offset, text, created_at)
      VALUES ('chunk', 'u', 'idx', 'b', 0, 'c', 'Chapter', 0, 4, 'book', 1);
    INSERT INTO ai_chunk_embeddings (id, user_id, index_id, chunk_id, book_id, model, dimension, vector, created_at)
      VALUES ('embedding', 'u', 'idx', 'chunk', 'b', 'fixture', 1, X'00000000', 1);
  `)
  const file = path.join(state.dir, 'files', 'book.txt')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, 'book')
  const progressFile = path.join(state.dir, 'files', 'progress', 'u', 'b.json')
  const progress = JSON.stringify({ percent: 42, cfi: 'chapter:0', chapterIndex: 0, intervals: [[0, 0.42]] })
  await fs.mkdir(path.dirname(progressFile), { recursive: true })
  await fs.writeFile(progressFile, progress)
  const retainedTables = ['users', 'settings', 'libraries', 'library_books', 'library_book_versions', 'book_versions', 'content_revisions', 'bookmarks', 'ideas', 'ai_threads', 'ai_messages']
  const before = retainedTables.map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
  const oldState = sqlite.prepare('SELECT * FROM book_states').all()
  const oldLedger = sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()
  expect(oldLedger).toHaveLength(41)
  expect(sqlite.prepare('SELECT count(*) AS n FROM ai_chunks_fts').get()).toEqual({ n: 1 })
  expect(sqlite.pragma('foreign_key_check')).toEqual([])

  await client.runDatabaseMigrations(db)

  expect(retainedTables.map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).toEqual(before)
  expect(sqlite.prepare('SELECT * FROM book_states').all()).toEqual(oldState)
  expect(sqlite.prepare('SELECT storage_tier, last_accessed_at FROM blobs').get()).toEqual({ storage_tier: 'local', last_accessed_at: null })
  expect(sqlite.prepare('SELECT storage_backend_enabled, storage_backend_status FROM instance').get()).toEqual({ storage_backend_enabled: 0, storage_backend_status: 'disabled' })
  expect(sqlite.prepare('SELECT count(*) AS n FROM storage_transfer_tasks').get()).toEqual({ n: 0 })
  expect(sqlite.pragma('table_info(storage_connections)')).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'region' }), expect.objectContaining({ name: 'bucket' }),
  ]))
  expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'ai_chunks%' OR name IN ('ai_book_indexes', 'ai_chunk_embeddings')").all()).toEqual([])
  const upgradedLedger = sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()
  expect(upgradedLedger).toHaveLength(journal.entries.length)
  expect(upgradedLedger.slice(0, oldLedger.length)).toEqual(oldLedger)
  expect(sqlite.pragma('foreign_key_check')).toEqual([])
  expect(sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
  expect(await fs.readFile(file, 'utf8')).toBe('book')
  expect(await fs.readFile(progressFile, 'utf8')).toBe(progress)

  await client.runDatabaseMigrations(db)
  expect(sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()).toEqual(upgradedLedger)
  expect(retainedTables.map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).toEqual(before)
}, 30_000)
