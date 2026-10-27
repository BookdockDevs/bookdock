import { describe, it, expect, beforeEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { BOOK_STATE_PROGRESS_TAG, migrateBeforeBookRetirementIncluding as migrate } from '../../db/migration-stage'
import { Readable } from 'node:stream'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import { LocalFsDriver } from '../../storage/localfs'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { deleteProgressFile, mergeProgressInterval, readProgressFile, writeProgressFile } from '../../lib/progress-file'
import { importProgressFiles, isProgressMigrationCompleted, PROGRESS_MIGRATION_BATCH } from './progress-migration'
import { getProgress, upsertProgress } from './progress.service'

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

  it('ignores legacy files after the startup bridge and isolates per-user files', async () => {
    files.set(`progress/${bookId}.json`, Buffer.from(JSON.stringify({ percent: 42, intervals: [], updatedAt: 1 })))
    expect(await readProgressFile(ownerId, bookId)).toBeNull()
    expect(await readProgressFile(otherId, bookId)).toBeNull()
    await writeProgressFile(ownerId, bookId, { percent: 55, intervals: [], updatedAt: 2 })
    await deleteProgressFile(otherId, bookId)
    expect(await readProgressFile(ownerId, bookId)).toMatchObject({ percent: 55 })
    await deleteProgressFile(ownerId, bookId)
    expect(await readProgressFile(ownerId, bookId)).toBeNull()
    expect(files.has(`progress/${bookId}.json`)).toBe(true)
  })

  it('should upsert and read progress for the book owner', async () => {
    const revisionId = db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, bookId)).get()!.id
    const saved = await upsertProgress(ownerId, bookId, { revisionId, percent: 50, chapter: '第一章', chapterIndex: 2 })
    expect(saved.percent).toBe(50)
    expect(saved.chapterIndex).toBe(2)
    expect(saved.progressRevisionId).toBe(revisionId)
    await expect(upsertProgress(ownerId, bookId, { revisionId: 'stale-revision', percent: 40 }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    const loaded = await getProgress(ownerId, bookId)
    expect(loaded!.percent).toBe(50)
    expect(loaded!.chapterIndex).toBe(2)
    expect(loaded!.progressRevisionId).toBe(revisionId)
  })

  it('mirrors the position into the version state row', async () => {
    await upsertProgress(ownerId, bookId, { percent: 50, chapter: '第一章', chapterIndex: 2 })
    const state = db.select().from(schema.bookStates)
      .where(eq(schema.bookStates.bookVersionId, bookId)).get()!
    expect(state.percent).toBe(50)
    expect(state.chapter).toBe('第一章')
    expect(state.lastReadAt).not.toBeNull()
  })

  it('does not relabel unmapped historical coverage as the current revision on a progress write', async () => {
    const oldRevisionId = db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, bookId)).get()!.id
    const currentRevisionId = createId('rev')
    db.insert(schema.contentRevisions).values({
      id: currentRevisionId, bookVersionId: bookId, revisionNo: 2, blobKey: 'books/test/v2.txt',
      size: 120, chapterCount: 1, meta: {}, createdAt: Date.now(),
    }).run()
    db.insert(schema.bookStates).values({
      userId: ownerId, bookVersionId: bookId, readStatus: 'reading', percent: 60,
      progressRevisionId: oldRevisionId, coverageRevisionId: oldRevisionId,
      progressData: { progressRevisionId: oldRevisionId, coverageRevisionId: oldRevisionId, percent: 60, fraction: 0.6, intervals: [[0.1, 0.7]], updatedAt: 1 },
      readFraction: 0.6, updatedAt: 1,
    }).run()

    await upsertProgress(ownerId, bookId, { revisionId: currentRevisionId, percent: 40, segmentStartFraction: 0.3, fraction: 0.4 })

    const state = db.select().from(schema.bookStates).where(eq(schema.bookStates.userId, ownerId)).get()!
    expect(state.coverageRevisionId).toBe(currentRevisionId)
    expect(state.progressData?.intervals).toEqual([[0.3, 0.4]])
    expect(state.progressData?.historicalCoverage).toEqual([{ revisionId: oldRevisionId, intervals: [[0.1, 0.7]], retainedAt: expect.any(Number) }])
  })

  it('keeps legacy coverage on the active revision when its coverage basis was never recorded', async () => {
    const revisionId = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, bookId)).get()!.id
    db.insert(schema.bookStates).values({
      userId: ownerId, bookVersionId: bookId, readStatus: 'reading', percent: 60,
      progressData: { percent: 60, fraction: 0.6, intervals: [[0.1, 0.6]], updatedAt: 1 },
      readFraction: 0.5, updatedAt: 1,
    }).run()

    await upsertProgress(ownerId, bookId, { revisionId, percent: 62 })

    const state = db.select().from(schema.bookStates).where(eq(schema.bookStates.userId, ownerId)).get()!
    expect(state.coverageRevisionId).toBe(revisionId)
    expect(state.progressData?.coverageRevisionId).toBe(revisionId)
    expect(state.progressData?.intervals).toEqual([[0.1, 0.6]])
    expect(state.progressData?.historicalCoverage).toBeUndefined()
  })

  it('clears a mapped startup anchor when the reader reports a newer CFI', async () => {
    const revisionId = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, bookId)).get()!.id
    db.insert(schema.bookStates).values({
      userId: ownerId, bookVersionId: bookId, readStatus: 'reading', percent: 20, cfi: 'old-cfi',
      progressRevisionId: revisionId, coverageRevisionId: revisionId,
      progressData: {
        progressRevisionId: revisionId, coverageRevisionId: revisionId,
        cfi: 'old-cfi', positionAnchor: { revisionId, spineHref: 'chapter.xhtml', textOffset: 12, cfi: 'old-cfi' },
        percent: 20, fraction: 0.2, intervals: [], updatedAt: 1,
      },
      updatedAt: 1,
    }).run()

    const moved = await upsertProgress(ownerId, bookId, { revisionId, cfi: 'current-cfi', percent: 35 })

    expect(moved.cfi).toBe('current-cfi')
    expect(moved.positionAnchor).toBeUndefined()
  })

  it('stores the visible text CFI separately from scroll position and clears stale text on movement', async () => {
    const revisionId = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, bookId)).get()!.id
    const cfi = 'epubcfi(/6/2!/4/2,/1:2,/1:8)'
    const saved = await upsertProgress(ownerId, bookId, { revisionId, cfi: 'chapter:0:0.25', contentCfi: cfi, percent: 25 })
    expect(saved).toMatchObject({ cfi: 'chapter:0:0.25', contentCfi: cfi })
    expect(await getProgress(ownerId, bookId)).toMatchObject({ cfi: 'chapter:0:0.25', contentCfi: cfi })
    expect((await getProgress(ownerId, bookId))?.contentUpdateUnseen).toBe(true)
    db.update(schema.bookStates).set({ readRevisionId: revisionId }).where(and(eq(schema.bookStates.userId, ownerId), eq(schema.bookStates.bookVersionId, bookId))).run()
    expect((await getProgress(ownerId, bookId))?.contentUpdateUnseen).toBe(false)
    const moved = await upsertProgress(ownerId, bookId, { revisionId, cfi: 'chapter:0:0.5', percent: 50 })
    expect(moved.contentCfi).toBeNull()
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
    expect(loaded!.readFraction).toBeCloseTo(0.1)
  })

  it('does not infer read coverage from a saved position', async () => {
    await upsertProgress(ownerId, bookId, { percent: 30 })
    const loaded = await getProgress(ownerId, bookId)
    expect(loaded!.fraction).toBeNull()
    expect(loaded!.readFraction).toBe(0)
  })

  it('merges concurrent disjoint intervals without losing data', async () => {
    // Concurrently submit two disjoint intervals
    await Promise.all([
      mergeProgressInterval(ownerId, bookId, [0, 0.1]),
      mergeProgressInterval(ownerId, bookId, [0.5, 0.6]),
    ])
    const loaded = await readProgressFile(ownerId, bookId)
    expect(loaded).not.toBeNull()
    expect(loaded!.intervals).toEqual([
      [0, 0.1],
      [0.5, 0.6],
    ])
    const state = db.select().from(schema.bookStates)
      .where(eq(schema.bookStates.bookVersionId, bookId)).get()!
    expect(state.readFraction).toBeCloseTo(0.2)
  })

  it('does not probe storage for unread books after migration completes', async () => {
    // Complete the migration checkpoint
    await importProgressFiles(db)
    expect(isProgressMigrationCompleted(db)).toBe(true)

    const unreadBookId = createId('book')
    const spyExists = vi.spyOn(storage.getStorage(), 'exists')
    const result = await readProgressFile(ownerId, unreadBookId)
    expect(result).toBeNull()
    // Should NOT have called storage.exists
    expect(spyExists).not.toHaveBeenCalled()
  })

  it('merges concurrent disjoint intervals in upsertProgress without losing data', async () => {
    await Promise.all([
      upsertProgress(ownerId, bookId, { percent: 10, fraction: 0.1, segmentStartFraction: 0 }),
      upsertProgress(ownerId, bookId, { percent: 60, fraction: 0.6, segmentStartFraction: 0.5 }),
    ])
    const loaded = await readProgressFile(ownerId, bookId)
    expect(loaded).not.toBeNull()
    expect(loaded!.intervals).toEqual([
      [0, 0.1],
      [0.5, 0.6],
    ])
    const state = db.select({ readFraction: schema.bookStates.readFraction }).from(schema.bookStates)
      .where(eq(schema.bookStates.bookVersionId, bookId)).get()!
    expect(state.readFraction).toBeCloseTo(0.2)
  })

  it('does not write or mirror to storage on upsertProgress or mergeProgressInterval', async () => {
    const memory = createMemoryStorage()
    const spyPut = vi.spyOn(memory.driver, 'put')
    vi.spyOn(storage, 'getStorage').mockReturnValue(memory.driver)

    await upsertProgress(ownerId, bookId, { percent: 25, fraction: 0.25 })
    await mergeProgressInterval(ownerId, bookId, [0.3, 0.4])

    expect(spyPut).not.toHaveBeenCalled()

    const state = db.select({
      percent: schema.bookStates.percent,
      readFraction: schema.bookStates.readFraction,
    }).from(schema.bookStates).where(eq(schema.bookStates.bookVersionId, bookId)).get()!
    expect(state.percent).toBe(25)
    expect(state.readFraction).toBeCloseTo(0.1)
  })

  it.each(['legacy', 'manual'] as const)('preserves imported file coverage as a baseline only before canonical %s facts', async (source) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookdock-ledger-progress-'))
    try {
      const driver = new LocalFsDriver(path.join(tmpDir, 'files'))
      vi.spyOn(storage, 'getStorage').mockReturnValue(driver)
      db.insert(schema.readingArchives).values({
        userId: ownerId, bookVersionId: bookId, title: 'Archived', createdAt: 1, updatedAt: 1,
      }).run()
      db.insert(schema.readingSessions).values({
        id: createId('rs'), userId: ownerId, bookId, bookVersionId: bookId,
        date: '2026-10-01', durationSeconds: 60, source,
      }).run()
      await driver.put(`progress/${ownerId}/${bookId}.json`, Buffer.from(JSON.stringify({
        percent: 40, intervals: [[0, 0.4]], updatedAt: 1000,
      })))
      const report = await importProgressFiles(db)
      expect(report.imported).toBe(1)
      const archive = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).get()!
      expect(archive.legacyIntervals).toEqual(source === 'legacy' ? [[0, 0.4]] : [])
      const state = db.select().from(schema.bookStates).where(eq(schema.bookStates.bookVersionId, bookId)).get()!
      expect(state.progressData?.intervals).toEqual([[0, 0.4]])
      expect((await importProgressFiles(db)).imported).toBe(0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('imports legacy progress from real LocalFsDriver storage layout without missing files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookdock-fs-'))
    try {
      const driver = new LocalFsDriver(path.join(tmpDir, 'files'))
      vi.spyOn(storage, 'getStorage').mockReturnValue(driver)

      await driver.put(
        `progress/${ownerId}/${bookId}.json`,
        Buffer.from(JSON.stringify({ percent: 40, intervals: [[0, 0.4]], updatedAt: 1000 })),
      )

      const report = await importProgressFiles(db)
      expect(report.scanned).toBe(1)
      expect(report.imported).toBe(1)
      expect(report.anomalies.length).toBe(0)
      expect(isProgressMigrationCompleted(db)).toBe(true)

      const loaded = await readProgressFile(ownerId, bookId)
      expect(loaded).not.toBeNull()
      expect(loaded!.percent).toBe(40)
      expect(loaded!.intervals).toEqual([[0, 0.4]])

      const state = db.select({ readFraction: schema.bookStates.readFraction }).from(schema.bookStates)
        .where(eq(schema.bookStates.bookVersionId, bookId)).get()!
      expect(state.readFraction).toBeCloseTo(0.4)

      // Restart idempotency
      const secondReport = await importProgressFiles(db)
      expect(secondReport.scanned).toBe(0)
      expect(secondReport.imported).toBe(0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('marks failed when malformed files exist via LocalFsDriver and recovers after fix', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookdock-fs-'))
    try {
      const driver = new LocalFsDriver(path.join(tmpDir, 'files'))
      vi.spyOn(storage, 'getStorage').mockReturnValue(driver)

      await driver.put(`progress/${ownerId}/${bookId}.json`, Buffer.from('not valid json {{{'))

      const report1 = await importProgressFiles(db)
      expect(report1.anomalies.length).toBeGreaterThan(0)
      expect(isProgressMigrationCompleted(db)).toBe(false)

      // Fix corrupted file
      await driver.put(
        `progress/${ownerId}/${bookId}.json`,
        Buffer.from(JSON.stringify({ percent: 50, intervals: [[0, 0.5]], updatedAt: 2000 })),
      )

      const report2 = await importProgressFiles(db)
      expect(report2.imported).toBe(1)
      expect(report2.anomalies.length).toBe(0)
      expect(isProgressMigrationCompleted(db)).toBe(true)

      const loaded = await readProgressFile(ownerId, bookId)
      expect(loaded?.percent).toBe(50)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('invalidates erroneous v1 completed log and does not overwrite newer DB progress', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookdock-fs-'))
    try {
      const driver = new LocalFsDriver(path.join(tmpDir, 'files'))
      vi.spyOn(storage, 'getStorage').mockReturnValue(driver)

      // Insert erroneous v1 completed log
      db.insert(schema.libraryMigrationLog).values({
        id: createId('mlog'),
        batch: 'phase1-progress-database-migration',
        status: 'completed',
        startedAt: 1,
        finishedAt: 2,
        details: { scanned: 0, imported: 0 },
      }).run()

      // Legacy file has older 0.4 progress
      await driver.put(
        `progress/${ownerId}/${bookId}.json`,
        Buffer.from(JSON.stringify({ percent: 40, intervals: [[0, 0.4]], updatedAt: 1000 })),
      )

      // DB already has newer 0.8 progress recorded
      db.insert(schema.bookStates).values({
        userId: ownerId,
        bookVersionId: bookId,
        readStatus: 'reading',
        percent: 80,
        progressData: { percent: 80, intervals: [[0, 0.8]], updatedAt: 3000 },
        readFraction: 0.8,
        updatedAt: 3000,
      }).run()

      const report = await importProgressFiles(db)
      expect(report.scanned).toBe(1)
      expect(report.skipped).toBe(1)
      expect(report.imported).toBe(0)
      expect(isProgressMigrationCompleted(db)).toBe(true)

      // DB state must be preserved
      const state = db.select().from(schema.bookStates)
        .where(eq(schema.bookStates.bookVersionId, bookId)).get()!
      expect(state.readFraction).toBeCloseTo(0.8)
      expect((state.progressData as any).percent).toBe(80)

      // Erroneous v1 log should be wiped
      const v1Logs = db.select().from(schema.libraryMigrationLog)
        .where(eq(schema.libraryMigrationLog.batch, 'phase1-progress-database-migration')).all()
      expect(v1Logs.length).toBe(0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns true when a failed log exists followed by a completed log', () => {
    db.insert(schema.libraryMigrationLog).values([
      { id: createId('mlog'), batch: PROGRESS_MIGRATION_BATCH, status: 'failed', startedAt: 1, finishedAt: 2, details: {} },
      { id: createId('mlog'), batch: PROGRESS_MIGRATION_BATCH, status: 'completed', startedAt: 3, finishedAt: 4, details: {} },
    ]).run()
    expect(isProgressMigrationCompleted(db)).toBe(true)
  })
})
