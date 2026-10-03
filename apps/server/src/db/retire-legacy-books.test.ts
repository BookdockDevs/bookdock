import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from './client'
import { migrateBeforeBookRetirement } from './migration-stage'
import * as schema from './schema'
import { prepareBookRetirement } from './retire-legacy-books'
import { LocalFsDriver } from '../storage/localfs'
import * as storage from '../storage'

const state = vi.hoisted(() => ({ dir: '' }))
vi.mock('../config', () => ({ config: { get dataDir() { return state.dir }, dbPath: ':memory:' } }))
const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url))
let sqlite: Database.Database
let db: ReturnType<typeof client.getDb>

beforeEach(async () => {
  state.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bookdock-retirement-'))
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

function seedLegacy(filePath = 'blobs/old.epub') {
  migrateBeforeBookRetirement(db, { migrationsFolder })
  sqlite.exec(`INSERT INTO users (id, username, username_normalized, role, created_at) VALUES ('u', 'owner', 'owner', 'owner', 1)`)
  sqlite.prepare(`INSERT INTO books (id, user_id, title, format, file_path, size, meta, created_at, updated_at)
    VALUES ('b', 'u', 'Old', 'epub', ?, 4, '{"wordCount":4,"chapters":[]}', 1, 1)`).run(filePath)
}

describe('book retirement production orchestration', () => {
  it('boots fresh databases and repeats without reviving legacy tables or backfills', async () => {
    await client.runDatabaseMigrations(db)
    const ledger = sqlite.prepare('SELECT * FROM __drizzle_migrations').all()
    await client.runDatabaseMigrations(db)
    expect(sqlite.prepare('SELECT * FROM __drizzle_migrations').all()).toEqual(ledger)
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name IN ('books','shelves','tags','book_tags','annotations')").all()).toEqual([])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(sqlite.prepare("SELECT COUNT(*) n FROM library_migration_log WHERE batch = 'book-retirement-preflight'").get()).toEqual({ n: 1 })
    expect(sqlite.pragma('table_info(users)')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'role' })]))
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='instance_settings'").get()).toBeDefined()
  })

  it('bridges populated old data and preserves the entire progress JSON before deleting tables', async () => {
    seedLegacy()
    const driver = storage.getStorage()
    await driver.put('blobs/old.epub', Buffer.from('book'))
    const progress = Buffer.from(JSON.stringify({ percent: 42, cfi: 'cfi', fraction: 0.42,
      chapterIndex: 3, intervals: [[0, 0.42]], rateSamples: [{ chars: 9, seconds: 2 }], updatedAt: 9, extension: { a: 1 } }))
    await driver.put('progress/b.json', progress)
    sqlite.exec(`INSERT INTO annotations (id,user_id,book_id,cfi_range,type,text,note,color,style,created_at,updated_at)
      VALUES ('h','u','b','range','highlight','Full text',NULL,'yellow','underline',1,1),
      ('i','u','b','range','note','Quote','Idea','blue','highlight',1,1),
      ('m','u','b','position','bookmark','Chapter',NULL,'yellow','underline',1,1);
      INSERT INTO reading_records (id,user_id,book_id,date,duration_seconds) VALUES ('r','u','b','2026-10-03',90);`)
    await client.runDatabaseMigrations(db)
    expect(await fs.readFile(path.join(state.dir, 'files/progress/u/b.json'))).toEqual(progress)
    expect(await driver.exists('progress/b.json')).toBe(false)
    expect(sqlite.prepare("SELECT text FROM highlights WHERE id='h'").get()).toEqual({ text: 'Full text' })
    expect(sqlite.prepare("SELECT note,color FROM ideas WHERE id='i'").get()).toEqual({ note: 'Idea', color: 'blue' })
    expect(sqlite.prepare("SELECT title FROM bookmarks WHERE id='m'").get()).toEqual({ title: 'Chapter' })
    expect(sqlite.prepare('SELECT duration_seconds,book_version_id FROM reading_records').get()).toEqual({ duration_seconds: 90, book_version_id: 'b' })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    await client.runDatabaseMigrations(db)
    expect(await fs.readFile(path.join(state.dir, 'files/progress/u/b.json'))).toEqual(progress)
  })

  it('discards unmigratable old rows with explicit loss counts and still boots twice', async () => {
    seedLegacy('missing.epub')
    sqlite.exec(`INSERT INTO reading_records (id,user_id,book_id,date,duration_seconds) VALUES ('r','u','b','2026-10-03',90);
      INSERT INTO annotations (id,user_id,book_id,cfi_range,type,text,created_at,updated_at)
      VALUES ('h','u','b','range','highlight','Lost original',1,1);`)
    await client.runDatabaseMigrations(db)
    const row = sqlite.prepare("SELECT details FROM library_migration_log WHERE batch='book-retirement-preflight'").get() as { details: string }
    expect(JSON.parse(row.details).losses).toMatchObject({ booksWithoutVersion: 1, annotationsWithoutTarget: 1, reading_records: 1 })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    await client.runDatabaseMigrations(db)
    expect(sqlite.prepare('SELECT * FROM book_versions').all()).toEqual([])
  })

  it('keeps current progress and archives unassignable or malformed legacy files', async () => {
    seedLegacy()
    sqlite.exec(`INSERT INTO book_versions (id,format,size,created_at,updated_at) VALUES ('b','epub',4,1,1)`)
    const driver = storage.getStorage()
    const current = Buffer.from('{"percent":80,"intervals":[[0,0.8]],"updatedAt":8}')
    const old = Buffer.from('{"percent":20,"intervals":[[0,0.2]],"updatedAt":2}')
    await driver.put('progress/u/b.json', current)
    await driver.put('progress/b.json', old)
    await driver.put('progress/unknown.json', Buffer.from('invalid'))
    await prepareBookRetirement(db)
    expect(await fs.readFile(path.join(state.dir, 'files/progress/u/b.json'))).toEqual(current)
    expect(await fs.readFile(path.join(state.dir, 'files/legacy-retirement/progress/b.json'))).toEqual(old)
    expect(await driver.exists('legacy-retirement/progress/unknown.json')).toBe(true)
  })

  it('never overwrites newer annotation edits with frozen snapshot values', async () => {
    seedLegacy()
    sqlite.exec(`INSERT INTO book_versions (id,format,size,created_at,updated_at) VALUES ('b','epub',4,1,2);
      INSERT INTO annotations (id,user_id,book_id,cfi_range,type,text,color,style,created_at,updated_at)
      VALUES ('i','u','b','range','note','Old','yellow','underline',1,1);
      INSERT INTO ideas (id,user_id,book_version_id,cfi_range,text,note,color,style,visibility,created_at,updated_at)
      VALUES ('i','u','b','new range','New','Edited','blue','highlight','private',1,2);`)
    await prepareBookRetirement(db)
    expect(sqlite.prepare("SELECT text,note,color,style FROM ideas WHERE id='i'").get()).toEqual({ text: 'New', note: 'Edited', color: 'blue', style: 'highlight' })
  })

  it('rolls all FK rebuilds back when a later table contains an orphan', () => {
    seedLegacy()
    sqlite.exec(`INSERT INTO reading_sessions (id,user_id,book_id,date,duration_seconds) VALUES ('r','u','b','2026-10-03',90)`)
    expect(() => client.retargetBookIdReferences(db)).toThrow(/Cannot retarget reading_sessions/)
    expect(sqlite.pragma('foreign_key_list(reading_records)')).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'books', from: 'book_id' })]))
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%_new'").all()).toEqual([])
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('rejects direct destructive migration before references have been retargeted', () => {
    seedLegacy()
    expect(() => migrate(db, { migrationsFolder })).toThrow()
    expect(sqlite.prepare("SELECT id FROM books WHERE id='b'").get()).toBeDefined()
    expect(sqlite.prepare('SELECT MAX(created_at) ts FROM __drizzle_migrations').get()).toEqual({ ts: 1791600000000 })
  })
})

