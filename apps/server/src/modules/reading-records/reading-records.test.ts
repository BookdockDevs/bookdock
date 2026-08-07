import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq, sql } from 'drizzle-orm'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readingRecordCreateSchema } from '@bookdock/shared'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import {
  addReadingTime,
  computeStreak,
  deleteSession,
  getBookDetail,
  getBookRecords,
  getByBook,
  getByTag,
  getDaily,
  getHourly,
  getSummary,
  listSessions,
  updateSession,
} from './reading-records.service'

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

function seedProgressFile(files: Map<string, Buffer>, bookId: string, data: Record<string, unknown>) {
  files.set(`progress/${bookId}.json`, Buffer.from(JSON.stringify(data), 'utf-8'))
}

function loadProgressFile(files: Map<string, Buffer>, bookId: string): Record<string, unknown> {
  return JSON.parse(files.get(`progress/${bookId}.json`)!.toString('utf-8')) as Record<string, unknown>
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

  it('summarizes totals, today and streaks', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-29', durationSeconds: 100 })
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 200 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 300 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-31', durationSeconds: 50 })

    const summary = await getSummary(ownerId, '2026-07-31')
    expect(summary).toEqual({
      totalSeconds: 650,
      totalBooks: 2,
      totalDays: 3,
      todaySeconds: 50,
      currentStreak: 3,
      longestStreak: 3,
      // All records fall inside the current week (Mon 2026-07-27) and month
      weekSeconds: 650,
      prevWeekSeconds: 0,
      monthSeconds: 650,
      prevMonthSeconds: 0,
      totalWordsRead: 0,
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

  it('lists manual sessions per book, newest first, with limit/offset; auto blocks excluded', async () => {
    for (const [i, startedAt] of [1785000000000, 1785003600000, 1785007200000].entries()) {
      await addReadingTime(ownerId, {
        bookId, date: '2026-07-30', durationSeconds: 60 + i, startedAt, endedAt: startedAt + 60000,
      })
    }
    // auto block must never appear in the session list
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 45 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 60, startedAt: 1785007200000, endedAt: 1785007260000 })
    const all = await listSessions(ownerId, bookId, 50, 0)
    expect(all).toHaveLength(3)
    expect(all[0].startedAt).toBe(1785007200000)
    expect(all[2].startedAt).toBe(1785000000000)
    const page = await listSessions(ownerId, bookId, 2, 1)
    expect(page.map((s) => s.startedAt)).toEqual([1785003600000, 1785000000000])
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

  it('rejects editing or deleting auto-mode sessions and foreign sessions', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 60 })
    const auto = db.select().from(schema.readingSessions).get()!
    await expect(updateSession(ownerId, auto.id, { durationSeconds: 120 }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(deleteSession(ownerId, auto.id))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 60, startedAt: 1785000000000, endedAt: 1785000600000,
    })
    const manual = db.select().from(schema.readingSessions)
      .where(sql`${schema.readingSessions.endedAt} IS NOT NULL`).get()!
    await expect(updateSession(otherId, manual.id, { durationSeconds: 120 }))
      .rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' })
  })

  it('reports days read and readStatus per book', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 60 })
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 90 })
    await addReadingTime(ownerId, { bookId, date: '2026-07-31', durationSeconds: 30 })

    const byBook = await getByBook(ownerId, {})
    expect(byBook).toHaveLength(1)
    expect(byBook[0]).toMatchObject({ days: 2, readStatus: 'reading' })
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
      { hour: 2, durationSeconds: 70 },
      { hour: 15, durationSeconds: 150 },
    ])

    // UTC+8 (getTimezoneOffset() = -480): 15:00 UTC -> 23:00 local
    const utc8 = await getHourly(ownerId, {}, -480)
    expect(utc8).toEqual([
      { hour: 10, durationSeconds: 70 },
      { hour: 23, durationSeconds: 150 },
    ])

    const ranged = await getHourly(ownerId, { from: '2026-07-30', to: '2026-07-30' }, 0)
    expect(ranged).toEqual([{ hour: 15, durationSeconds: 150 }])
  })

  it('filters hourly distribution by bookId', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 100, startedAt: Date.UTC(2026, 6, 30, 15, 0, 0) })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 200, startedAt: Date.UTC(2026, 6, 30, 21, 0, 0) })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 50, startedAt: Date.UTC(2026, 6, 30, 21, 30, 0) })

    const all = await getHourly(ownerId, {}, 0)
    expect(all).toEqual([
      { hour: 15, durationSeconds: 100 },
      { hour: 21, durationSeconds: 250 },
    ])

    const bookOnly = await getHourly(ownerId, { bookId: book2Id }, 0)
    expect(bookOnly).toEqual([{ hour: 21, durationSeconds: 250 }])

    const otherUser = await getHourly(otherId, { bookId: book2Id }, 0)
    expect(otherUser).toEqual([])
  })

  it('stores retroactive entries with null startedAt, skipped by hourly and the legacy session list', async () => {
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 600, startedAt: null, endedAt: 1785000600000 })

    const session = db.select().from(schema.readingSessions).get()!
    expect(session.startedAt).toBeNull()
    expect(session.endedAt).toBe(1785000600000)
    // endedAt set → still a manual session, daily aggregate updated
    const record = db.select().from(schema.readingRecords).get()!
    expect(record.durationSeconds).toBe(600)

    // no start time → no hour to attribute to
    expect(await getHourly(ownerId, {}, 0)).toEqual([])
    // the legacy session list assumes non-null startedAt; the mixed detail feed carries it instead
    expect(await listSessions(ownerId, bookId, 50, 0)).toEqual([])
  })

  it('merges retroactive start/end fractions into the interval union without touching the position', async () => {
    seedProgressFile(files, bookId, {
      cfi: 'epubcfi(/6/4!/4/2)', chapter: 'ch1', percent: 42, fraction: 0.42,
      intervals: [[0.1, 0.2]], updatedAt: 1,
    })
    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 600, startedAt: null, endedAt: 1785000600000,
      startFraction: 0.15, endFraction: 0.3,
    })

    const saved = loadProgressFile(files, bookId)
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
    const saved = loadProgressFile(files, bookId)
    expect(saved.intervals).toEqual([[0.2, 0.35]])
    expect(saved.cfi).toBeNull()
    expect(saved.percent).toBe(0)
  })

  it('rejects invalid retroactive payloads at the schema level', () => {
    const base = { bookId: 'b1', date: '2026-07-30', durationSeconds: 600 }
    // endFraction must be >= startFraction
    expect(readingRecordCreateSchema.safeParse({ ...base, startFraction: 0.5, endFraction: 0.4 }).success).toBe(false)
    expect(readingRecordCreateSchema.safeParse({ ...base, startFraction: 0.4, endFraction: 0.5 }).success).toBe(true)
    // duration must be positive
    expect(readingRecordCreateSchema.safeParse({ ...base, durationSeconds: 0 }).success).toBe(false)
    // explicit null startedAt requires endedAt (otherwise the row would be an immutable auto block)
    expect(readingRecordCreateSchema.safeParse({ ...base, startedAt: null }).success).toBe(false)
    expect(readingRecordCreateSchema.safeParse({ ...base, startedAt: null, endedAt: 1785000600000 }).success).toBe(true)
    // existing auto-report shape stays valid
    expect(readingRecordCreateSchema.safeParse({ ...base, startedAt: 1785000000000 }).success).toBe(true)
  })

  it('returns the mixed detail feed: auto days net of manual sessions, newest first, paginated', async () => {
    // auto blocks on two days
    await addReadingTime(ownerId, { bookId, date: '2026-07-29', durationSeconds: 300, startedAt: Date.UTC(2026, 6, 29, 10) })
    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 500, startedAt: Date.UTC(2026, 6, 30, 10) })
    // a manual session adds to the 07-30 total → auto day is 700 - 200 = 500
    await addReadingTime(ownerId, {
      bookId, date: '2026-07-30', durationSeconds: 200,
      startedAt: Date.UTC(2026, 6, 30, 20), endedAt: Date.UTC(2026, 6, 30, 20) + 200_000,
    })
    // retroactive no-time entry: 07-31 is fully manual → no auto row for it
    await addReadingTime(ownerId, { bookId, date: '2026-07-31', durationSeconds: 100, startedAt: null, endedAt: 1785000600000 })

    const feed = await getBookDetail(ownerId, bookId, 50, 0)
    expect(feed).toHaveLength(4)
    expect(feed[0]).toMatchObject({ kind: 'manual', date: '2026-07-31', startedAt: null, durationSeconds: 100 })
    expect(feed[1]).toMatchObject({ kind: 'manual', date: '2026-07-30', startedAt: Date.UTC(2026, 6, 30, 20), durationSeconds: 200 })
    expect(feed[2]).toEqual({ kind: 'autoDay', date: '2026-07-30', durationSeconds: 500 })
    expect(feed[3]).toEqual({ kind: 'autoDay', date: '2026-07-29', durationSeconds: 300 })

    // offset/limit slice the merged list
    const page = await getBookDetail(ownerId, bookId, 2, 2)
    expect(page).toEqual([
      { kind: 'autoDay', date: '2026-07-30', durationSeconds: 500 },
      { kind: 'autoDay', date: '2026-07-29', durationSeconds: 300 },
    ])

    await expect(getBookDetail(otherId, bookId, 50, 0)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
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

  it('sums readFraction × wordCount across books, skipping books without intervals or wordCount', async () => {
    db.update(schema.books).set({ meta: { wordCount: 1000 } }).where(eq(schema.books.id, bookId)).run()
    db.update(schema.books).set({ meta: { wordCount: 500 } }).where(eq(schema.books.id, book2Id)).run()
    // book1: 50% read → 500 words; book2: legacy file without intervals → skipped
    seedProgressFile(files, bookId, { percent: 50, fraction: 0.5, intervals: [[0.1, 0.4], [0.4, 0.6]], updatedAt: 1 })
    seedProgressFile(files, book2Id, { percent: 80, fraction: 0.8, updatedAt: 1 })

    const summary = await getSummary(ownerId, '2026-07-31')
    expect(summary.totalWordsRead).toBe(500)

    // no wordCount in meta → skipped even with intervals
    db.update(schema.books).set({ meta: {} }).where(eq(schema.books.id, bookId)).run()
    expect((await getSummary(ownerId, '2026-07-31')).totalWordsRead).toBe(0)
  })

  it('aggregates reading time by tag, excluding untagged books and honoring the range', async () => {
    const tagA = createId('tag')
    const tagB = createId('tag')
    db.insert(schema.tags).values([
      { id: tagA, userId: ownerId, name: 'Fiction' },
      { id: tagB, userId: ownerId, name: 'Tech' },
    ]).run()
    db.insert(schema.bookTags).values([{ bookId, tagId: tagA }]).run()
    db.insert(schema.bookTags).values([{ bookId: book2Id, tagId: tagB }]).run()
    const book3Id = createId('book')
    db.insert(schema.books).values({
      id: book3Id, userId: ownerId, title: 'Book Three', author: '', format: 'txt',
      filePath: 'books/c/c.txt', coverKey: null, size: 100, meta: {}, createdAt: Date.now(), updatedAt: Date.now(),
    }).run()

    await addReadingTime(ownerId, { bookId, date: '2026-07-30', durationSeconds: 500 })
    await addReadingTime(ownerId, { bookId: book2Id, date: '2026-07-30', durationSeconds: 900 })
    await addReadingTime(ownerId, { bookId: book3Id, date: '2026-07-30', durationSeconds: 5000 }) // untagged
    await addReadingTime(ownerId, { bookId, date: '2026-06-01', durationSeconds: 77 }) // outside the range below

    const byTag = await getByTag(ownerId, {})
    expect(byTag).toEqual([
      { tagId: tagB, name: 'Tech', durationSeconds: 900 },
      { tagId: tagA, name: 'Fiction', durationSeconds: 577 },
    ])

    const ranged = await getByTag(ownerId, { from: '2026-07-01', to: '2026-07-31' })
    expect(ranged).toEqual([
      { tagId: tagB, name: 'Tech', durationSeconds: 900 },
      { tagId: tagA, name: 'Fiction', durationSeconds: 500 },
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
})
