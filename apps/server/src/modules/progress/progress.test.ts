import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { getProgress, upsertProgress } from './progress.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

function createMemoryStorage() {
  const files = new Map<string, Buffer>()
  const driver: StorageDriver = {
    async put(key, data) {
      if (Buffer.isBuffer(data)) {
        files.set(key, data)
      } else {
        const chunks: Buffer[] = []
        for await (const chunk of data) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        files.set(key, Buffer.concat(chunks))
      }
    },
    async get(key) {
      const buf = files.get(key)
      if (!buf) throw new Error(`missing blob: ${key}`)
      return Readable.from(buf)
    },
    async delete(key) {
      files.delete(key)
    },
    async exists(key) {
      return files.has(key)
    },
    async size(key) {
      return files.get(key)?.length ?? 0
    },
  }
  return { driver, files }
}

describe('progress service', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let otherId: string
  let bookId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)

    ownerId = createId('user')
    db.insert(schema.users).values({
      id: ownerId,
      username: 'owner',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()
    otherId = createId('user')
    db.insert(schema.users).values({
      id: otherId,
      username: 'other',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()

    bookId = createId('book')
    db.insert(schema.books).values({
      id: bookId,
      userId: ownerId,
      title: 'Test Book',
      author: 'Author',
      format: 'txt',
      filePath: 'books/test/test.txt',
      coverKey: null,
      size: 100,
      meta: {},
      readStatus: 'wishlist',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()
  })

  it('should upsert and read progress for the book owner', async () => {
    const saved = await upsertProgress(ownerId, bookId, { percent: 50 })
    expect(saved.percent).toBe(50)

    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get()
    expect(book!.progress).toBe(50)
    // readStatus is manual-only: progress writes must not change it
    expect(book!.readStatus).toBe('wishlist')
    expect(book!.lastReadAt).not.toBeNull()

    const loaded = await getProgress(ownerId, bookId)
    expect(loaded!.percent).toBe(50)
  })

  it('should return null when the owner has no progress yet', async () => {
    expect(await getProgress(ownerId, bookId)).toBeNull()
  })

  it('should reject cross-user progress upsert with BOOK_NOT_FOUND', async () => {
    await expect(upsertProgress(otherId, bookId, { percent: 10 })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get()
    expect(book!.progress).toBe(0)
    expect(book!.lastReadAt).toBeNull()
  })

  it('should reject cross-user progress read with BOOK_NOT_FOUND', async () => {
    await upsertProgress(ownerId, bookId, { percent: 30 })
    await expect(getProgress(otherId, bookId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('should reject progress upsert for a trashed book', async () => {
    db.update(schema.books).set({ deletedAt: Date.now() }).where(eq(schema.books.id, bookId)).run()
    await expect(upsertProgress(ownerId, bookId, { percent: 10 })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('should merge reported segments into intervals and expose readFraction', async () => {
    await upsertProgress(ownerId, bookId, { percent: 10, fraction: 0.1, segmentStartFraction: 0 })
    let loaded = await getProgress(ownerId, bookId)
    expect(loaded!.fraction).toBe(0.1)
    expect(loaded!.readFraction).toBeCloseTo(0.1)
    expect(loaded).not.toHaveProperty('intervals')

    // continuous reading extends coverage
    await upsertProgress(ownerId, bookId, { percent: 20, fraction: 0.2, segmentStartFraction: 0.1 })
    loaded = await getProgress(ownerId, bookId)
    expect(loaded!.readFraction).toBeCloseTo(0.2)

    // a jump leaves the skipped range uncovered
    await upsertProgress(ownerId, bookId, { percent: 60, fraction: 0.6, segmentStartFraction: 0.5 })
    loaded = await getProgress(ownerId, bookId)
    expect(loaded!.readFraction).toBeCloseTo(0.3)
  })

  it('stores rate samples in a capped sliding window and returns them', async () => {
    for (let i = 1; i <= 25; i++) {
      await upsertProgress(ownerId, bookId, {
        percent: i,
        sample: { fraction: i / 100, at: 1_000_000 + i * 60_000 },
      })
    }
    const loaded = await getProgress(ownerId, bookId)
    expect(loaded!.rateSamples).toHaveLength(20)
    expect(loaded!.rateSamples![0].fraction).toBeCloseTo(6 / 100)
    expect(loaded!.rateSamples![19].fraction).toBeCloseTo(25 / 100)
  })

  it('keeps samples absent from progress files when none were reported', async () => {
    await upsertProgress(ownerId, bookId, { percent: 10 })
    const loaded = await getProgress(ownerId, bookId)
    expect(loaded!.rateSamples).toBeUndefined()
  })

  it('should swap reversed segment bounds', async () => {
    await upsertProgress(ownerId, bookId, { percent: 10, fraction: 0.1, segmentStartFraction: 0.2 })
    const loaded = await getProgress(ownerId, bookId)
    expect(loaded!.readFraction).toBeCloseTo(0.2)
  })

  it('should initialize legacy progress without fraction from percent', async () => {
    await upsertProgress(ownerId, bookId, { percent: 30 })
    const loaded = await getProgress(ownerId, bookId)
    expect(loaded!.fraction).toBeNull()
    expect(loaded!.readFraction).toBeCloseTo(0.3)
  })
})
