import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { BOOK_STATE_PROGRESS_TAG, migrateBeforeBookRetirementIncluding as migrate } from '../../db/migration-stage'
import { and, eq, sql } from 'drizzle-orm'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readingRecordCreateSchema } from '@bookdock/shared'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import * as progressFile from '../../lib/progress-file'
import { importProgressFiles } from '../progress/progress-migration'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import {
  addReadingTime,
  computeStreak,
  deleteSession,
  getBookRecords,
  getByBook,
  getByTag,
  getDaily,
  getHourly,
  getSummary,
  updateSession,
} from './reading-records.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') }, [BOOK_STATE_PROGRESS_TAG])
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

function seedProgressFile(files: Map<string, Buffer>, userId: string, bookId: string, data: Record<string, unknown>) {
  files.set(`progress/${userId}/${bookId}.json`, Buffer.from(JSON.stringify(data), 'utf-8'))
}

async function loadProgressFile(files: Map<string, Buffer>, userId: string, bookId: string): Promise<Record<string, unknown>> {
  const data = await progressFile.readProgressFile(userId, bookId)
  if (data) return data as Record<string, unknown>
  const file = files.get(`progress/${userId}/${bookId}.json`)
  return file ? (JSON.parse(file.toString('utf-8')) as Record<string, unknown>) : {}
}

// New-model rows for rewired reads: private library, version reusing the
// book id, initial revision, work and card. Title/author mirror the legacy
// row, the way the migration preserves display metadata.
function seedVersion(db: ReturnType<typeof createTestDb>, userId: string, bookId: string, wordCount: number | null, title = 'B', author = '') {
  let library = db.select({ id: schema.libraries.id }).from(schema.libraries)
    .where(and(eq(schema.libraries.userId, userId), eq(schema.libraries.type, 'private'))).get()
  if (!library) {
    const libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId, type: 'private', name: userId,
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()
    library = { id: libraryId }
  }
  db.insert(schema.bookVersions).values({ id: bookId, format: 'txt', size: 100, createdAt: 1, updatedAt: 1 }).run()
  db.insert(schema.contentRevisions).values({
    id: createId('rev'), bookVersionId: bookId, revisionNo: 1, blobKey: `blobs/x/${bookId}.epub`,
    size: 100, wordCount, chapterCount: 0, meta: {}, createdAt: 1,
  }).run()
  const libraryBookId = createId('lb')
  db.insert(schema.libraryBooks).values({
    id: libraryBookId, libraryId: library.id, userId, title, author, createdAt: 1, updatedAt: 1,
  }).run()
  db.insert(schema.libraryBookVersions).values({
    id: createId('lbv'), libraryId: library.id, libraryBookId, bookVersionId: bookId,
    kind: 'personal', createdAt: 1, updatedAt: 1,
  }).run()
  return { libraryId: library.id, libraryBookId }
}

describe('reading-records service', () => {
  let db: ReturnType<typeof createTestDb>
  let files: Map<string, Buffer>
  let ownerId: string
  let otherId: string
  let bookId: string
  let book2Id: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const mem = createMemoryStorage()
    files = mem.files
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)

    ownerId = createId('user')
    db.insert(schema.users).values({ id: ownerId, username: 'owner', passwordHash: null, role: 'owner', createdAt: Date.now() }).run()
    otherId = createId('user')
    db.insert(schema.users).values({ id: otherId, username: 'other', passwordHash: null, role: 'owner', createdAt: Date.now() }).run()

    bookId = createId('book')
    db.insert(schema.books).values({
      id: bookId, userId: ownerId, title: 'Book One', author: 'Author A', format: 'txt',
      filePath: 'books/a/a.txt', coverKey: null, size: 100, meta: {}, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    book2Id = createId('book')
    db.insert(schema.books).values({
      id: book2Id, userId: ownerId, title: 'Book Two', author: 'Author B', format: 'epub',
      filePath: 'books/b/b.epub', coverKey: 'covers/b.jpg', size: 200, meta: {}, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    // Migrated reality: every book has library rows, and reading gates check
    // them — a legacy-only row is not a readable book (the reader itself
    // requires the version row).
    seedVersion(db, ownerId, bookId, 1000, 'Book One', 'Author A')
    const second = seedVersion(db, ownerId, book2Id, 500, 'Book Two', 'Author B')
    db.update(schema.libraryBooks).set({ coverKey: 'covers/b.jpg' }).where(eq(schema.libraryBooks.id, second.libraryBookId)).run()
  })

  it('accumulates duration for the same user+book+day and separates other days', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 60 })
    const row = await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 90 })
    expect(row?.durationSeconds).toBe(150)

    await addReadingTime(ownerId, { bookId, date: '2026-07-31', durationSeconds: 30 })
    const daily = await getDaily(ownerId, {})
    expect(daily).toEqual([
      { date: '2026-07-30', durationSeconds: 150 },
      { date: '2026-07-31', durationSeconds: 30 },
    ])
  })

  it('rejects recording time on another user\'s book with BOOK_NOT_FOUND', async () => {
    await expect(addReadingTime(otherId, { bookId, date: '2026-07-30', durationSeconds: 60 }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('excludes hidden books from aggregates unless revealed', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 60 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 90 })
    const work2 = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, book2Id)).get()!
    db.update(schema.libraryBooks).set({ hidden: true }).where(eq(schema.libraryBooks.id, work2.id)).run()

    expect((await getSummary(ownerId, '2026-07-30')).totalSeconds).toBe(60)
    expect((await getSummary(ownerId, '2026-07-30', true)).totalSeconds).toBe(150)
    expect((await getByBook(ownerId, {})).map((b) => b.bookId)).toEqual([bookId])
    expect((await getByBook(ownerId, {}, true)).map((b) => b.bookId).sort()).toEqual([bookId, book2Id].sort())
  })

  it('summarizes totals, today and streaks', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-29', durationSeconds: 100 })
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 200 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 300 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-31', durationSeconds: 50 })

    const summary = await getSummary(ownerId, '2026-07-31')
    expect(summary).toEqual({
      firstRecordedDate: '2026-07-29',
      totalSeconds: 650,
      totalBooks: 2,
      totalDays: 2,
      todaySeconds: 50,
      currentStreak: 2,
      longestStreak: 2,
      // All records fall inside the current week (Mon 2026-07-27) and month
      weekSeconds: 650,
      prevWeekSeconds: 0,
      monthSeconds: 650,
      prevMonthSeconds: 0,
      totalWordsRead: 0,
      scope: { longestStreak: 2, totalSeconds: 650, totalBooks: 2, totalDays: 2, totalWordsRead: 0, wordsPartial: false, finishedBooks: 0, finishedRounds: 0 },
      monthlyComparison: {
        currentPeriodSeconds: 650,
        previousPeriodSeconds: 0,
        currentPeriodBooks: 2,
        previousPeriodBooks: 0,
        currentPeriodDays: 2,
        previousPeriodDays: 0,
      },
    })

    const other = await getSummary(otherId, '2026-07-31')
    expect(other.totalSeconds).toBe(0)
    expect(other.currentStreak).toBe(0)
  })

  it('filters daily and by-book aggregates by range', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-01', durationSeconds: 100 })
    await addReadingTime(ownerId, { bookId, date: '2026-07-15', durationSeconds: 200 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-15', durationSeconds: 300 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-08-01', durationSeconds: 400 })

    const daily = await getDaily(ownerId, { from: '2026-07-01', to: '2026-07-31' })
    expect(daily).toEqual([
      { date: '2026-07-01', durationSeconds: 100 },
      { date: '2026-07-15', durationSeconds: 500 },
    ])

    const byBook = await getByBook(ownerId, {})
    expect(byBook.map((b) => b.bookId)).toEqual([book2Id, bookId])
    expect(byBook[0]).toMatchObject({ title: 'Book Two', author: 'Author B', coverKey: 'covers/b.jpg', durationSeconds: 700 })
  })

  it('counts each version once and uses the caller private metadata across multiple libraries', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-10-03', durationSeconds: 90 })
    const libraryId = createId('lib')
    const workId = createId('lb')
    db.insert(schema.libraries).values({
      id: libraryId, userId: otherId, type: 'private', name: 'Other private library', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryBooks).values({
      id: workId, libraryId, userId: otherId, title: 'Other private title', author: 'Private author', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId, libraryBookId: workId, bookVersionId: bookId, kind: 'personal', createdAt: 1, updatedAt: 1,
    }).run()
    expect(await getByBook(ownerId, {})).toEqual([
      expect.objectContaining({ bookId, title: 'Book One', author: 'Author A', durationSeconds: 90, days: 1 }),
    ])
  })

  it('writes one session row per report, falling back to receive time for startedAt', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 60, startedAt: 1785000000000 })
    const before = Date.now()
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 90 })
    const after = Date.now()

    const sessions = db.select().from(schema.readingSessions)
      .orderBy(schema.readingSessions.startedAt).all()
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({
      userId: ownerId, bookId, date: '2026-07-30', startedAt: 1785000000000, durationSeconds: 60,
    })
    expect(sessions[1].startedAt).toBeGreaterThanOrEqual(before)
    expect(sessions[1].startedAt).toBeLessThanOrEqual(after)
  })

  it('persists manual-mode session bounds (endedAt/startCfi/endCfi) while auto rows leave them null', async () => {
    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 120, startedAt: 1785000000000,
      endedAt: 1785000120000, startCfi: 'epubcfi(/6/4!/4/2)', endCfi: 'epubcfi(/6/4!/4/10)',
    })
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 60 })

    const sessions = db.select().from(schema.readingSessions).all()
    const manual = sessions.find((s) => s.startCfi !== null)!
    expect(manual).toMatchObject({
      endedAt: 1785000120000,
      startCfi: 'epubcfi(/6/4!/4/2)',
      endCfi: 'epubcfi(/6/4!/4/10)',
    })
    const auto = sessions.find((s) => s.startCfi === null)!
    expect(auto.endedAt).toBeNull()
    expect(auto.endCfi).toBeNull()
  })

  it('persists all manual bounds units (fraction + chapter index)', async () => {
    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 120, startedAt: 1785000000000, endedAt: 1785000120000,
      startFraction: 0.2, endFraction: 0.35, startChapterIndex: 3, endChapterIndex: 5,
    })
    const session = db.select().from(schema.readingSessions).get()!
    expect(session).toMatchObject({
      startFraction: 0.2, endFraction: 0.35, startChapterIndex: 3, endChapterIndex: 5,
    })
  })

  it('updateSession adjusts the same-day aggregate by the duration delta', async () => {
    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 600, startedAt: 1785000000000, endedAt: 1785000600000,
    })
    const session = db.select().from(schema.readingSessions).get()!
    await updateSession(ownerId, session.id, { durationSeconds: 240 })
    const record = db.select().from(schema.readingRecords).where(eq(schema.readingRecords.date, '2026-07-30')).get()!
    expect(record.durationSeconds).toBe(240)
    const updated = db.select().from(schema.readingSessions).get()!
    expect(updated.durationSeconds).toBe(240)
  })

  it('updateSession re-attributes the aggregate when the session moves to another day', async () => {
    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 600, startedAt: 1785000000000, endedAt: 1785000600000,
    })
    const session = db.select().from(schema.readingSessions).get()!
    // moved to 2026-07-31 with a longer duration
    await updateSession(ownerId, session.id, {
      durationSeconds: 900, startedAt: 1785086400000, endedAt: 1785087300000, date: '2026-07-31',
    })
    const oldDay = db.select().from(schema.readingRecords).where(eq(schema.readingRecords.date, '2026-07-30')).get()
    expect(oldDay).toBeUndefined()
    const newDay = db.select().from(schema.readingRecords).where(eq(schema.readingRecords.date, '2026-07-31')).get()!
    expect(newDay.durationSeconds).toBe(900)
  })

  it('deleteSession decrements the aggregate and removes the row (and the record at zero)', async () => {
    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 600, startedAt: 1785000000000, endedAt: 1785000600000,
    })
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 200 })
    const session = db.select().from(schema.readingSessions)
      .where(sql`${schema.readingSessions.endedAt} IS NOT NULL`).get()!
    await deleteSession(ownerId, session.id)
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(1)
    const record = db.select().from(schema.readingRecords).get()!
    expect(record.durationSeconds).toBe(200)
  })

  it('allows deleting auto-mode sessions but rejects editing them and accessing foreign sessions', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 60, source: 'auto' })
    const auto = db.select().from(schema.readingSessions).get()!
    await expect(updateSession(ownerId, auto.id, { durationSeconds: 120 }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await deleteSession(ownerId, auto.id)
    expect(db.select().from(schema.readingSessions).where(eq(schema.readingSessions.id, auto.id)).get()).toBeUndefined()

    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 60, startedAt: 1785000000000, endedAt: 1785000600000,
    })
    const manual = db.select().from(schema.readingSessions)
      .where(sql`${schema.readingSessions.endedAt} IS NOT NULL`).get()!
    await expect(updateSession(otherId, manual.id, { durationSeconds: 120 }))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
  })

  it('counts per-book reading days after sixty seconds while retaining shorter durations', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 60 })
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 90 })
    await addReadingTime(ownerId, { bookId, date: '2026-07-31', durationSeconds: 30 })

    const byBook = await getByBook(ownerId, {})
    expect(byBook).toHaveLength(1)
    expect(byBook[0]).toMatchObject({ days: 1, durationSeconds: 180, readStatus: 'reading' })
    await addReadingTime(ownerId, { bookId, date: '2026-07-31', durationSeconds: 30 })
    expect((await getByBook(ownerId, {}))[0]).toMatchObject({ days: 2, durationSeconds: 210 })
  })

  it('returns per-book totals and descending daily records', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 100 })
    await addReadingTime(ownerId, { bookId, date: '2026-07-31', durationSeconds: 200 })

    const detail = await getBookRecords(ownerId, bookId)
    expect(detail.totalSeconds).toBe(300)
    expect(detail.records).toEqual([
      { date: '2026-07-31', durationSeconds: 200 },
      { date: '2026-07-30', durationSeconds: 100 },
    ])

    await expect(getBookRecords(otherId, bookId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('aggregates session duration by client-local hour of day', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 100, startedAt: Date.UTC(2026, 6, 30, 15, 10, 0) })
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 50, startedAt: Date.UTC(2026, 6, 30, 15, 40, 0) })
    await addReadingTime(ownerId, { bookId, date: '2026-07-31', durationSeconds: 70, startedAt: Date.UTC(2026, 6, 31, 2, 0, 0) })

    const utc = await getHourly(ownerId, {}, 0)
    expect(utc).toEqual([
      { hour: 2, durationSeconds: 70, days: 1 },
      { hour: 15, durationSeconds: 150, days: 1 },
    ])

    // UTC+8 (getTimezoneOffset() = -480): 15:00 UTC -> 23:00 local
    const utc8 = await getHourly(ownerId, {}, -480)
    expect(utc8).toEqual([
      { hour: 10, durationSeconds: 70, days: 1 },
      { hour: 23, durationSeconds: 150, days: 1 },
    ])

    const ranged = await getHourly(ownerId, { from: '2026-07-30', to: '2026-07-30' }, 0)
    expect(ranged).toEqual([{ hour: 15, durationSeconds: 150, days: 1 }])
  })

  it('filters hourly distribution by bookId', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 100, startedAt: Date.UTC(2026, 6, 30, 15, 0, 0) })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 200, startedAt: Date.UTC(2026, 6, 30, 21, 0, 0) })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 50, startedAt: Date.UTC(2026, 6, 30, 21, 30, 0) })

    const all = await getHourly(ownerId, {}, 0)
    expect(all).toEqual([
      { hour: 15, durationSeconds: 100, days: 1 },
      { hour: 21, durationSeconds: 250, days: 1 },
    ])

    const bookOnly = await getHourly(ownerId, { bookId: book2Id }, 0)
    expect(bookOnly).toEqual([{ hour: 21, durationSeconds: 250, days: 1 }])

    const otherUser = await getHourly(otherId, { bookId: book2Id }, 0)
    expect(otherUser).toEqual([])
  })

  it('stores retroactive entries with null startedAt and skips them in hourly views', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 600, startedAt: null, endedAt: 1785000600000 })

    const session = db.select().from(schema.readingSessions).get()!
    expect(session.startedAt).toBeNull()
    expect(session.endedAt).toBe(1785000600000)
    // endedAt set → still a manual session, daily aggregate updated
    const record = db.select().from(schema.readingRecords).get()!
    expect(record.durationSeconds).toBe(600)

    // no start time → no hour to attribute to
    expect(await getHourly(ownerId, {}, 0)).toEqual([])
  })

  it('merges retroactive start/end fractions into the interval union without touching the position', async () => {
    seedProgressFile(files, ownerId, bookId, {
      cfi: 'epubcfi(/6/4!/4/2)', chapter: 'ch1', percent: 42, fraction: 0.42,
      intervals: [[0.1, 0.2]], updatedAt: 1,
    })
    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 600, startedAt: null, endedAt: 1785000600000,
      startFraction: 0.15, endFraction: 0.3,
    })

    const saved = await loadProgressFile(files, ownerId, bookId)
    expect(saved.intervals).toEqual([[0.1, 0.3]])
    expect(saved.cfi).toBe('epubcfi(/6/4!/4/2)')
    expect(saved.percent).toBe(42)
    // the library row (progress/lastReadAt) is not touched either
    const book = db.select().from(schema.books).where(eq(schema.books.id, bookId)).get()!
    expect(book.progress).toBe(0)
    expect(book.lastReadAt).toBeNull()
  })

  it('creates an intervals-only progress file for retroactive fractions on an unopened book', async () => {
    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 600, startedAt: null, endedAt: 1785000600000,
      startFraction: 0.2, endFraction: 0.35,
    })
    const saved = await loadProgressFile(files, ownerId, bookId)
    expect(saved.intervals).toEqual([[0.2, 0.35]])
    expect(saved.cfi ?? null).toBeNull()
    expect(saved.percent).toBe(0)
  })

  it('rejects invalid retroactive payloads at the schema level', () => {
    const base = { bookId: 'b1', date: '2026-07-30', durationSeconds: 600 }
    // Backward reading preserves a valid recorded traversal.
    expect(readingRecordCreateSchema.safeParse({ ...base, startFraction: 0.5, endFraction: 0.4 }).success).toBe(true)
    expect(readingRecordCreateSchema.safeParse({ ...base, startFraction: 0.4, endFraction: 0.5 }).success).toBe(true)
    // duration must be positive
    expect(readingRecordCreateSchema.safeParse({ ...base, durationSeconds: 0 }).success).toBe(false)
    // explicit null startedAt requires endedAt (otherwise the row would be an immutable auto block)
    expect(readingRecordCreateSchema.safeParse({ ...base, startedAt: null }).success).toBe(false)
    expect(readingRecordCreateSchema.safeParse({ ...base, startedAt: null, endedAt: 1785000600000 }).success).toBe(true)
    // existing auto-report shape stays valid
    expect(readingRecordCreateSchema.safeParse({ ...base, startedAt: 1785000000000 }).success).toBe(true)
  })

  it('reports week-over-week and month-over-month totals around client-local boundaries', async () => {
    // today = Friday 2026-07-31 → this week starts Mon 07-27, this month 07-01
    await addReadingTime(ownerId, { bookId, date: '2026-07-28', durationSeconds: 100 }) // this week
    await addReadingTime(ownerId, { bookId, date: '2026-07-31', durationSeconds: 50 }) // this week
    await addReadingTime(ownerId, { bookId, date: '2026-07-22', durationSeconds: 70 }) // prev week
    await addReadingTime(ownerId, { bookId, date: '2026-07-05', durationSeconds: 30 }) // this month, before prev week
    await addReadingTime(ownerId, { bookId, date: '2026-06-15', durationSeconds: 90 }) // prev month

    const summary = await getSummary(ownerId, '2026-07-31')
    expect(summary.weekSeconds).toBe(150)
    expect(summary.prevWeekSeconds).toBe(70)
    expect(summary.monthSeconds).toBe(250)
    expect(summary.prevMonthSeconds).toBe(90)
  })

  it('sums readFraction × wordCount and skips books without word counts', async () => {
    seedProgressFile(files, ownerId, bookId, { percent: 50, fraction: 0.5, intervals: [[0.1, 0.4], [0.4, 0.6]], updatedAt: 1 })
    seedProgressFile(files, ownerId, book2Id, { percent: 80, fraction: 0.8, intervals: [[0, 0.8]], updatedAt: 1 })

    const summary = await getSummary(ownerId, '2026-07-31')
    expect(summary.totalWordsRead).toBe(900)

    // no wordCount in the revision → skipped
    db.update(schema.contentRevisions).set({ wordCount: null }).where(eq(schema.contentRevisions.bookVersionId, bookId)).run()
    expect((await getSummary(ownerId, '2026-07-31')).totalWordsRead).toBe(400)
  })

  it('aggregates reading time by tag, excluding untagged books and honoring the range', async () => {
    const tagA = createId('tag')
    const tagB = createId('tag')
    const libraryId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, ownerId), eq(schema.libraries.type, 'private'))).get()!.id
    db.insert(schema.libraryTags).values([
      { id: tagA, libraryId, userId: ownerId, name: 'Fiction', createdAt: 1, updatedAt: 1 },
      { id: tagB, libraryId, userId: ownerId, name: 'Tech', createdAt: 1, updatedAt: 1 },
    ]).run()
    const lbvOf = (id: string) => db.select({ libraryBookId: schema.libraryBookVersions.libraryBookId })
      .from(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.bookVersionId, id)).get()!
    db.insert(schema.libraryBookTags).values([
      { libraryBookId: lbvOf(bookId).libraryBookId, tagId: tagA },
      { libraryBookId: lbvOf(book2Id).libraryBookId, tagId: tagB },
    ]).run()
    const book3Id = createId('book')
    db.insert(schema.books).values({
      id: book3Id, userId: ownerId, title: 'Book Three', author: '', format: 'txt',
      filePath: 'books/c/c.txt', coverKey: null, size: 100, meta: {}, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()
    seedVersion(db, ownerId, book3Id, null)

    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 500 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 900 })
    await addReadingTime(ownerId, { bookId: book3Id, date: '2026-07-30', durationSeconds: 5000 }) // untagged
    await addReadingTime(ownerId, { bookId, date: '2026-06-01', durationSeconds: 77 }) // outside the range below

    const byTag = await getByTag(ownerId, {})
    expect(byTag).toEqual([
      { tagId: tagB, name: 'Tech', durationSeconds: 900, bookCount: 1 },
      { tagId: tagA, name: 'Fiction', durationSeconds: 577, bookCount: 1 },
    ])

    const ranged = await getByTag(ownerId, { from: '2026-07-01', to: '2026-07-31' })
    expect(ranged).toEqual([
      { tagId: tagB, name: 'Tech', durationSeconds: 900, bookCount: 1 },
      { tagId: tagA, name: 'Fiction', durationSeconds: 500, bookCount: 1 },
    ])

    expect(await getByTag(otherId, {})).toEqual([])
  })

  describe('computeStreak', () => {
    it('counts a current streak ending today or yesterday', () => {
      expect(computeStreak(['2026-07-29', '2026-07-30', '2026-07-31'], '2026-07-31'))
        .toEqual({ current: 3, longest: 3 })
      expect(computeStreak(['2026-07-29', '2026-07-30'], '2026-07-31'))
        .toEqual({ current: 2, longest: 2 })
    })

    it('resets the current streak after a gap but keeps the longest', () => {
      expect(computeStreak(['2026-07-01', '2026-07-02', '2026-07-10'], '2026-07-31'))
        .toEqual({ current: 0, longest: 2 })
    })

    it('handles empty input and single days', () => {
      expect(computeStreak([], '2026-07-31')).toEqual({ current: 0, longest: 0 })
      expect(computeStreak(['2026-07-31'], '2026-07-31')).toEqual({ current: 1, longest: 1 })
    })
  })

  it('computes total words read without dropping books on different revision counts', async () => {
    const b1 = createId('book')
    const b2 = createId('book')
    seedVersion(db, ownerId, b1, null, 'Book 1')
    seedVersion(db, ownerId, b2, null, 'Book 2')

    // Insert revision 2 for b1
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: b1, revisionNo: 2, blobKey: 'blobs/b1-2.txt',
      size: 1000, wordCount: 1000, chapterCount: 1, meta: {}, createdAt: Date.now(),
    }).run()

    // Set revision 1 word count for b2
    db.update(schema.contentRevisions).set({ wordCount: 400 })
      .where(and(eq(schema.contentRevisions.bookVersionId, b2), eq(schema.contentRevisions.revisionNo, 1))).run()

    // Set readFraction = 1.0 for both
    db.insert(schema.bookStates).values([
      { userId: ownerId, bookVersionId: b1, readStatus: 'reading', percent: 100, readFraction: 1.0, updatedAt: Date.now() },
      { userId: ownerId, bookVersionId: b2, readStatus: 'reading', percent: 100, readFraction: 1.0, updatedAt: Date.now() },
    ]).run()

    const summary = await getSummary(ownerId, '2026-07-31')
    expect(summary.totalWordsRead).toBe(1400)
  })

  it('rolls back sessions and aggregates atomically if projection persistence fails', async () => {
    const b = createId('book')
    db.insert(schema.books).values({
      id: b,
      userId: ownerId,
      title: 'Atomic Book',
      format: 'txt',
      filePath: 'books/b/b.txt',
      size: 100,
      meta: {},
      createdAt: 1,
      updatedAt: 1,
    }).run()
    seedVersion(db, ownerId, b, 100, 'Atomic Book')

    db.run(sql.raw(`CREATE TRIGGER reading_projection_failure BEFORE INSERT ON reading_records
      WHEN NEW.book_id = '${b}' BEGIN SELECT RAISE(ABORT, 'injected projection failure'); END`))

    await expect(addReadingTime(ownerId, {
      bookId: b,
      date: '2026-07-31',
      durationSeconds: 300,
      startFraction: 0.1,
      endFraction: 0.2,
    })).rejects.toThrow('injected projection failure')

    // Neither readingRecords nor readingSessions should have been committed
    const records = db.select().from(schema.readingRecords).where(eq(schema.readingRecords.bookId, b)).all()
    expect(records).toHaveLength(0)
    const sessions = db.select().from(schema.readingSessions).where(eq(schema.readingSessions.bookId, b)).all()
    expect(sessions).toHaveLength(0)

    db.run(sql.raw('DROP TRIGGER reading_projection_failure'))
  })

  it('does not touch storage.exists for unread books across repeated getSummary requests', async () => {
    await importProgressFiles(db)
    const unread1 = createId('book')
    const unread2 = createId('book')
    seedVersion(db, ownerId, unread1, 500, 'Unread 1')
    seedVersion(db, ownerId, unread2, 500, 'Unread 2')

    const spyExists = vi.spyOn(storage.getStorage(), 'exists')

    await getSummary(ownerId, '2026-07-31')
    await getSummary(ownerId, '2026-07-31')

    expect(spyExists).not.toHaveBeenCalled()
    spyExists.mockRestore()
  })
  it('uses scoped qualifying dates for streaks and viewing-zone boundaries for completed rounds', async () => {
    for (const date of ['2026-07-28', '2026-07-29', '2026-07-31']) {
      await addReadingTime(ownerId, { bookId, date, durationSeconds: 120 })
    }
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-31', durationSeconds: 30 })
    db.update(schema.readingRounds).set({ status: 'finished', endedAt: Date.parse('2026-07-30T17:00:00Z') }).where(eq(schema.readingRounds.bookVersionId, bookId)).run()
    db.update(schema.readingRounds).set({ status: 'finished', endedAt: Date.parse('2026-07-31T16:00:00Z') }).where(eq(schema.readingRounds.bookVersionId, book2Id)).run()
    const range = { from: '2026-07-29', to: '2026-07-31', timezone: 'Asia/Shanghai' }
    const summary = await getSummary(ownerId, '2026-07-31', false, range)
    expect(summary.longestStreak).toBe(2)
    expect(summary.scope).toMatchObject({ longestStreak: 1, totalSeconds: 270, totalDays: 2, finishedBooks: 1, finishedRounds: 1 })
    const detail = await getBookRecords(ownerId, bookId, false, range)
    expect(detail.totalSeconds).toBe(240)
    expect(detail.records.map((record) => record.date)).toEqual(['2026-07-31', '2026-07-29'])
    expect((await getSummary(otherId, '2026-07-31', false, range)).scope).toMatchObject({ longestStreak: 0, totalSeconds: 0, finishedRounds: 0 })
  })

})
