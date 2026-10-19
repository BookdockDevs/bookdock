import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readingRecordCreateSchema, readingTransferSchema } from '@bookdock/shared'

import * as client from '../../db/client'
import { migrateBeforeBookRetirement } from '../../db/migration-stage'
import * as schema from '../../db/schema'
import { AppError } from '../../middleware/error'
import * as books from '../books/books.service'
import { addLedgerReading, changeReadingRound, claimReadingTimer, deleteLedgerSession, deleteReadingArchive, exportReadingTransfer, getReadingLedger, importReadingTransfer, releaseReadingTimer, updateLedgerSession } from './reading-ledger.service'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations')

describe('reading ledger service', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    migrateBeforeBookRetirement(db, { migrationsFolder })
    client.retargetBookIdReferences(db)
    migrate(db, { migrationsFolder })
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(books, 'getBook').mockRejectedValue(new AppError('BOOK_NOT_FOUND'))
    db.insert(schema.users).values([
      { id: 'u1', username: 'first', createdAt: 1 }, { id: 'u2', username: 'second', createdAt: 1 },
    ]).run()
    db.insert(schema.bookVersions).values({ id: 'v1', format: 'epub', size: 1, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.bookStates).values({
      userId: 'u1', bookVersionId: 'v1', percent: 70, cfi: 'current-position', updatedAt: 1,
      progressData: { percent: 70, intervals: [[0, 0.2]], updatedAt: 1 },
    }).run()
    db.insert(schema.readingArchives).values({
      userId: 'u1', bookVersionId: 'v1', title: 'Stored title', author: 'Stored author',
      legacyIntervals: [[0, 0.2]], legacyDaily: [{ date: '2026-10-01', durationSeconds: 40 }],
      legacyWordCount: 1000, createdAt: 1, updatedAt: 1,
    }).run()
  })

  afterEach(() => { vi.restoreAllMocks(); sqlite.close() })

  it.each(['auto', 'manual', 'retroactive'] as const)('validates and persists complete %s capture facts', async (source) => {
    const body = readingRecordCreateSchema.parse({ bookId: 'v1', source, date: '2026-10-02', durationSeconds: 60,
      requestId: `complete-${source}`, startedAt: Date.parse('2026-10-02T12:00:00Z'), endedAt: Date.parse('2026-10-02T12:01:00Z'),
      timezone: 'UTC', startFraction: 0.2, endFraction: 0.3, revisionId: 'recorded-revision', wordCount: 1000,
      coverage: [[0.2, 0.3]], fragments: [{ startedAt: Date.parse('2026-10-02T12:00:00Z'), endedAt: Date.parse('2026-10-02T12:01:00Z') }] })
    expect(readingRecordCreateSchema.safeParse({ ...body, startFraction: undefined }).success).toBe(source === 'manual')
    expect(readingRecordCreateSchema.safeParse({ ...body, endFraction: undefined }).success).toBe(source === 'manual')
    await addLedgerReading('u1', body)
    const saved = (await getReadingLedger('u1', 'v1')).sessions[0]
    expect(saved).toMatchObject({ source, durationSeconds: 60, startFraction: 0.2, endFraction: 0.3,
      revisionId: 'recorded-revision', wordCount: 1000, coverage: [[0.2, 0.3]], fragments: body.fragments })
  })

  it('accepts time-only manual and retroactive entries while rejecting invalid retroactive bounds', async () => {
    const base = { bookId: 'v1', date: '2026-10-02', durationSeconds: 60 }
    for (const source of ['manual', 'retroactive'] as const) {
      const body = readingRecordCreateSchema.parse({ ...base, source })
      const saved = await addLedgerReading('u1', body)
      expect(saved).toMatchObject({ durationSeconds: 60, startFraction: null, endFraction: null, coverage: [] })
    }
    expect(readingRecordCreateSchema.safeParse({ ...base, source: 'auto' }).success).toBe(false)
    expect(readingRecordCreateSchema.safeParse({ ...base, source: 'retroactive', startFraction: 0.5 }).success).toBe(false)
    expect(readingRecordCreateSchema.safeParse({ ...base, source: 'retroactive', startFraction: 0.5, endFraction: 0.4 }).success).toBe(false)
    const saved = await addLedgerReading('u1', { ...base, source: 'retroactive', startFraction: 0.3, endFraction: 0.4 })
    expect(() => updateLedgerSession('u1', saved.id, { endFraction: 0.2 })).toThrowError(AppError)
    expect(() => updateLedgerSession('u1', saved.id, { startFraction: null })).toThrowError(AppError)
    const cleared = updateLedgerSession('u1', saved.id, { startFraction: null, endFraction: null })
    expect(cleared).toMatchObject({ durationSeconds: 60, startFraction: null, endFraction: null, coverage: [] })
  })

  it('uses retained content snapshots for retroactive records after source deletion', async () => {
    db.update(schema.readingArchives).set({ legacyIntervals: [], legacyRevisionId: 'recorded-revision' }).run()
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-02', source: 'manual', durationSeconds: 60,
      revisionId: 'recorded-revision', wordCount: 1000, startFraction: 0.1, endFraction: 0.2 })
    db.delete(schema.bookVersions).where(eq(schema.bookVersions.id, 'v1')).run()
    const added = await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-03', source: 'retroactive',
      durationSeconds: 60, startFraction: 0.2, endFraction: 0.3 })
    expect(added).toMatchObject({ revisionId: 'recorded-revision', wordCount: 1000 })
    const ledger = await getReadingLedger('u1', 'v1')
    expect(ledger.sourceAvailable).toBe(false)
    expect(ledger.unalignedCoverage).toBe(false)
    expect(ledger.coverage).toBeCloseTo(0.2)
  })

  it('skips sub-minute automatic time before and after overlap reconciliation with stable receipts', async () => {
    const start = Date.parse('2026-10-02T12:00:00Z')
    const short = { bookId: 'v1', date: '2026-10-02', source: 'auto' as const, requestId: 'short-auto', durationSeconds: 59 }
    expect(await addLedgerReading('u1', short)).toMatchObject({ skipped: true })
    expect(await addLedgerReading('u1', short)).toMatchObject({ skipped: true })
    expect(db.select().from(schema.readingRounds).all()).toHaveLength(0)
    await addLedgerReading('u1', { bookId: 'v1', date: short.date, source: 'manual', durationSeconds: 60,
      fragments: [{ startedAt: start, endedAt: start + 60_000 }] })
    const overlap = { ...short, requestId: 'overlap-auto', durationSeconds: 90,
      fragments: [{ startedAt: start, endedAt: start + 90_000 }] }
    expect(await addLedgerReading('u1', overlap)).toMatchObject({ skipped: true })
    expect(await addLedgerReading('u1', overlap)).toMatchObject({ skipped: true })
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(1)
  })

  it('restores the closed round unchanged when undoing an empty reread', async () => {
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-02', source: 'retroactive', durationSeconds: 120, startFraction: 0.2, endFraction: 0.4 })
    const finished = await changeReadingRound('u1', 'v1', 'finish')
    await changeReadingRound('u1', 'v1', 'reread')
    const restored = await changeReadingRound('u1', 'v1', 'continue')
    expect(restored.rounds).toEqual(finished.rounds)
    expect(db.select().from(schema.bookStates).get()?.readStatus).toBe('finished')
    const continued = await changeReadingRound('u1', 'v1', 'continue')
    expect(continued.rounds[0].status).toBe('reading')
    expect(continued.rounds).toHaveLength(1)
  })

  it('replays stable request identities without double counting and rejects changed payloads', async () => {
    const body = { bookId: 'v1', date: '2026-10-02', durationSeconds: 120, source: 'retroactive' as const, requestId: 'request-1', startFraction: 0.2, endFraction: 0.4 }
    const first = await addLedgerReading('u1', body)
    const repeated = await addLedgerReading('u1', body)
    expect(repeated.id).toBe(first.id)
    expect((await getReadingLedger('u1', 'v1')).totalSeconds).toBe(160)
    await expect(addLedgerReading('u1', { ...body, durationSeconds: 121 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(1)
  })

  it('recomputes corrected coverage while retaining the legacy baseline and current position', async () => {
    const session = await addLedgerReading('u1', {
      bookId: 'v1', date: '2026-10-02', durationSeconds: 120, source: 'retroactive', startFraction: 0.2, endFraction: 0.6,
    })
    expect((await getReadingLedger('u1', 'v1')).coverage).toBeCloseTo(0.6)
    updateLedgerSession('u1', session.id, { endFraction: 0.3 })
    expect((await getReadingLedger('u1', 'v1')).coverage).toBeCloseTo(0.3)
    expect(() => deleteLedgerSession('u2', session.id)).toThrowError(AppError)
    expect(() => updateLedgerSession('u2', session.id, { durationSeconds: 1 })).toThrowError(AppError)
    deleteLedgerSession('u1', session.id)
    const ledger = await getReadingLedger('u1', 'v1')
    expect(ledger.coverage).toBeCloseTo(0.2)
    expect(ledger.totalSeconds).toBe(40)
    const state = db.select().from(schema.bookStates).get()!
    expect(state.cfi).toBe('current-position')
    expect(state.percent).toBe(70)
    expect(state.progressData?.intervals).toEqual([[0, 0.2]])
  })

  it('splits known active time over local midnight and deduplicates overlapping device reports', async () => {
    const start = Date.parse('2026-10-17T15:59:00Z')
    const first = await addLedgerReading('u1', {
      bookId: 'v1', date: '2026-10-17', durationSeconds: 120, source: 'auto', timezone: 'Asia/Shanghai',
      fragments: [{ startedAt: start, endedAt: start + 120_000 }], coverage: [[0.2, 0.3]],
    })
    await addLedgerReading('u1', {
      bookId: 'v1', date: '2026-10-17', durationSeconds: 120, source: 'auto', timezone: 'Asia/Shanghai',
      fragments: [{ startedAt: start + 60_000, endedAt: start + 180_000 }], coverage: [[0.3, 0.4]],
    })
    expect(db.select({ date: schema.readingRecords.date, seconds: schema.readingRecords.durationSeconds }).from(schema.readingRecords).all()).toEqual(expect.arrayContaining([
      { date: '2026-10-17', seconds: 60 }, { date: '2026-10-18', seconds: 120 },
    ]))
    expect((await getReadingLedger('u1', 'v1')).totalSeconds).toBe(220)
    expect(() => updateLedgerSession('u1', first.id, { durationSeconds: 1 })).toThrowError(AppError)
    deleteLedgerSession('u1', first.id)
    expect((await getReadingLedger('u1', 'v1')).totalSeconds).toBe(100)
  })

  it('keeps records accessible only to their owner after source deletion', async () => {
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-02', durationSeconds: 60, source: 'manual', startFraction: 0.2, endFraction: 0.3 })
    db.delete(schema.bookVersions).where(eq(schema.bookVersions.id, 'v1')).run()
    const ledger = await getReadingLedger('u1', 'v1')
    expect(ledger.sourceAvailable).toBe(false)
    expect(ledger.title).toBe('Stored title')
    expect(ledger.totalSeconds).toBe(100)
    await expect(getReadingLedger('u2', 'v1')).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('keeps reread coverage separate and only opens a new round explicitly', async () => {
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-02', durationSeconds: 60, source: 'manual', startFraction: 0.2, endFraction: 0.4 })
    await changeReadingRound('u1', 'v1', 'finish')
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-03', durationSeconds: 60, source: 'manual', startFraction: 0.3, endFraction: 0.4 })
    expect((await getReadingLedger('u1', 'v1')).rounds).toHaveLength(1)
    const reread = await changeReadingRound('u1', 'v1', 'reread')
    expect(reread.rounds).toHaveLength(2)
    expect(reread.coverage).toBe(0)
    expect(reread.totalSeconds).toBe(160)
  })

  it('requires explicit takeover of a manual claim and rejects stale automatic activity', () => {
    const now = Date.now()
    expect(claimReadingTimer('u1', { deviceId: 'desktop', mode: 'manual', activityAt: now }).granted).toBe(true)
    expect(claimReadingTimer('u1', { deviceId: 'phone', mode: 'auto', activityAt: now + 1 }).granted).toBe(false)
    expect(claimReadingTimer('u1', { deviceId: 'phone', mode: 'manual', activityAt: now + 1 }).granted).toBe(false)
    expect(claimReadingTimer('u1', { deviceId: 'phone', mode: 'manual', activityAt: now + 1, explicit: true }).granted).toBe(true)
    releaseReadingTimer('u1', 'desktop')
    expect(db.select().from(schema.readingTimerClaims).get()?.deviceId).toBe('phone')
    releaseReadingTimer('u1', 'phone')
    expect(claimReadingTimer('u1', { deviceId: 'desktop', mode: 'auto', activityAt: now }).granted).toBe(true)
    expect(claimReadingTimer('u1', { deviceId: 'phone', mode: 'auto', activityAt: now - 1 }).granted).toBe(false)
  })
  it('does not resurrect a deleted request or a deleted archive on pending replay', async () => {
    const body = { bookId: 'v1', date: '2026-10-02', durationSeconds: 120, requestId: 'deleted-request', source: 'manual' as const, startFraction: 0.2, endFraction: 0.4 }
    const session = await addLedgerReading('u1', body)
    deleteLedgerSession('u1', session.id)
    await expect(addLedgerReading('u1', body)).resolves.toMatchObject({ deleted: true, durationSeconds: 0 })
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(0)
    const receipt = db.select().from(schema.readingWriteReceipts).get()!
    expect(receipt.status).toBe('deleted')
    expect(receipt.sessionId).toBeNull()
    deleteReadingArchive('u1', 'v1')
    const backup = readingTransferSchema.parse(JSON.parse(JSON.stringify(await exportReadingTransfer('u1'))))
    expect(backup.archives).toHaveLength(0)
    expect(backup.detachedReceipts).toHaveLength(1)
    expect(importReadingTransfer('u2', backup, true).sessions).toBe(0)
    importReadingTransfer('u2', backup, false)
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(0)
    await expect(addLedgerReading('u2', body)).resolves.toMatchObject({ deleted: true, durationSeconds: 0 })
  })

  it('keeps fully deduplicated writes as replayable skipped receipts without empty rounds', async () => {
    const start = Date.parse('2026-10-17T10:00:00Z')
    const timing = { date: '2026-10-17', durationSeconds: 60, timezone: 'UTC', fragments: [{ startedAt: start, endedAt: start + 60_000 }] }
    await addLedgerReading('u1', { ...timing, bookId: 'v1', requestId: 'first-timed', source: 'auto' })
    db.insert(schema.readingArchives).values({ userId: 'u1', bookVersionId: 'v2', title: 'Second', createdAt: 1, updatedAt: 1 }).run()
    const body = { ...timing, bookId: 'v2', requestId: 'duplicate-timed', source: 'auto' as const }
    expect(await addLedgerReading('u1', body)).toMatchObject({ skipped: true, durationSeconds: 0 })
    expect(await addLedgerReading('u1', body)).toMatchObject({ skipped: true, durationSeconds: 0 })
    expect(db.select().from(schema.readingRounds).where(eq(schema.readingRounds.bookVersionId, 'v2')).all()).toHaveLength(0)
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(1)
    expect(readingTransferSchema.safeParse(await exportReadingTransfer('u1')).success).toBe(true)
  })

  it('roundtrips JSON facts, legacy residuals and original receipts privately and idempotently', async () => {
    db.update(schema.readingArchives).set({ legacyRevisionId: 'historical-revision' }).run()
    const body = { bookId: 'v1', date: '2026-10-02', durationSeconds: 120, requestId: 'roundtrip-request', source: 'manual' as const,
      startFraction: 0.2, endFraction: 0.4, startCfi: 'start-anchor', endCfi: 'end-anchor', startChapterIndex: 1, endChapterIndex: 2, revisionId: 'historical-revision', wordCount: 1000 }
    await addLedgerReading('u1', body)
    const backup = readingTransferSchema.parse(JSON.parse(JSON.stringify(await exportReadingTransfer('u1'))))
    expect(backup.archives[0].legacyDaily).toEqual([{ date: '2026-10-01', durationSeconds: 40 }])
    expect(backup.archives[0].legacyWordCount).toBe(1000)
    expect(importReadingTransfer('u2', backup, true)).toEqual({ archives: 1, sessions: 1, duplicates: 0 })
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(1)
    importReadingTransfer('u2', backup, false)
    const recovered = await getReadingLedger('u2', 'v1')
    expect(recovered.totalSeconds).toBe(160)
    expect(recovered.coverage).toBeCloseTo(0.4)
    expect(recovered.sessions[0]).toMatchObject({ startCfi: 'start-anchor', endCfi: 'end-anchor', startChapterIndex: 1, endChapterIndex: 2, revisionId: 'historical-revision' })
    expect(recovered.sessions[0].id).not.toBe(backup.archives[0].sessions[0].id)
    expect(importReadingTransfer('u2', backup, true)).toEqual({ archives: 1, sessions: 0, duplicates: 1 })
    importReadingTransfer('u2', backup, false)
    const replay = await addLedgerReading('u2', body)
    expect(replay.id).toBe(recovered.sessions[0].id)
    const ownBackup = readingTransferSchema.parse(await exportReadingTransfer('u2'))
    expect(importReadingTransfer('u2', ownBackup, true).duplicates).toBe(1)
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(2)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('rejects conflicting backup facts in preview before any writes', async () => {
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-02', durationSeconds: 60, source: 'manual', requestId: 'preview-request', startFraction: 0.2, endFraction: 0.4 })
    const backup = await exportReadingTransfer('u1')
    for (const mutate of [
      (copy: typeof backup) => { copy.archives[0].legacyWordCount = 2000 },
      (copy: typeof backup) => { copy.archives[0].sessions[0].revisionId = 'different-revision' },
      (copy: typeof backup) => { copy.archives[0].sessions[0].durationSeconds = 61 },
      (copy: typeof backup) => { copy.archives[0].receipts![0].bodyHash = '0'.repeat(64) },
      (copy: typeof backup) => { copy.archives[0].rounds[0].startedAt += 1 },
    ]) {
      const copy = structuredClone(backup)
      mutate(copy)
      expect(() => importReadingTransfer('u1', copy, true)).toThrowError(AppError)
    }
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(1)
    expect((await getReadingLedger('u1', 'v1')).totalSeconds).toBe(100)
  })

  it('rejects reusing another archive round identity and overlapping imported records', async () => {
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-02', durationSeconds: 60, source: 'manual', startFraction: 0.2, endFraction: 0.4 })
    const backup = await exportReadingTransfer('u1')
    const wrongArchive = structuredClone(backup)
    wrongArchive.archives[0].bookId = 'another-version'
    expect(() => importReadingTransfer('u1', wrongArchive, true)).toThrowError(AppError)
    const start = Date.parse('2026-10-17T10:00:00Z')
    const overlapping = structuredClone(backup)
    const template = overlapping.archives[0].sessions[0]
    template.fragments = [{ startedAt: start, endedAt: start + 60_000 }]
    template.durationSeconds = 60
    template.timezone = 'UTC'
    overlapping.archives[0].sessions.push({ ...template, id: 'different-session' })
    expect(() => importReadingTransfer('u2', overlapping, true)).toThrowError(AppError)
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(1)
  })

  it('replaces only owned overlapping current-round records atomically and tombstones original writes', async () => {
    const start = Date.parse('2026-10-17T10:00:00Z')
    const common = { bookId: 'v1', date: '2026-10-17', durationSeconds: 60, timezone: 'UTC', source: 'auto' as const }
    const firstBody = { ...common, requestId: 'replace-first', fragments: [{ startedAt: start, endedAt: start + 60_000 }], coverage: [[0.2, 0.3] as [number, number]] }
    const secondBody = { ...common, requestId: 'replace-second', fragments: [{ startedAt: start + 60_000, endedAt: start + 120_000 }], coverage: [[0.3, 0.4] as [number, number]] }
    const first = await addLedgerReading('u1', firstBody)
    const second = await addLedgerReading('u1', secondBody)
    db.insert(schema.readingArchives).values({ userId: 'u2', bookVersionId: 'v1', title: 'Private second account', createdAt: 1, updatedAt: 1 }).run()
    const foreign = await addLedgerReading('u2', { ...firstBody, requestId: 'foreign-write' })
    const replacement = { bookId: 'v1', date: '2026-10-17', durationSeconds: 60, timezone: 'UTC', source: 'retroactive' as const,
      requestId: 'replacement', startedAt: start + 30_000, continuous: true, startFraction: 0.2, endFraction: 0.35 }
    await expect(addLedgerReading('u1', { ...replacement, replaceSessionIds: [first.id, foreign.id] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(db.select().from(schema.readingSessions).where(eq(schema.readingSessions.userId, 'u1')).all()).toHaveLength(2)
    expect(db.select().from(schema.readingWriteReceipts).where(eq(schema.readingWriteReceipts.requestId, 'replace-first')).get()?.status).toBe('accepted')
    const saved = await addLedgerReading('u1', { ...replacement, replaceSessionIds: [first.id, second.id] })
    expect(saved.durationSeconds).toBe(60)
    expect((await getReadingLedger('u1', 'v1')).totalSeconds).toBe(100)
    expect((await getReadingLedger('u2', 'v1')).totalSeconds).toBe(60)
    await expect(addLedgerReading('u1', firstBody)).resolves.toMatchObject({ deleted: true, durationSeconds: 0 })
    await expect(addLedgerReading('u1', secondBody)).resolves.toMatchObject({ deleted: true, durationSeconds: 0 })
    expect(db.select().from(schema.readingSessions).where(eq(schema.readingSessions.userId, 'u1')).all()).toHaveLength(1)
  })

  it('identifies cross-book and previous-round conflicts as non-replaceable without changing records', async () => {
    db.insert(schema.readingArchives).values({ userId: 'u1', bookVersionId: 'v2', title: 'Second book', createdAt: 1, updatedAt: 1 }).run()
    const startedAt = Date.parse('2026-10-02T10:00:00Z')
    const timing = { date: '2026-10-02', durationSeconds: 1800, startedAt, continuous: true, source: 'retroactive' as const }
    const first = await addLedgerReading('u1', { ...timing, bookId: 'v1' })
    const expected = { code: 'VALIDATION_ERROR', details: { conflictingSessionIds: [], hasUnreplaceableConflicts: true } }
    await expect(addLedgerReading('u1', { ...timing, bookId: 'v2' })).rejects.toMatchObject(expected)
    await changeReadingRound('u1', 'v1', 'reread')
    await expect(addLedgerReading('u1', { ...timing, bookId: 'v1' })).rejects.toMatchObject(expected)
    expect(db.select().from(schema.readingSessions).all().map((row) => row.id)).toEqual([first.id])
    const saved = await addLedgerReading('u1', { ...timing, bookId: 'v2', startedAt: startedAt + 1800_000 })
    expect(saved.durationSeconds).toBe(1800)
  })

  it('projects known append history without inflating historical volume and accepts a delayed pruned revision', async () => {
    vi.mocked(books.getBook).mockResolvedValue({} as Awaited<ReturnType<typeof books.getBook>>)
    db.update(schema.readingArchives).set({ legacyIntervals: [], legacyRevisionId: 'old-revision' }).run()
    db.insert(schema.contentRevisions).values({ id: 'old-revision', bookVersionId: 'v1', revisionNo: 1, blobKey: 'old-blob', size: 1, wordCount: 1000, createdAt: 1 }).run()
    const original = await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-02', source: 'manual', durationSeconds: 60, startFraction: 0, endFraction: 0.5, revisionId: 'old-revision' })
    db.insert(schema.contentRevisions).values({ id: 'new-revision', bookVersionId: 'v1', revisionNo: 2, blobKey: 'new-blob', size: 2, wordCount: 2000, meta: { readingCompatibleRevisions: ['old-revision'] }, createdAt: 2 }).run()
    let ledger = await getReadingLedger('u1', 'v1')
    expect(ledger.coverage).toBeCloseTo(0.25)
    expect(ledger.rounds[0].wordCount).toBe(2000)
    expect(ledger.sessions[0].projectedCoverage).toEqual([[0, 0.25]])
    expect(ledger.sessions[0]).toMatchObject({ startFraction: 0, endFraction: 0.5, progressScale: 0.5, durationSeconds: 60 })
    expect(ledger.sessions[0].coverage[0][1] * ledger.sessions[0].wordCount!).toBe(500)
    updateLedgerSession('u1', original.id, { durationSeconds: 61 })
    expect(db.select().from(schema.bookStates).get()?.readFraction).toBeCloseTo(0.25)
    db.delete(schema.contentRevisions).where(eq(schema.contentRevisions.id, 'old-revision')).run()
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-03', source: 'manual', durationSeconds: 60, startFraction: 0.5, endFraction: 0.6, revisionId: 'old-revision', wordCount: 1000 })
    ledger = await getReadingLedger('u1', 'v1')
    expect(ledger.coverage).toBeCloseTo(0.3)
    expect(ledger.unalignedCoverage).toBe(false)
    expect(ledger.sessions.every((entry) => entry.wordCount === 1000)).toBe(true)
    const backup = readingTransferSchema.parse(await exportReadingTransfer('u1'))
    expect(backup.archives[0].legacyRevisionId).toBe('old-revision')
    expect(backup.archives[0].sessions.every((session) => !('progressScale' in session))).toBe(true)
    expect(importReadingTransfer('u1', backup, true).duplicates).toBe(2)
  })

  it('flags incompatible replacements but preserves recorded coverage when the source is unavailable', async () => {
    vi.mocked(books.getBook).mockResolvedValue({} as Awaited<ReturnType<typeof books.getBook>>)
    db.update(schema.readingArchives).set({ legacyIntervals: [], legacyRevisionId: 'old-revision' }).run()
    db.insert(schema.contentRevisions).values({ id: 'old-revision', bookVersionId: 'v1', revisionNo: 1, blobKey: 'old-blob', size: 1, wordCount: 1000, createdAt: 1 }).run()
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-02', source: 'manual', durationSeconds: 60, startFraction: 0, endFraction: 0.5 })
    db.insert(schema.contentRevisions).values({ id: 'replacement', bookVersionId: 'v1', revisionNo: 2, blobKey: 'replacement-blob', size: 2, wordCount: 2000, createdAt: 2 }).run()
    let ledger = await getReadingLedger('u1', 'v1')
    expect(ledger.coverage).toBe(0)
    expect(ledger.unalignedCoverage).toBe(true)
    expect(ledger.sessions[0].progressScale).toBeNull()
    expect(ledger.sessions[0].coverage).toEqual([[0, 0.5]])
    vi.mocked(books.getBook).mockRejectedValue(new AppError('BOOK_NOT_FOUND'))
    ledger = await getReadingLedger('u1', 'v1')
    expect(ledger.coverage).toBeCloseTo(0.5)
    expect(ledger.rounds[0].wordCount).toBe(1000)
  })

  it('preserves metadata-only revision coverage after the previous revision is pruned', async () => {
    vi.mocked(books.getBook).mockResolvedValue({} as Awaited<ReturnType<typeof books.getBook>>)
    db.update(schema.readingArchives).set({ legacyIntervals: [], legacyRevisionId: 'old-revision' }).run()
    db.insert(schema.contentRevisions).values({ id: 'old-revision', bookVersionId: 'v1', revisionNo: 1, blobKey: 'same-blob', size: 1, wordCount: 1000, createdAt: 1 }).run()
    await addLedgerReading('u1', { bookId: 'v1', date: '2026-10-02', source: 'manual', durationSeconds: 60, startFraction: 0, endFraction: 0.5 })
    db.insert(schema.contentRevisions).values({ id: 'metadata-revision', bookVersionId: 'v1', revisionNo: 2, blobKey: 'same-blob', size: 1, wordCount: 1000, meta: { readingCompatibleRevisions: ['old-revision'] }, createdAt: 2 }).run()
    db.delete(schema.contentRevisions).where(eq(schema.contentRevisions.id, 'old-revision')).run()
    expect((await getReadingLedger('u1', 'v1')).coverage).toBeCloseTo(0.5)
  })

})
