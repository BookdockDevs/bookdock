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
  purgeAllExpiredTrash,
  listBooks,
  setBookShelf,
  getBookShelf,
  uploadBook,
  reTocBook,
} from './books.service'
import { createTocRule } from '../toc-rules/toc-rules.service'

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

describe('uploadBook membership', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeAll(() => {
    registerParser(new TxtParser())
  })

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
  })

  it('persists the requested shelf and tags with a new book', async () => {
    const shelfId = createId('shelf')
    const tagId = createId('tag')
    db.insert(schema.shelves).values({ id: shelfId, userId: ownerId, name: '科幻', sortOrder: 0, createdAt: Date.now() }).run()
    db.insert(schema.tags).values({ id: tagId, userId: ownerId, name: '待读' }).run()

    const { book } = await uploadBook(ownerId, new File(['book content'], 'book.txt', { type: 'text/plain' }), {
      shelfId,
      tagIds: [tagId],
    })

    expect(book.shelfId).toBe(shelfId)
    expect(db.select().from(schema.bookTags).where(eq(schema.bookTags.bookId, book.id)).all()).toEqual([{ bookId: book.id, tagId }])
  })

  it('rejects membership owned by another user', async () => {
    const otherId = seedUser(db, 'other')
    const shelfId = createId('shelf')
    db.insert(schema.shelves).values({ id: shelfId, userId: otherId, name: 'Other', sortOrder: 0, createdAt: Date.now() }).run()

    await expect(
      uploadBook(ownerId, new File(['book content'], 'book.txt', { type: 'text/plain' }), { shelfId }),
    ).rejects.toMatchObject({ code: 'SHELF_NOT_FOUND' })
  })
})

describe('POST /api/v1/books upload membership', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let shelfId: string
  let tagId: string

  beforeAll(() => {
    registerParser(new TxtParser())
  })

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
    shelfId = createId('shelf')
    tagId = createId('tag')
    db.insert(schema.shelves).values({ id: shelfId, userId: ownerId, name: '科幻', sortOrder: 0, createdAt: Date.now() }).run()
    db.insert(schema.tags).values({ id: tagId, userId: ownerId, name: '待读' }).run()
  })

  function createUploadApp() {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => {
      c.set('user', { id: ownerId, username: 'owner', role: 'owner', avatarKey: null })
      return next()
    })
    app.route('/api/v1/books', booksRoutes)
    return app
  }

  it('assigns multipart upload membership before returning the new book', async () => {
    const body = new FormData()
    body.append('file', new File(['book content'], 'book.txt', { type: 'text/plain' }))
    body.append('shelfId', shelfId)
    body.append('tagIds', JSON.stringify([tagId]))

    const response = await createUploadApp().request('/api/v1/books', { method: 'POST', body })

    expect(response.status).toBe(201)
    const payload = await response.json() as { data: { id: string; shelfId: string } }
    expect(payload.data.shelfId).toBe(shelfId)
    expect(db.select().from(schema.bookTags).where(eq(schema.bookTags.bookId, payload.data.id)).all()).toEqual([{ bookId: payload.data.id, tagId }])
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

  it('matches author names too', async () => {
    seedBook(db, ownerId, { title: 'Dune', author: 'Frank Herbert' })
    const byAuthor = await listBooks(ownerId, 1, 20, 'frank')
    expect(byAuthor.data.map((b) => b.title)).toEqual(['Dune'])
  })
})

describe('listBooks metadata filters', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    ownerId = seedUser(db, 'owner')
  })

  it('filters authors by the exact stored value', async () => {
    const match = seedBook(db, ownerId, { title: 'Match', author: 'Author One' })
    seedBook(db, ownerId, { title: 'Partial', author: 'Author One and Two' })

    const result = await listBooks(ownerId, 1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Author One')

    expect(result.data.map((book) => book.id)).toEqual([match.id])
  })

  it('filters series values stored in book metadata', async () => {
    const match = seedBook(db, ownerId, { title: 'Match', meta: { bookmeta: { series: 'Series One' } } })
    seedBook(db, ownerId, { title: 'Other', meta: { bookmeta: { series: 'Series Two' } } })
    seedBook(db, ownerId, { title: 'No Series' })

    const result = await listBooks(ownerId, 1, 20, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'Series One')

    expect(result.data.map((book) => book.id)).toEqual([match.id])
  })
})

describe('listBooks lastReadAt sort', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
    // never-read books stay visible but sink below the read ones (NULLs last)
    seedBook(db, ownerId, { title: 'Never Read' })
    seedBook(db, ownerId, { title: 'Read First', lastReadAt: 1000 })
    seedBook(db, ownerId, { title: 'Read Later', lastReadAt: 2000 })
  })

  it('orders by lastReadAt desc with never-read books at the bottom', async () => {
    const result = await listBooks(ownerId, 1, 20, undefined, 'lastReadAt', 'desc')
    expect(result.data.map((b) => b.title)).toEqual(['Read Later', 'Read First', 'Never Read'])
  })

  it('does not filter out never-read books', async () => {
    const result = await listBooks(ownerId, 1, 20, undefined, 'lastReadAt', 'desc')
    expect(result.total).toBe(3)
  })

  it('honors sortOrder asc for lastReadAt', async () => {
    const result = await listBooks(ownerId, 1, 20, undefined, 'lastReadAt', 'asc')
    expect(result.data.map((b) => b.title)).toEqual(['Never Read', 'Read First', 'Read Later'])
  })

  it('leads with pinned books in lastReadAt sort; the pinned group follows last-read time', async () => {
    seedBook(db, ownerId, { title: 'Pinned Read First', lastReadAt: 1000, pinnedAt: 3000 })
    seedBook(db, ownerId, { title: 'Pinned Never Read', pinnedAt: 4000 })
    const result = await listBooks(ownerId, 1, 20, undefined, 'lastReadAt', 'desc')
    expect(result.data.map((b) => b.title)).toEqual([
      'Pinned Read First',
      'Pinned Never Read',
      'Read Later',
      'Read First',
      'Never Read',
    ])
  })

  it('orders the pinned group by the chosen sort, not the pin time', async () => {
    seedBook(db, ownerId, { title: 'Pinned Old', createdAt: 100, pinnedAt: 5000 })
    seedBook(db, ownerId, { title: 'Pinned New', createdAt: 200, pinnedAt: 1000 })
    const result = await listBooks(ownerId, 1, 20, undefined, 'createdAt', 'desc')
    expect(result.data.slice(0, 2).map((b) => b.title)).toEqual(['Pinned New', 'Pinned Old'])
  })
})

describe('listBooks createdAt sortOrder', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
    seedBook(db, ownerId, { title: 'Old', createdAt: 1000, updatedAt: 1000 })
    seedBook(db, ownerId, { title: 'New', createdAt: 2000, updatedAt: 2000 })
  })

  it('toggles between asc and desc for createdAt', async () => {
    const desc = await listBooks(ownerId, 1, 20, undefined, 'createdAt', 'desc')
    expect(desc.data.map((b) => b.title)).toEqual(['New', 'Old'])
    const asc = await listBooks(ownerId, 1, 20, undefined, 'createdAt', 'asc')
    expect(asc.data.map((b) => b.title)).toEqual(['Old', 'New'])
  })

  it('toggles between asc and desc for updatedAt', async () => {
    const desc = await listBooks(ownerId, 1, 20, undefined, 'updatedAt', 'desc')
    expect(desc.data.map((b) => b.title)).toEqual(['New', 'Old'])
    const asc = await listBooks(ownerId, 1, 20, undefined, 'updatedAt', 'asc')
    expect(asc.data.map((b) => b.title)).toEqual(['Old', 'New'])
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

describe('updateBook boundPresetId (per-book preset binding)', () => {
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

  it('stores the binding under meta.boundPresetId and overwrites it', async () => {
    await updateBook(ownerId, book.id, { boundPresetId: 'preset-a' })
    expect(metaOf().boundPresetId).toBe('preset-a')

    await updateBook(ownerId, book.id, { boundPresetId: 'preset-b' })
    expect(metaOf().boundPresetId).toBe('preset-b')
  })

  it('keeps unrelated meta keys when writing boundPresetId', async () => {
    await updateBook(ownerId, book.id, { viewSettings: { fontSize: 20 } })
    await updateBook(ownerId, book.id, { boundPresetId: 'preset-a' })
    const meta = metaOf()
    expect(meta.boundPresetId).toBe('preset-a')
    expect(meta.viewSettings).toEqual({ fontSize: 20 })
  })

  it('clears the binding with null so the book falls back to the device chain', async () => {
    await updateBook(ownerId, book.id, { boundPresetId: 'preset-a' })
    await updateBook(ownerId, book.id, { boundPresetId: null })
    expect(metaOf().boundPresetId).toBeUndefined()
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

describe('purgeAllExpiredTrash (boot sweep)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  let db: ReturnType<typeof createTestDb>
  let mem: ReturnType<typeof createMemoryStorage>

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    mem = createMemoryStorage()
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
  })

  it('purges expired trash across users with different retention settings in one pass', async () => {
    const a = seedUser(db, 'user-a')
    const b = seedUser(db, 'user-b')
    db.insert(schema.settings).values({ id: createId('setting'), userId: b, key: 'trash', value: { autoCleanDays: 7 } }).run()

    const oldA = seedBook(db, a, { deletedAt: Date.now() - 90 * DAY_MS })
    const oldB = seedBook(db, b, { deletedAt: Date.now() - 10 * DAY_MS })
    const freshB = seedBook(db, b, { deletedAt: Date.now() - 1 * DAY_MS })
    const activeA = seedBook(db, a)

    await purgeAllExpiredTrash()

    expect(db.select().from(schema.books).where(eq(schema.books.id, oldA.id)).get()).toBeUndefined()
    expect(db.select().from(schema.books).where(eq(schema.books.id, oldB.id)).get()).toBeUndefined()
    expect(db.select().from(schema.books).where(eq(schema.books.id, freshB.id)).get()).toBeDefined()
    expect(db.select().from(schema.books).where(eq(schema.books.id, activeA.id)).get()).toBeDefined()
  })

  it('respects auto-clean disabled (days <= 0) per user', async () => {
    const a = seedUser(db, 'user-a')
    db.insert(schema.settings).values({ id: createId('setting'), userId: a, key: 'trash', value: { autoCleanDays: 0 } }).run()
    const expired = seedBook(db, a, { deletedAt: Date.now() - 365 * DAY_MS })

    await purgeAllExpiredTrash()
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
      c.set('user', { id: userId, username: 'owner', role: 'owner', avatarKey: null })
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

describe('book shelf membership (single shelf)', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    ownerId = seedUser(db, 'owner')
  })

  function seedShelf(name: string, userId = ownerId) {
    const id = createId('shelf')
    db.insert(schema.shelves).values({ id, userId, name, sortOrder: 0, createdAt: Date.now() }).run()
    return id
  }

  it('sets, reads, and clears a book shelf', async () => {
    const book = seedBook(db, ownerId)
    const shelfId = seedShelf('A')
    expect(await getBookShelf(ownerId, book.id)).toBeNull()

    await setBookShelf(ownerId, book.id, shelfId)
    expect(await getBookShelf(ownerId, book.id)).toBe(shelfId)

    await setBookShelf(ownerId, book.id, null)
    expect(await getBookShelf(ownerId, book.id)).toBeNull()
  })

  it('rejects a shelf owned by another user', async () => {
    const book = seedBook(db, ownerId)
    const otherId = seedUser(db, 'other')
    const foreignShelf = seedShelf('Foreign', otherId)
    await expect(setBookShelf(ownerId, book.id, foreignShelf)).rejects.toMatchObject({ code: 'SHELF_NOT_FOUND' })
  })

  it('filters listBooks by shelfId and by the none sentinel', async () => {
    const shelfId = seedShelf('A')
    const onShelf = seedBook(db, ownerId, { shelfId })
    const uncategorized = seedBook(db, ownerId)

    const byShelf = await listBooks(ownerId, 1, 20, undefined, undefined, undefined, shelfId)
    expect(byShelf.total).toBe(1)
    expect(byShelf.data[0].id).toBe(onShelf.id)

    const byNone = await listBooks(ownerId, 1, 20, undefined, undefined, undefined, 'none')
    expect(byNone.total).toBe(1)
    expect(byNone.data[0].id).toBe(uncategorized.id)
  })
})

describe('listBooks shelfName and tags', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    ownerId = seedUser(db, 'owner')
  })

  function seedShelf(name: string) {
    const id = createId('shelf')
    db.insert(schema.shelves).values({ id, userId: ownerId, name, sortOrder: 0, createdAt: Date.now() }).run()
    return id
  }

  function seedTag(name: string) {
    const id = createId('tag')
    db.insert(schema.tags).values({ id, userId: ownerId, name }).run()
    return id
  }

  it('returns shelfName following shelfId and aggregates multiple tag names', async () => {
    const shelfId = seedShelf('Novels')
    const book = seedBook(db, ownerId, { shelfId })
    const tagA = seedTag('科幻')
    const tagB = seedTag('小说')
    db.insert(schema.bookTags).values([
      { bookId: book.id, tagId: tagA },
      { bookId: book.id, tagId: tagB },
    ]).run()

    const res = await listBooks(ownerId, 1, 20)
    const row = res.data.find((b) => b.id === book.id)!
    expect(row.shelfName).toBe('Novels')
    expect([...row.tags].sort()).toEqual(['小说', '科幻'])
  })

  it('returns null shelfName and empty tags for an uncategorized untagged book', async () => {
    seedBook(db, ownerId)

    const res = await listBooks(ownerId, 1, 20)
    expect(res.data[0].shelfName).toBeNull()
    expect(res.data[0].tags).toEqual([])
  })

  it('keeps one row per book when a book has multiple tags', async () => {
    const book = seedBook(db, ownerId)
    const tagA = seedTag('a')
    const tagB = seedTag('b')
    db.insert(schema.bookTags).values([
      { bookId: book.id, tagId: tagA },
      { bookId: book.id, tagId: tagB },
    ]).run()

    const res = await listBooks(ownerId, 1, 20)
    expect(res.total).toBe(1)
    expect(res.data).toHaveLength(1)
  })
})

describe('reTocBook', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  beforeAll(() => {
    registerParser(new TxtParser())
  })

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    ownerId = seedUser(db, 'owner')
  })

  // "第X章" is also easy to control: a rule with the same
  // regex still counts as a valid pin, so a clear pin-vs-null distinction is
  // observable via meta.tocRuleId/tocRuleAuto.
  function seedTxtBook(text: string) {
    return uploadBook(ownerId, new File([text], 'book.txt', { type: 'text/plain' }))
  }

  it('pins an explicit rule (tocRuleAuto=false) and re-splits by it', async () => {
    const rule = createTocRule(ownerId, {
      name: 'custom',
      patterns: [{ level: 1, regex: '^=== (.+)$', replacement: '$1' }],
    })
    const { book } = await seedTxtBook('序言\n\n=== 第一章\n\n正文一\n\n=== 第二章\n\n正文二')
    expect((book.meta as Record<string, unknown>).tocRuleId).toBeUndefined()

    await reTocBook(ownerId, book.id, rule.id)
    const updated = await getBook(ownerId, book.id)
    const meta = updated.meta as Record<string, unknown>
    expect(meta.tocRuleId).toBe(rule.id)
    expect(meta.tocRuleAuto).toBe(false)
    expect((meta.chapters as { title: string }[]).map((c) => c.title)).toEqual(['序章', '第一章', '第二章'])
  })

  it('null clears the pin and re-runs auto-scoring (tocRuleAuto=true when a rule wins)', async () => {
    const rule = createTocRule(ownerId, {
      name: 'auto-winner',
      patterns: [{ level: 1, regex: '^第[一二三四五六七八九十]+章 .+$' }],
    })
    // Long bodies so the custom chapter lines clear the >1000-char threshold
    const body = '正文内容'.repeat(300)
    const { book } = await seedTxtBook(
      `第一章 启程\n\n${body}\n\n第二章 旅途\n\n${body}\n\n第三章 归来\n\n${body}`,
    )
    // Auto-scoring already picked the rule at upload (it beats the default split)
    expect((book.meta as Record<string, unknown>).tocRuleId).toBe(rule.id)

    await reTocBook(ownerId, book.id, null)
    const updated = await getBook(ownerId, book.id)
    const meta = updated.meta as Record<string, unknown>
    expect(meta.tocRuleId).toBe(rule.id)
    expect(meta.tocRuleAuto).toBe(true)
  })

  it('clears the stale progress CFI when the re-split changes chapters', async () => {
    const { book } = await seedTxtBook('序言\n\n=== 第一章\n\n正文一\n\n=== 第二章\n\n正文二')
    // The rule is created after upload: auto-scoring at upload fell back to the
    // default split, so re-toc moves every chapter boundary.
    const rule = createTocRule(ownerId, {
      name: 'custom',
      patterns: [{ level: 1, regex: '^=== (.+)$', replacement: '$1' }],
    })

    const store = storage.getStorage()
    const progressKey = `progress/${book.id}.json`
    await store.put(progressKey, Buffer.from(JSON.stringify({
      cfi: 'chapter-0002.xhtml#epubcfi(/6/4/4)',
      chapter: '第一章',
      percent: 42,
      fraction: 0.42,
      intervals: [[0.1, 0.42]],
      rateSamples: [{ at: 1, seconds: 30 }],
      updatedAt: 123,
    }), 'utf-8'))

    await reTocBook(ownerId, book.id, rule.id)
    const stream = await store.get(progressKey)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    expect(data.cfi).toBeNull()
    expect(data.chapter).toBeNull()
    expect(data.percent).toBe(42)
    expect(data.intervals).toEqual([[0.1, 0.42]])
    expect(data.rateSamples).toEqual([{ at: 1, seconds: 30 }])
  })

  it('keeps the progress CFI when the re-split is unchanged', async () => {
    const rule = createTocRule(ownerId, {
      name: 'custom',
      patterns: [{ level: 1, regex: '^第[一二三四五六七八九十]+章 .+$' }],
    })
    const { book } = await seedTxtBook('第一章 启程\n\n正文一\n\n第二章 旅途\n\n正文二')
    const store = storage.getStorage()
    await reTocBook(ownerId, book.id, rule.id)

    const progressKey = `progress/${book.id}.json`
    await store.put(progressKey, Buffer.from(JSON.stringify({
      cfi: 'chapter-0001.xhtml#epubcfi(/6/4/4)',
      chapter: '第一章 启程',
      percent: 30,
      fraction: 0.3,
      updatedAt: 123,
    }), 'utf-8'))

    await reTocBook(ownerId, book.id, rule.id)
    const stream = await store.get(progressKey)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    expect(data.cfi).toBe('chapter-0001.xhtml#epubcfi(/6/4/4)')
  })

  it('rejects a foreign rule with TOC_RULE_NOT_FOUND', async () => {
    const otherId = seedUser(db, 'other')
    const rule = createTocRule(otherId, {
      name: 'theirs',
      patterns: [{ level: 1, regex: '^第.+章 .+$' }],
    })
    const { book } = await seedTxtBook('第一章 启程\n\n正文内容')
    await expect(reTocBook(ownerId, book.id, rule.id)).rejects.toMatchObject({ code: 'TOC_RULE_NOT_FOUND' })
  })

  it('rejects EPUB books with UNSUPPORTED_FORMAT', async () => {
    const epub = seedBook(db, ownerId, { format: 'epub' })
    await expect(reTocBook(ownerId, epub.id)).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
  })
})
