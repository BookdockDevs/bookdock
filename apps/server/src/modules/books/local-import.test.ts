import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Hono } from 'hono'
import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '../../db/client'
import { migrateBeforeBookRetirement } from '../../db/migration-stage'
import * as schema from '../../db/schema'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { sha256 } from '../../lib/hash'
import { createId } from '../../lib/id'
import { errorHandler } from '../../middleware/error'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { resetInstanceCache } from '../auth/auth.service'
import { getReadingLedger, getReadingLedgerOverview } from '../reading-records/reading-ledger.service'
import booksRoutes from './books.routes'
import { uploadBook } from './books.service'
import { checkLocalBookDuplicate, importLocalBookFromClient } from './local-import.service'
import { getReaderBookSettings } from './reader-settings.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  const migrationsFolder = path.join(__dirname, '..', '..', 'db', 'migrations')
  migrateBeforeBookRetirement(db, { migrationsFolder })
  client.retargetBookIdReferences(db)
  migrate(db, { migrationsFolder })
  return db
}

function createMemoryStorage() {
  const files = new Map<string, Buffer>()
  const driver: StorageDriver = {
    async put(key, data) {
      if (Buffer.isBuffer(data)) files.set(key, data)
      else {
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
    async delete(key) { files.delete(key) },
    async exists(key) { return files.has(key) },
    async size(key) { return files.get(key)?.length ?? 0 },
  }
  return { driver, files }
}

function seedUser(db: ReturnType<typeof createTestDb>, username: string): string {
  const id = createId('user')
  db.insert(schema.users).values({ id, username, passwordHash: null, role: 'owner', createdAt: 1 }).run()
  db.insert(schema.libraries).values({
    id: createId('lib'), userId: id, type: 'private', name: username,
    description: '', visibility: null, createdAt: 1, updatedAt: 1,
  }).run()
  return id
}

describe('local-to-server import', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string
  let mem: ReturnType<typeof createMemoryStorage>

  beforeAll(() => {
    registerParser(new TxtParser())
    registerParser({
      match: (fileName) => fileName.toLowerCase().endsWith('.epub'),
      parse: async () => ({
        meta: { title: 'Parsed EPUB', authors: ['EPUB Author'], bookmeta: { publisher: 'Press' } },
        chapters: [{ id: 'ch-0', title: 'Chapter 1', level: 1, wordCount: 500 }],
      }),
    })
  })

  beforeEach(() => {
    resetInstanceCache()
    db = createTestDb()
    mem = createMemoryStorage()
    vi.spyOn(client, 'getDb').mockReturnValue(db as unknown as ReturnType<typeof client.getDb>)
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
    userId = seedUser(db, 'importer')
  })

  it('imports a complete local book with progress, notes, idea images, review, reading ledger, replacements and settings idempotently', async () => {
    const library = db.select().from(schema.libraries).where(eq(schema.libraries.userId, userId)).get()!
    const shelfId = createId('shelf')
    const tagId = createId('tag')
    const globalRuleId = createId('tr')
    db.insert(schema.shelves).values({ id: shelfId, libraryId: library.id, userId, name: 'Sci-Fi', sortOrder: 0, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryTags).values({ id: tagId, libraryId: library.id, userId, name: 'Favorite', sortOrder: 0, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.textReplacements).values({
      id: globalRuleId, userId, matchType: 'pattern', pattern: 'foo', replacement: 'bar',
      isRegex: 0, applyTo: 'content', enabled: 1, sortOrder: 0, createdAt: 1, updatedAt: 1,
    }).run()

    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 120, b: 220 } } }).png().toBuffer()
    const epubFile = new File([Buffer.from('local-epub-bytes')], 'LocalBook.epub', { type: 'application/epub+zip' })
    const coverFile = new File([png], 'cover.png', { type: 'image/png' })
    const ideaImage = new File([png], 'sketch.png', { type: 'image/png' })

    const payload = {
      requestId: 'req-local-import-1',
      book: {
        title: 'Local Custom Title',
        authors: ['Local Author'],
        format: 'epub' as const,
        fileName: 'OriginalLocalName.epub',
        contentId: 'local-content-1',
        createdAt: 1000,
        updatedAt: 2000,
        catalog: {
          shelfId,
          categoryId: 'nonexistent-anon-category',
          tagIds: [tagId, 'nonexistent-tag'],
          pinnedAt: 1500,
          hidden: false,
          metadata: { publisher: 'Local Press' },
        },
      },
      state: {
        readStatus: 'reading' as const,
        cfi: 'epubcfi(/6/2!/4/2:10)',
        chapter: 'Chapter 1',
        fraction: 0.45,
        positionContentId: 'local-content-1',
        coverageIntervals: [[0, 0.45]] as Array<[number, number]>,
        coverageContentId: 'local-content-1',
        lastReadAt: 1900,
      },
      notes: [
        { id: 'n1', kind: 'bookmark' as const, title: 'Mark 1', context: 'Ctx', cfi: 'epubcfi(/6/2!/4/2:2)', href: 'ch1.xhtml', chapter: 'Chapter 1', contentId: 'local-content-1', createdAt: 1100, updatedAt: 1100 },
        { id: 'n2', kind: 'highlight' as const, text: 'Quote', color: 'yellow', style: 'highlight' as const, cfi: 'epubcfi(/6/2!/4/2:4)', href: 'ch1.xhtml', chapter: 'Chapter 1', contentId: 'local-content-1', createdAt: 1200, updatedAt: 1200 },
        { id: 'n3', kind: 'idea' as const, text: 'Quote 2', body: 'My thought', cfi: 'epubcfi(/6/2!/4/2:8)', href: 'ch1.xhtml', chapter: 'Chapter 1', contentId: 'local-content-1', createdAt: 1300, updatedAt: 1300, imageIds: ['local-image_123456789012345678901'] },
      ],
      review: {
        ratingHalves: 9,
        title: 'Great read',
        body: 'Detailed thoughts',
        bodyFormat: 'markdown' as const,
        createdAt: 1400,
        updatedAt: 1400,
      },
      rounds: [{ ordinal: 1, status: 'reading' as const, startedAt: null, endedAt: null }],
      sessions: [{
        roundOrdinal: 1,
        requestId: 'local-sess-1',
        source: 'auto' as const,
        date: '2026-11-11',
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_045_400,
        durationSeconds: 45.4,
        timezone: 'Asia/Shanghai',
        fragments: [{ startedAt: 1_700_000_000_000, endedAt: 1_700_000_045_400 }],
        coverage: [[0, 0.45]] as Array<[number, number]>,
        contentId: 'local-content-1',
      }],
      readerSettings: { viewSettings: { fontSize: 19 } },
      pointRules: [{
        replacement: 'fixed',
        spineHref: 'ch1.xhtml',
        textOffset: 5,
        originalText: 'typo',
        contentId: 'local-content-1',
        relocation: 'ok' as const,
        enabled: true,
        createdAt: 1500,
        updatedAt: 1500,
      }],
      replacementOverrides: { [globalRuleId]: false, 'missing-rule': true },
    }

    const res = await importLocalBookFromClient(userId, epubFile, payload, {
      cover: coverFile,
      noteImages: new Map([['local-image_123456789012345678901', ideaImage]]),
    })

    expect(res.book.title).toBe('Local Custom Title')
    expect(res.book.shelfId).toBe(shelfId)
    expect(res.book.categoryId).toBeNull()
    expect(res.book.tagIds).toEqual([tagId])
    expect(res.book.tags).toEqual(['Favorite'])
    expect(res.book.readStatus).toBe('reading')

    const state = db.select().from(schema.bookStates).where(eq(schema.bookStates.bookVersionId, res.book.id)).get()!
    expect(state.cfi).toBe('epubcfi(/6/2!/4/2:10)')
    expect(state.progressRevisionId).toBe(res.book.revisionId)
    expect(state.readFraction).toBeCloseTo(0.45)

    expect(db.select().from(schema.bookmarks).where(eq(schema.bookmarks.bookVersionId, res.book.id)).all()).toHaveLength(1)
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.bookVersionId, res.book.id)).all()).toHaveLength(1)
    const importedIdeas = db.select().from(schema.ideas).where(eq(schema.ideas.bookVersionId, res.book.id)).all()
    expect(importedIdeas).toHaveLength(1)
    expect(importedIdeas[0]!.revisionId).toBe(res.book.revisionId)
    expect(db.select().from(schema.contentFiles).where(eq(schema.contentFiles.ideaId, importedIdeas[0]!.id)).all()).toHaveLength(1)

    const review = db.select().from(schema.bookReviews).where(eq(schema.bookReviews.userId, userId)).get()!
    expect(review.ratingHalves).toBe(9)

    const ledger = await getReadingLedger(userId, res.book.id)
    expect(ledger.rounds).toHaveLength(1)
    expect(ledger.totalSeconds).toBe(45)

    expect(getReaderBookSettings(userId, res.book.id)).toEqual({ viewSettings: { fontSize: 19 } })
    expect(db.select().from(schema.textReplacements).where(eq(schema.textReplacements.bookVersionId, res.book.id)).all()).toHaveLength(1)
    expect(db.select().from(schema.textReplacementOverrides).where(eq(schema.textReplacementOverrides.bookVersionId, res.book.id)).all()).toHaveLength(1)

    // Idempotent replay with same requestId returns the same book without duplicating
    const replay = await importLocalBookFromClient(userId, epubFile, payload)
    expect(replay.book.id).toBe(res.book.id)
  })

  it('does not fabricate statistical coverage when importing a local book with zero reading sessions', async () => {
    const epubFile = new File([Buffer.from('untimed-local-book')], 'Untimed.epub', { type: 'application/epub+zip' })
    const res = await importLocalBookFromClient(userId, epubFile, {
      requestId: 'req-local-import-untimed',
      book: {
        title: 'Untimed Book',
        authors: ['Author'],
        format: 'epub',
        contentId: 'untimed-content-1',
        createdAt: 1000,
        updatedAt: 2000,
      },
      state: {
        readStatus: 'reading',
        cfi: 'epubcfi(/6/2!/4/2:10)',
        chapter: 'Chapter 1',
        fraction: 0.35,
        positionContentId: 'untimed-content-1',
        coverageIntervals: [[0.08, 0.14], [0.64, 1]],
        coverageContentId: 'untimed-content-1',
        lastReadAt: 1900,
      },
      rounds: [{ ordinal: 1, status: 'reading', startedAt: null, endedAt: null }],
      notes: [],
      sessions: [],
      pointRules: [],
      replacementOverrides: {},
    })

    const state = db.select().from(schema.bookStates).where(eq(schema.bookStates.bookVersionId, res.book.id)).get()!
    expect(state.percent).toBe(35)
    expect(state.readFraction).toBe(0)

    const ledger = await getReadingLedger(userId, res.book.id)
    expect(ledger.totalSeconds).toBe(0)
    expect(ledger.coverage).toBe(0)
    expect(ledger.legacyIntervals).toEqual([])

    const overview = await getReadingLedgerOverview(userId, res.book.id)
    expect(overview.totalSeconds).toBe(0)
    expect(overview.coverage).toBe(0)
    expect(overview.coverageIntervals).toEqual([])
  })

  it('detects duplicates via duplicate-check and rejects duplicate import with BOOK_DUPLICATE', async () => {
    const content = Buffer.from('duplicate-epub-payload')
    await uploadBook(userId, new File([content], 'Already.epub', { type: 'application/epub+zip' }))

    const check = await checkLocalBookDuplicate(userId, { sha256: sha256(content), format: 'epub' })
    expect(check.duplicated).toBe(true)

    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => {
      c.set('user', { id: userId, username: 'importer', role: 'owner', bio: '', avatarKey: null })
      await next()
    })
    app.route('/api/v1/books', booksRoutes)

    const form = new FormData()
    form.append('file', new File([content], 'LocalDup.epub', { type: 'application/epub+zip' }))
    form.append('payload', JSON.stringify({
      requestId: 'req-dup-1',
      book: { title: 'Dup', authors: [], format: 'epub', contentId: 'c1', createdAt: 1, updatedAt: 1 },
    }))
    const res = await app.request('/api/v1/books/import-from-local', { method: 'POST', body: form })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BOOK_DUPLICATE')
  })
})
