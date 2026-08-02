import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import {
  addReadingTime,
  computeStreak,
  getBookRecords,
  getByBook,
  getDaily,
  getHourly,
  getSummary,
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

describe('reading-records service', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let otherId: string
  let bookId: string
  let book2Id: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)

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
