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
import { deleteProgressFile, readProgressFile, writeProgressFile } from '../../lib/progress-file'
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
  let files: Map<string, Buffer>
  let ownerId: string
  let otherId: string
  let bookId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const memory = createMemoryStorage()
    files = memory.files
    vi.spyOn(storage, 'getStorage').mockReturnValue(memory.driver)

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

    // The real shape: a private library holding a work and a version. Fixtures
    // used to seed only the frozen legacy `books` row, which no longer exists
    // for a real instance - and which made the readability gate look correct
    // while it disagreed with the content route.
    bookId = createId('book')
    const libraryId = createId('lib')
    const workId = createId('lb')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'private', name: 'owner',
      description: '', visibility: null, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    db.insert(schema.libraryBooks).values({
      id: workId, libraryId, userId: ownerId, title: 'Test Book', author: 'Author',
      description: '', coverKey: null, categoryId: null, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    db.insert(schema.bookVersions).values({
      id: bookId, format: 'txt', size: 100, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: bookId, revisionNo: 1, blobKey: 'books/test/test.txt',
      size: 100, chapterCount: 1, meta: {}, createdAt: Date.now(),
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId, libraryBookId: workId, bookVersionId: bookId,
      kind: 'personal', status: 'published', name: '', createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
  })

  it('reads and writes progress for a library version nobody collected', async () => {
    // A public library publishing a version, read by a user who has no private
    // card for it. Reading is dimensioned by BookVersion, so the position is
    // kept exactly like a collected book - and this is the case that made the
    // reader refuse to open the book at all when the gate only knew about the
    // private library.
    const libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'public', createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    const workId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: workId, libraryId, userId: ownerId, title: 'City Book', author: '',
      description: '', coverKey: null, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    const versionId = createId('book')
    db.insert(schema.bookVersions).values({
      id: versionId, format: 'txt', size: 100,
      createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: versionId, revisionNo: 1,
      blobKey: 'blobs/aa/aa.txt', size: 100, chapterCount: 1, meta: {},
      createdAt: Date.now(),
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId, libraryBookId: workId, bookVersionId: versionId,
      kind: 'personal', status: 'published', name: '', createdAt: Date.now(), updatedAt: Date.now(),
    }).run()

    // Reading is allowed and "no position of mine here" is a normal answer, not
    // a failure - the reader used to refuse to open the book over this 404.
    expect(await getProgress(otherId, versionId)).toBeNull()
    // Writing is allowed too, without collecting first: a position is filed per
    // user (design invariant 14), so two readers of one version no longer share
    // a slot. This is the case that used to be refused to avoid cross-reader
    // corruption, and the storage layout is what fixed it.
    const written = await upsertProgress(otherId, versionId, { percent: 30, chapterIndex: 1 })
    expect(written.percent).toBe(30)
    expect((await getProgress(otherId, versionId))?.percent).toBe(30)

    // Collecting changes nothing about the position: it was already the
    // reader's own, and stays readable through the private card.
    const privateLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: privateLibraryId, userId: otherId, type: 'private', name: 'other', description: '',
      visibility: null, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    const privateWorkId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: privateWorkId, libraryId: privateLibraryId, userId: otherId, title: 'City Book',
      author: '', description: '', coverKey: null, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId: privateLibraryId, libraryBookId: privateWorkId,
      bookVersionId: versionId, kind: 'personal', status: 'published', name: '',
      createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    expect((await getProgress(otherId, versionId))?.percent).toBe(30)

    // Two readers of one version hold separate positions, which is the whole
    // point of filing them per user.
    const secondReaderId = createId('user')
    db.insert(schema.users).values({
      id: secondReaderId, username: 'second', passwordHash: null, role: 'user', createdAt: Date.now(),
    }).run()
    await upsertProgress(secondReaderId, versionId, { percent: 80 })
    expect((await getProgress(otherId, versionId))?.percent).toBe(30)
    expect((await getProgress(secondReaderId, versionId))?.percent).toBe(80)

    // A third reader with no position of their own inherits nobody's.
    const strangerId = createId('user')
    db.insert(schema.users).values({
      id: strangerId, username: 'stranger', passwordHash: null, role: 'user', createdAt: Date.now(),
    }).run()
    expect(await getProgress(strangerId, versionId)).toBeNull()

    // The gate is authorization, not a file lookup. Once the city is private,
    // the reader who collected the version keeps their position through their
    // own card, and one who only ever read it there loses access entirely.
    db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, libraryId)).run()
    expect((await getProgress(otherId, versionId))?.percent).toBe(30)
    await expect(getProgress(secondReaderId, versionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(upsertProgress(secondReaderId, versionId, { percent: 60 }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(getProgress(strangerId, versionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('migrates a pre-0.4.0 position file instead of losing it', async () => {
    // The real instance has 17 books whose positions were written when the
    // product was single-user. They must keep working, and must end up filed
    // per user so the next reader of that version cannot claim them.
    files.set(`progress/${bookId}.json`, Buffer.from(JSON.stringify({
      cfi: 'chapter:3:0.5', chapter: 'Ch4', chapterIndex: 3, percent: 42, fraction: 0.42,
      intervals: [[0, 0.42]], updatedAt: 1,
    })))

    const restored = await getProgress(ownerId, bookId)
    expect(restored).toMatchObject({ percent: 42, cfi: 'chapter:3:0.5', chapterIndex: 3 })

    // Read once more: the answer now comes from the user's own file, and the
    // legacy one is gone rather than left as an orphan that a second reader
    // could pick up.
    expect(files.has(`progress/${bookId}.json`)).toBe(false)
    expect(files.has(`progress/${ownerId}/${bookId}.json`)).toBe(true)
    expect(await getProgress(ownerId, bookId)).toMatchObject({ percent: 42 })

    // The owner keeps writing to their own file, and the migrated one is the
    // only one that exists for this book.
    await upsertProgress(ownerId, bookId, { percent: 55 })
    expect((await getProgress(ownerId, bookId))?.percent).toBe(55)
    expect([...files.keys()].filter((key) => key.startsWith('progress/'))).toEqual([
      `progress/${ownerId}/${bookId}.json`,
    ])
  })

  it('never hands a legacy position to a second reader', async () => {
    files.set(`progress/${bookId}.json`, Buffer.from(JSON.stringify({
      percent: 42, intervals: [[0, 0.42]], updatedAt: 1,
    })))
    // A reader who never owned the version sees nothing and leaves the file
    // alone: no adoption, no deletion.
    expect(await readProgressFile(otherId, bookId)).toBeNull()
    expect(files.has(`progress/${bookId}.json`)).toBe(true)
    // The owner adopts it on first sight; afterwards the readers are separate.
    expect(await readProgressFile(ownerId, bookId)).toMatchObject({ percent: 42 })
    expect(files.has(`progress/${bookId}.json`)).toBe(false)
    await writeProgressFile(otherId, bookId, { percent: 7, intervals: [], updatedAt: 2 })
    expect(await readProgressFile(ownerId, bookId)).toMatchObject({ percent: 42 })
    expect(await readProgressFile(otherId, bookId)).toMatchObject({ percent: 7 })
  })

  it('lets only the private owner delete a not-yet-migrated legacy file', async () => {
    files.set(`progress/${bookId}.json`, Buffer.from(JSON.stringify({
      percent: 42, intervals: [], updatedAt: 1,
    })))
    await deleteProgressFile(otherId, bookId)
    expect(files.has(`progress/${bookId}.json`)).toBe(true)
    await deleteProgressFile(ownerId, bookId)
    expect(files.has(`progress/${bookId}.json`)).toBe(false)
  })

  it('should upsert and read progress for the book owner', async () => {
    const saved = await upsertProgress(ownerId, bookId, { percent: 50, chapter: '第一章', chapterIndex: 2 })
    expect(saved.percent).toBe(50)
    expect(saved.chapterIndex).toBe(2)

    const loaded = await getProgress(ownerId, bookId)
    expect(loaded!.percent).toBe(50)
    expect(loaded!.chapterIndex).toBe(2)
  })

  it('mirrors the position into the version state row', async () => {
    await upsertProgress(ownerId, bookId, { percent: 50, chapter: '第一章', chapterIndex: 2 })
    const state = db.select().from(schema.bookStates)
      .where(eq(schema.bookStates.bookVersionId, bookId)).get()!
    expect(state.percent).toBe(50)
    expect(state.chapter).toBe('第一章')
    expect(state.lastReadAt).not.toBeNull()
  })

  it('should return null when the owner has no progress yet', async () => {
    expect(await getProgress(ownerId, bookId)).toBeNull()
  })

  it('should reject cross-user progress upsert with BOOK_NOT_FOUND', async () => {
    await expect(upsertProgress(otherId, bookId, { percent: 10 })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    // Nothing of the other reader's was written, and the owner's own state is
    // untouched by the attempt.
    expect(db.select().from(schema.bookStates)
      .where(eq(schema.bookStates.userId, otherId)).all()).toHaveLength(0)
    expect(db.select().from(schema.bookStates)
      .where(eq(schema.bookStates.userId, ownerId)).all()).toHaveLength(0)
  })

  it('should reject cross-user progress read with BOOK_NOT_FOUND', async () => {
    await upsertProgress(ownerId, bookId, { percent: 30 })
    await expect(getProgress(otherId, bookId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('should reject progress upsert for a trashed book', async () => {
    const work = db.select().from(schema.libraryBooks).get()!
    db.update(schema.libraryBooks).set({ deletedAt: Date.now() }).where(eq(schema.libraryBooks.id, work.id)).run()
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

  it('initializes coverage from percent when fraction is unavailable', async () => {
    await upsertProgress(ownerId, bookId, { percent: 30 })
    const loaded = await getProgress(ownerId, bookId)
    expect(loaded!.fraction).toBeNull()
    expect(loaded!.readFraction).toBeCloseTo(0.3)
  })
})
