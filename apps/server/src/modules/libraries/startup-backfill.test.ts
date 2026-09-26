import { describe, expect, it, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import { createId } from '../../lib/id'
import { runPhase2StartupBackfill } from './startup-backfill'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

function mockStorage(existing = new Set<string>()) {
  vi.spyOn(storage, 'getStorage').mockReturnValue({
    async put() {},
    async get() { throw new Error('missing blob') },
    async delete() {},
    async exists(key: string) { return existing.has(key) },
    async size() { return 100 },
  } as unknown as ReturnType<typeof storage.getStorage>)
}

function seedOwner(db: ReturnType<typeof createTestDb>, username = 'owner') {
  const id = createId('user')
  const now = Date.now()
  db.insert(schema.users).values({
    id, username, passwordHash: 'x', role: 'owner', createdAt: now,
  }).run()
  return id
}

function seedBook(db: ReturnType<typeof createTestDb>, userId: string) {
  const id = createId('book')
  const now = Date.now()
  db.insert(schema.books).values({
    id, userId, title: 'Legacy Book', format: 'txt', filePath: 'books/legacy/book.epub',
    size: 100, meta: {}, createdAt: now, updatedAt: now,
  }).run()
  return id
}

describe('phase 2 startup backfill', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    mockStorage(new Set(['books/legacy/book.epub']))
  })

  it('skips fresh installs with no real users', async () => {
    const outcome = await runPhase2StartupBackfill()
    expect(outcome).toEqual({ status: 'skipped-fresh' })
    expect(db.select().from(schema.libraryMigrationLog).all()).toHaveLength(0)
  })

  it('migrates a legacy database end to end', async () => {
    const ownerId = seedOwner(db)
    const bookId = seedBook(db, ownerId)
    const outcome = await runPhase2StartupBackfill()
    expect(outcome.status).toBe('completed')
    // Private library, version, revision and state all exist for the old book.
    expect(db.select().from(schema.libraries).all()).toHaveLength(1)
    expect(db.select().from(schema.bookVersions).all().map((v) => v.id)).toContain(bookId)
    expect(db.select().from(schema.contentRevisions).all()).toHaveLength(1)
    expect(db.select().from(schema.instance).all()).toHaveLength(1)
  })

  it('fast-paths on the ledger once every batch completed', async () => {
    const ownerId = seedOwner(db)
    seedBook(db, ownerId)
    expect((await runPhase2StartupBackfill()).status).toBe('completed')
    const logRows = db.select().from(schema.libraryMigrationLog).all().length
    const outcome = await runPhase2StartupBackfill()
    expect(outcome).toEqual({ status: 'skipped-complete' })
    expect(db.select().from(schema.libraryMigrationLog).all()).toHaveLength(logRows)
  })

  it('refuses to boot on ambiguous ownership instead of serving empty libraries', async () => {
    seedOwner(db, 'owner-a')
    seedOwner(db, 'owner-b')
    await expect(runPhase2StartupBackfill()).rejects.toThrow('instance seed blocked')
  })
})
