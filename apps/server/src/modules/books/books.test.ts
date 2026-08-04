import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { errorHandler } from '../../middleware/error'
import { createId } from '../../lib/id'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import booksRoutes from './books.routes'
import {
  getBook,
  getActiveBook,
  updateBook,
  trashBook,
  restoreBook,
  deleteBook,
  purgeExpiredTrash,
  listBooks,
  uploadBook,
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
    async get(key, range) {
      const buf = files.get(key)
      if (!buf) throw new Error(`missing blob: ${key}`)
      return Readable.from(range ? buf.subarray(range.start, range.end + 1) : buf)
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

describe('uploadBook dedup flag', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeAll(() => {
    // parsers are registered in app.ts at runtime; register here for service-level tests
    registerParser(new TxtParser())
  })

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
  })

  it('marks re-uploads as duplicated and returns the existing book', async () => {
    const file = new File(['hello world 123'], 'book.txt', { type: 'text/plain' })
    const first = await uploadBook(ownerId, file)
    expect(first.duplicated).toBe(false)

    const second = await uploadBook(ownerId, file)
    expect(second.duplicated).toBe(true)
    expect(second.book.id).toBe(first.book.id)
  })

  it('treats identical content from different users as separate rows but shared blob', async () => {
    const otherId = seedUser(db, 'other')
    const file = new File(['shared content abc'], 'book.txt', { type: 'text/plain' })
    const a = await uploadBook(ownerId, file)
    const b = await uploadBook(otherId, file)
    expect(b.duplicated).toBe(false)
    expect(b.book.id).not.toBe(a.book.id)
    expect(b.book.filePath).toBe(a.book.filePath)
  })

  it('persists bookmeta (empty for txt) so getBook never re-parses on first open', async () => {
    const file = new File(['chapter one text'], 'book.txt', { type: 'text/plain' })
    const { book } = await uploadBook(ownerId, file)
    expect((book.meta as Record<string, unknown>).bookmeta).toEqual({})

    // getBook would trigger a full-file re-parse if bookmeta were undefined;
    // with it persisted the row comes back as-is.
    const loaded = await getBook(ownerId, book.id)
    expect((loaded.meta as Record<string, unknown>).bookmeta).toEqual({})
  })
})

describe('listBooks search escaping', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
    seedBook(db, ownerId, { title: 'Progress 100%' })
    seedBook(db, ownerId, { title: 'Progress 100x' })
    seedBook(db, ownerId, { title: 'under_score' })
  })

  it('matches LIKE wildcard characters literally', async () => {
    const percent = await listBooks(ownerId, 1, 20, '100%')
    expect(percent.data.map((b) => b.title)).toEqual(['Progress 100%'])

    const underscore = await listBooks(ownerId, 1, 20, 'under_score')
    expect(underscore.data.map((b) => b.title)).toEqual(['under_score'])
  })

  it('does not treat a lone wildcard as match-all', async () => {
    const lonePercent = await listBooks(ownerId, 1, 20, '%')
    expect(lonePercent.data.map((b) => b.title)).toEqual(['Progress 100%'])
  })
})

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

describe('updateBook viewSettings (per-book reading settings)', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let book: ReturnType<typeof seedBook>

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
    book = seedBook(db, ownerId)
  })

  function metaOf() {
    const row = db.select().from(schema.books).where(eq(schema.books.id, book.id)).get()!
    return row.meta as Record<string, unknown>
  }

  it('stores the diff under meta.viewSettings, shallow-merging across calls', async () => {
    await updateBook(ownerId, book.id, { viewSettings: { fontSize: 24 } })
    expect(metaOf().viewSettings).toEqual({ fontSize: 24 })

    await updateBook(ownerId, book.id, { viewSettings: { lineHeight: 2.2 } })
    expect(metaOf().viewSettings).toEqual({ fontSize: 24, lineHeight: 2.2 })

    // Same key overwrites, others survive
    await updateBook(ownerId, book.id, { viewSettings: { fontSize: 28, pageWidth: 900, scrollPageWidth: 900 } })
    expect(metaOf().viewSettings).toEqual({ fontSize: 28, lineHeight: 2.2, pageWidth: 900, scrollPageWidth: 900 })
  })

  it('keeps unrelated meta keys when writing viewSettings', async () => {
    await updateBook(ownerId, book.id, { bookmeta: { publisher: 'ACME' } })
    await updateBook(ownerId, book.id, { viewSettings: { fontSize: 20 } })
    const meta = metaOf()
    expect(meta.viewSettings).toEqual({ fontSize: 20 })
    expect(meta.bookmeta).toEqual({ publisher: 'ACME' })
  })

  it('clears the whole override with null so the book falls back to global', async () => {
    await updateBook(ownerId, book.id, { viewSettings: { fontSize: 24, lineHeight: 2.2 } })
    await updateBook(ownerId, book.id, { viewSettings: null })
    expect(metaOf().viewSettings).toBeUndefined()
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

describe('purgeExpiredTrash', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string

  const DAY_MS = 24 * 60 * 60 * 1000

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    userId = seedUser(db, 'owner')
  })

  it('should purge trash rows older than the configured days', async () => {
    const expired = seedBook(db, userId, { deletedAt: Date.now() - 31 * DAY_MS })
    const recent = seedBook(db, userId, { deletedAt: Date.now() - 2 * DAY_MS })

    const purged = await purgeExpiredTrash(userId, 30)
    expect(purged).toBe(1)
    expect(db.select().from(schema.books).where(eq(schema.books.id, expired.id)).get()).toBeUndefined()
    expect(db.select().from(schema.books).where(eq(schema.books.id, recent.id)).get()).toBeDefined()
  })

  it('should not touch active books or other users trash', async () => {
    const otherId = seedUser(db, 'other')
    const active = seedBook(db, userId)
    const others = seedBook(db, otherId, { deletedAt: Date.now() - 90 * DAY_MS })

    await purgeExpiredTrash(userId, 30)
    expect(db.select().from(schema.books).where(eq(schema.books.id, active.id)).get()).toBeDefined()
    expect(db.select().from(schema.books).where(eq(schema.books.id, others.id)).get()).toBeDefined()
  })

  it('should skip purging entirely when days is 0 (never auto-clean)', async () => {
    const expired = seedBook(db, userId, { deletedAt: Date.now() - 365 * DAY_MS })

    const purged = await purgeExpiredTrash(userId, 0)
    expect(purged).toBe(0)
    expect(db.select().from(schema.books).where(eq(schema.books.id, expired.id)).get()).toBeDefined()
  })
})

describe('GET /api/v1/books/:id/file range requests', () => {
  let db: ReturnType<typeof createTestDb>
  let mem: ReturnType<typeof createMemoryStorage>
  let userId: string
  let book: ReturnType<typeof seedBook>

  // 100 bytes, byte value = offset, so range slices are easy to assert
  const blob = Buffer.from(Array.from({ length: 100 }, (_, i) => i))

  function createFileApp() {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('/api/v1/books/*', async (c, next) => {
      c.set('user', { id: userId, username: 'owner', role: 'owner' })
      return next()
    })
    app.route('/api/v1/books', booksRoutes)
    return app
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    mem = createMemoryStorage()
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
    userId = seedUser(db, 'owner')
    book = seedBook(db, userId)
    mem.files.set(book.filePath, blob)
  })

  it('serves the whole file with Accept-Ranges when no Range header is sent', async () => {
    const res = await createFileApp().request(`/api/v1/books/${book.id}/file`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Length')).toBe('100')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(blob)
  })

  it('serves an explicit range with 206 and Content-Range', async () => {
    const res = await createFileApp().request(`/api/v1/books/${book.id}/file`, {
      headers: { Range: 'bytes=0-9' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 0-9/100')
    expect(res.headers.get('Content-Length')).toBe('10')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(blob.subarray(0, 10))
  })

  it('serves an open-ended range (bytes=start-)', async () => {
    const res = await createFileApp().request(`/api/v1/books/${book.id}/file`, {
      headers: { Range: 'bytes=90-' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 90-99/100')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(blob.subarray(90))
  })

  it('serves a suffix range (bytes=-N)', async () => {
    const res = await createFileApp().request(`/api/v1/books/${book.id}/file`, {
      headers: { Range: 'bytes=-10' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 90-99/100')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(blob.subarray(90))
  })

  it('clamps an end beyond the blob size', async () => {
    const res = await createFileApp().request(`/api/v1/books/${book.id}/file`, {
      headers: { Range: 'bytes=95-999' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 95-99/100')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(blob.subarray(95))
  })

  it('rejects an out-of-bounds range with 416 and Content-Range */size', async () => {
    const res = await createFileApp().request(`/api/v1/books/${book.id}/file`, {
      headers: { Range: 'bytes=100-200' },
    })
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe('bytes */100')
  })

  it('rejects a malformed range with 416', async () => {
    const res = await createFileApp().request(`/api/v1/books/${book.id}/file`, {
      headers: { Range: 'bytes=20-10' },
    })
    expect(res.status).toBe(416)
    expect(res.headers.get('Content-Range')).toBe('bytes */100')
  })

  it('answers HEAD with the GET headers and no body', async () => {
    const res = await createFileApp().request(`/api/v1/books/${book.id}/file`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(res.headers.get('Content-Length')).toBe('100')
    expect(res.headers.get('Content-Type')).toBe('application/epub+zip')
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(0)
  })

  it('answers HEAD with a Range header as 206 and no body', async () => {
    const res = await createFileApp().request(`/api/v1/books/${book.id}/file`, {
      method: 'HEAD',
      headers: { Range: 'bytes=0-9' },
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 0-9/100')
    expect(res.headers.get('Content-Length')).toBe('10')
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(0)
  })
})
