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
import {
  getBook,
  getActiveBook,
  updateBook,
  trashBook,
  restoreBook,
  deleteBook,
} from './books.service'

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

function seedUser(db: ReturnType<typeof createTestDb>, username: string): string {
  const id = createId('user')
  db.insert(schema.users).values({
    id,
    username,
    passwordHash: null,
    role: 'owner',
    createdAt: Date.now(),
  }).run()
  return id
}

function seedBook(
  db: ReturnType<typeof createTestDb>,
  userId: string,
  overrides?: Partial<typeof schema.books.$inferInsert>,
) {
  const book = {
    id: createId('book'),
    userId,
    title: 'Test Book',
    author: 'Test Author',
    format: 'txt' as const,
    filePath: `blobs/te/${createId('hash')}.epub`,
    coverKey: null,
    size: 100,
    meta: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
  db.insert(schema.books).values(book).run()
  return book
}

describe('books ownership', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let otherId: string
  let book: ReturnType<typeof seedBook>

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)

    ownerId = seedUser(db, 'owner')
    otherId = seedUser(db, 'other')
    book = seedBook(db, ownerId)
  })

  it('should return the book to its owner', async () => {
    const found = await getBook(ownerId, book.id)
    expect(found.id).toBe(book.id)
    const active = await getActiveBook(ownerId, book.id)
    expect(active.id).toBe(book.id)
  })

  it('should reject cross-user reads with BOOK_NOT_FOUND', async () => {
    await expect(getBook(otherId, book.id)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(getActiveBook(otherId, book.id)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('should reject unknown book ids with BOOK_NOT_FOUND', async () => {
    await expect(getBook(ownerId, createId('book'))).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('should reject cross-user update with BOOK_NOT_FOUND', async () => {
    await expect(updateBook(otherId, book.id, { title: 'Hijacked' })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    const unchanged = db.select().from(schema.books).where(eq(schema.books.id, book.id)).get()
    expect(unchanged!.title).toBe('Test Book')
  })

  it('should reject cross-user trash/restore/permanent delete with BOOK_NOT_FOUND', async () => {
    await expect(trashBook(otherId, book.id)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(restoreBook(otherId, book.id)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(deleteBook(otherId, book.id)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    const stillThere = db.select().from(schema.books).where(eq(schema.books.id, book.id)).get()
    expect(stillThere).toBeDefined()
    expect(stillThere!.deletedAt).toBeNull()
  })
})

describe('deleteBook blob reference protection', () => {
  let db: ReturnType<typeof createTestDb>
  let mem: ReturnType<typeof createMemoryStorage>
  let userA: string
  let userB: string

  const sharedFile = 'blobs/ab/sharedhash.epub'
  const sharedCover = 'blobs/ab/sharedhash.cover.jpg'

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    mem = createMemoryStorage()
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)

    userA = seedUser(db, 'user-a')
    userB = seedUser(db, 'user-b')
    mem.files.set(sharedFile, Buffer.from('epub-bytes'))
    mem.files.set(sharedCover, Buffer.from('cover-bytes'))
  })

  it('should keep shared blobs until the last referencing book row is deleted', async () => {
    const bookA = seedBook(db, userA, { filePath: sharedFile, coverKey: sharedCover })
    const bookB = seedBook(db, userB, { filePath: sharedFile, coverKey: sharedCover })

    await deleteBook(userA, bookA.id)
    expect(mem.files.has(sharedFile)).toBe(true)
    expect(mem.files.has(sharedCover)).toBe(true)
    expect(db.select().from(schema.books).where(eq(schema.books.id, bookA.id)).get()).toBeUndefined()

    await deleteBook(userB, bookB.id)
    expect(mem.files.has(sharedFile)).toBe(false)
    expect(mem.files.has(sharedCover)).toBe(false)
  })

  it('should keep blobs referenced by a trashed book row', async () => {
    const bookA = seedBook(db, userA, { filePath: sharedFile })
    const bookB = seedBook(db, userB, { filePath: sharedFile, deletedAt: Date.now() })

    await deleteBook(userA, bookA.id)
    expect(mem.files.has(sharedFile)).toBe(true)

    await deleteBook(userB, bookB.id)
    expect(mem.files.has(sharedFile)).toBe(false)
  })

  it('should delete unshared blobs and the per-book progress file', async () => {
    const bookA = seedBook(db, userA, { filePath: sharedFile, coverKey: sharedCover })
    const progressKey = `progress/${bookA.id}.json`
    mem.files.set(progressKey, Buffer.from('{}'))

    await deleteBook(userA, bookA.id)
    expect(mem.files.has(sharedFile)).toBe(false)
    expect(mem.files.has(sharedCover)).toBe(false)
    expect(mem.files.has(progressKey)).toBe(false)
  })
})
