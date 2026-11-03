import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import JSZip from 'jszip'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { getStorage } from '../../storage'
import { applyImport, type ImportProposal } from './reading-imports.service'
import { mountArchive } from './mount-archive'
import { buildLocatorReport } from './locator-report'
import { savePersonalBookSnapshot } from '../../lib/personal-book-archive'

const testDataDir = vi.hoisted(() => `${process.cwd()}/.tmp-mount-${process.pid}-${Date.now()}`)
vi.mock('../../config', () => ({ config: { dataDir: testDataDir, storageDriver: 'localfs' } }))

type TestDb = ReturnType<typeof drizzle<typeof schema>>

function chapter(title: string, paragraphs: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h2>${title}</h2>${paragraphs.map((text) => `<p>${text}</p>`).join('')}</body></html>`
}

/** A three-chapter EPUB: one unique sentence, one that repeats in two
 * chapters, and a chapter that is only a heading. */
async function epub(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`)
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine>
    </package>`)
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><body><nav><ol>
      <li><a href="text/ch1.xhtml">第一章 出发</a></li>
      <li><a href="text/ch2.xhtml">第二章 抵达</a></li>
      <li><a href="text/ch3.xhtml">第三章 图版</a></li>
    </ol></nav></body></html>`)
  zip.file('OEBPS/text/ch1.xhtml', chapter('第一章 出发', ['独一无二的句子只出现一次。', '重复的一句话。']))
  zip.file('OEBPS/text/ch2.xhtml', chapter('第二章 抵达', ['这里也有一句重复的一句话。']))
  zip.file('OEBPS/text/ch3.xhtml', chapter('第三章 图版', ['<img src="../images/plate.png"/>']))
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('mount archive', () => {
  let db: TestDb
  let userId: string
  let targetBookId: string
  let blobKey: string

  function seedTargetBook(bookId: string = targetBookId, title = '目标书'): void {
    const now = Date.now()
    // One private library per user (unique user_id): later books join it.
    let libraryId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, userId), eq(schema.libraries.type, 'private'))).get()?.id
    if (!libraryId) {
      libraryId = createId('lib')
      db.insert(schema.libraries).values({
        id: libraryId, userId, type: 'private', name: '私密书库', createdAt: now, updatedAt: now,
      }).run()
    }
    const libraryBookId = createId('lb')
    db.insert(schema.bookVersions).values({ id: bookId, format: 'epub', size: 1024, createdAt: now, updatedAt: now }).run()
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: bookId, revisionNo: 1, blobKey, size: 1024, createdAt: now,
    }).run()
    db.insert(schema.libraryBooks).values({
      id: libraryBookId, libraryId, userId, title, author: '', createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId, libraryBookId, bookVersionId: bookId, kind: 'personal', createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.bookStates).values({
      userId, bookVersionId: bookId, readStatus: 'reading', percent: 0, updatedAt: now,
    }).run()
  }

  const datasetKey = 'key:test'
  const bookKey = 'CB_TARGET'

  function proposal(overrides?: Partial<ImportProposal>): ImportProposal {
    return {
      books: [{ sourceBookId: bookKey, title: '目标书', author: '作者', coverUrl: null, finished: null, meta: {} }],
      notes: [
        {
          sourceBookId: bookKey, sourceRecordId: 'n1', kind: 'highlight',
          text: '独一无二的句子只出现一次。', note: null, chapter: '第一章 出发', color: null, locator: '1', chapterIndex: null, createdAt: null,
        },
        {
          sourceBookId: bookKey, sourceRecordId: 'n2', kind: 'highlight',
          text: '重复的一句话。', note: null, chapter: null, color: null, locator: null, chapterIndex: null, createdAt: null,
        },
        {
          sourceBookId: bookKey, sourceRecordId: 'n3', kind: 'idea',
          text: '书里根本找不到的句子。', note: '我的想法', chapter: null, color: null, locator: null, chapterIndex: null, createdAt: null,
        },
      ],
      reviews: [{ sourceBookId: bookKey, sourceRecordId: 'r1', body: '整体不错', rating: 4, createdAt: null }],
      durationFacts: [{
        sourceBookId: bookKey, sourceRecordKey: 'time-1', granularity: 'book_total', date: null,
        seconds: 3600, aggregationRole: 'additive', overlapGroup: null,
      }],
      skipped: 0,
      unprocessable: [],
      ...overrides,
    }
  }

  function archiveId(): string {
    const binding = db.select().from(schema.readingImportBindings).where(and(
      eq(schema.readingImportBindings.userId, userId),
      eq(schema.readingImportBindings.bookKey, bookKey),
    )).get()
    return binding!.targetBookVersionId
  }

  beforeEach(async () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    userId = createId('user')
    db.insert(schema.users).values({ id: userId, username: 'owner', createdAt: Date.now() }).run()
    targetBookId = createId('book')
    blobKey = `blobs/te/${createId('hash')}.epub`
    await fs.mkdir(`${testDataDir}/files`, { recursive: true })
    await getStorage().put(blobKey, await epub())
    seedTargetBook()
  })

  afterAll(async () => {
    await fs.rm(testDataDir, { recursive: true, force: true })
  })

  it('migrates notes, reviews and duration in one transaction and positions what it can', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    const id = archiveId()
    expect(id).toMatch(/^ria_/)

    const result = await mountArchive(userId, id, targetBookId)

    // Two notes carry a position: the unique sentence, and the first candidate
    // of the repeated one. The missing sentence moves without a position.
    expect(result.notes).toEqual({ migrated: 3, positioned: 2, unpositioned: 1, inferred: 1 })
    expect(result.reviews).toBe(1)
    expect(result.durationFacts).toBe(1)

    const notes = db.select().from(schema.highlights)
      .where(eq(schema.highlights.bookVersionId, targetBookId)).all()
    expect(notes).toHaveLength(2)
    expect(notes.every((note) => note.relocation === 'ok' && note.cfiRange !== null)).toBe(true)
    // A positioned note keeps the revision it was resolved against.
    expect(notes.every((note) => note.revisionId !== null)).toBe(true)

    const idea = db.select().from(schema.ideas)
      .where(eq(schema.ideas.bookVersionId, targetBookId)).get()!
    // The idea text is not in the book: no CFI, but the row and its note survive.
    expect(idea.cfiRange).toBeNull()
    expect(idea.relocation).toBe('unresolved')
    expect(idea.note).toBe('我的想法')

    expect(db.select().from(schema.bookReviews).where(eq(schema.bookReviews.userId, userId)).get()!.readBookVersionId)
      .toBe(targetBookId)
    expect(db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.userId, userId)).get()!.bookVersionId)
      .toBe(targetBookId)
    // The archive row is gone; the binding is what still remembers the source.
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.bookVersionId, id)).get()).toBeUndefined()
    const binding = db.select().from(schema.readingImportBindings).where(and(
      eq(schema.readingImportBindings.userId, userId),
      eq(schema.readingImportBindings.bookKey, bookKey),
    )).get()!
    expect(binding.mode).toBe('mounted')
    expect(binding.targetBookVersionId).toBe(targetBookId)
  })

  it('counts records the report never saw in the migrated result', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    const id = archiveId()
    // A note deleted while the report was being read: absent from the report
    // (it only loads live rows) but it still moves with the archive, and the
    // result must count it instead of echoing report.total.
    const doomed = db.select().from(schema.highlights).where(and(
      eq(schema.highlights.userId, userId), eq(schema.highlights.bookVersionId, id),
    )).all().at(-1)!
    db.update(schema.highlights).set({ deletedAt: Date.now() }).where(eq(schema.highlights.id, doomed.id)).run()

    const result = await mountArchive(userId, id, targetBookId)

    // 2 highlights + 1 idea move — including the deleted one the report never
    // saw (a report.total echo would say 2); a locally deleted note stays deleted.
    expect(result.notes).toEqual({ migrated: 3, positioned: 1, unpositioned: 2, inferred: 0 })
    const moved = db.select().from(schema.highlights).where(and(
      eq(schema.highlights.bookVersionId, targetBookId), eq(schema.highlights.id, doomed.id),
    )).get()
    expect(moved).toBeDefined()
    expect(moved!.deletedAt).not.toBeNull()
  })

  it('positions against the current revision, not the one the preview saw', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    const id = archiveId()
    const original = await buildLocatorReport(userId, id, targetBookId)
    expect(original.located).toBe(1)

    // A new revision lands after the user looked at the report. The mount
    // recomputes instead of trusting the stale copy, so the notes land on the
    // bytes that are actually there now.
    const newRevisionId = createId('rev')
    db.insert(schema.contentRevisions).values({
      id: newRevisionId, bookVersionId: targetBookId, revisionNo: 2, blobKey, size: 1024, createdAt: Date.now(),
    }).run()

    const result = await mountArchive(userId, id, targetBookId)

    expect(result.notes.positioned).toBe(2)
    const positioned = db.select().from(schema.highlights).where(eq(schema.highlights.bookVersionId, targetBookId)).all()
      .filter((row) => row.revisionId !== null)
    expect(positioned).toHaveLength(2)
    expect(positioned.every((row) => row.revisionId === newRevisionId)).toBe(true)
  })

  it('keeps the note but drops the position when the book already highlights it', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    const id = archiveId()
    const report = await buildLocatorReport(userId, id, targetBookId)
    const occupied = report.items.find((item) => item.cfiRange !== null)!.cfiRange!
    db.insert(schema.highlights).values({
      id: createId('hl'), userId, bookVersionId: targetBookId, revisionId: null,
      cfiRange: occupied, color: 'yellow', style: 'highlight', text: '独一无二的句子只出现一次。',
      relocation: 'ok', createdAt: Date.now(), updatedAt: Date.now(),
    }).run()

    const result = await mountArchive(userId, id, targetBookId)

    expect(result.notes.migrated).toBe(3)
    expect(result.notes.positioned).toBe(1)
    expect(result.notes.inferred).toBe(1)
    const own = db.select().from(schema.highlights).where(and(
      eq(schema.highlights.userId, userId),
      eq(schema.highlights.bookVersionId, targetBookId),
    )).all()
    // The pre-existing highlight plus the two migrated highlight rows; the
    // conflicting record arrived without a position instead of colliding with
    // the unique index, and the pre-existing range is still the only owner.
    expect(own).toHaveLength(3)
    expect(own.filter((row) => row.cfiRange === occupied)).toHaveLength(1)
  })

  it('does not rebuild an archive when the mounted book is imported again', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    const id = archiveId()
    await mountArchive(userId, id, targetBookId)

    // The same source data, imported again: the binding points at the real
    // book, so nothing new is created and the notes stay where they were.
    const second = await applyImport(userId, 'weread', datasetKey, proposal(), 'all')

    expect(second.books).toEqual({ new: 0, updated: 0 })
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(0)
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.bookVersionId, targetBookId)).all()).toHaveLength(2)
    expect(db.select().from(schema.readingImportBindings).where(eq(schema.readingImportBindings.userId, userId)).get()!.mode).toBe('mounted')
    expect(second.notes.new + second.notes.updated).toBe(0)
  })

  it('positions records that arrive after the mount, since no archive is left to mount', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    await mountArchive(userId, archiveId(), targetBookId)

    // A record the reader made in the source after mounting. The mounted tab
    // exists to keep such records coming, so it has to land with a position.
    const later = proposal({
      notes: [
        ...proposal().notes,
        {
          sourceBookId: bookKey, sourceRecordId: 'n4', kind: 'highlight',
          text: '这里也有一句重复的一句话。', note: null, chapter: '第二章 抵达', color: null, locator: '900', chapterIndex: null, createdAt: null,
        },
      ],
    })
    const result = await applyImport(userId, 'weread', datasetKey, later, 'all')

    expect(result.books).toEqual({ new: 0, updated: 0 })
    expect(result.notes.new).toBe(1)
    const arrived = db.select().from(schema.highlights).where(and(
      eq(schema.highlights.userId, userId),
      eq(schema.highlights.bookVersionId, targetBookId),
      eq(schema.highlights.text, '这里也有一句重复的一句话。'),
    )).get()
    expect(arrived?.cfiRange).toBeTruthy()
    expect(arrived?.relocation).toBe('ok')
    expect(arrived?.chapter).toBe('第二章 抵达')
    // No second archive, no second copy of the book.
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(0)
  })

  it('adapts chapter names to the mounted book and keeps them across re-imports', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    await mountArchive(userId, archiveId(), targetBookId)

    // A post-mount record whose source chapter name lacks the space the book's
    // own heading has: the stored name follows the book, not the source.
    const later = proposal({
      notes: [{
        sourceBookId: bookKey, sourceRecordId: 'n4', kind: 'highlight',
        text: '这里也有一句重复的一句话。', note: null, chapter: '第二章抵达', color: null, locator: '900', chapterIndex: null, createdAt: null,
      }],
    })
    const result = await applyImport(userId, 'weread', datasetKey, later, 'all')
    expect(result.notes.new).toBe(1)
    const arrived = db.select().from(schema.highlights).where(and(
      eq(schema.highlights.userId, userId),
      eq(schema.highlights.bookVersionId, targetBookId),
      eq(schema.highlights.text, '这里也有一句重复的一句话。'),
    )).get()!
    expect(arrived.chapter).toBe('第二章 抵达')

    // Re-importing the same record must not revert the adapted name.
    const again = await applyImport(userId, 'weread', datasetKey, later, 'all')
    expect(again.notes.new + again.notes.updated).toBe(0)
    expect(again.conflicts).toHaveLength(0)
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.id, arrived.id)).get()!.chapter).toBe('第二章 抵达')
  })

  it('updates a mount-corrected row cleanly when the source moved, keeping the adapted chapter', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    await mountArchive(userId, archiveId(), targetBookId)

    // Age the row to the pre-adaptation world: the source-payload import hash
    // and a chapter name a mount had already rewritten to the book's heading.
    const row = db.select().from(schema.highlights).where(and(
      eq(schema.highlights.userId, userId),
      eq(schema.highlights.text, '独一无二的句子只出现一次。'),
    )).get()!
    db.update(schema.highlights).set({
      chapter: '第1章 出发',
      importHash: createHash('sha256').update(JSON.stringify([row.text, null, '第一章 出发', 'yellow', '1'])).digest('hex'),
    }).where(eq(schema.highlights.id, row.id)).run()

    // The source moved on; the row was never edited, so the source wins and
    // the adapted chapter survives instead of surfacing as a conflict.
    const changed = proposal({
      notes: [{
        sourceBookId: bookKey, sourceRecordId: 'n1', kind: 'highlight',
        text: '独一无二的句子只出现一次，改。', note: null, chapter: '第一章 出发', color: null, locator: '1', chapterIndex: null, createdAt: null,
      }],
    })
    const result = await applyImport(userId, 'weread', datasetKey, changed, 'all')
    expect(result.conflicts).toHaveLength(0)
    expect(result.notes.updated).toBe(1)
    const updated = db.select().from(schema.highlights).where(eq(schema.highlights.id, row.id)).get()!
    expect(updated.text).toBe('独一无二的句子只出现一次，改。')
    expect(updated.chapter).toBe('第1章 出发')
  })

  it('re-baselines pre-adaptation import hashes instead of flagging spurious conflicts', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    await mountArchive(userId, archiveId(), targetBookId)

    const row = db.select().from(schema.highlights).where(and(
      eq(schema.highlights.userId, userId),
      eq(schema.highlights.text, '独一无二的句子只出现一次。'),
    )).get()!
    db.update(schema.highlights).set({
      importHash: createHash('sha256').update(JSON.stringify([row.text, null, row.chapter, 'yellow', '1'])).digest('hex'),
    }).where(eq(schema.highlights.id, row.id)).run()

    const again = await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    expect(again.notes.new + again.notes.updated).toBe(0)
    expect(again.conflicts).toHaveLength(0)
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.id, row.id)).get()!.chapter).toBe(row.chapter)
  })

  it('revives a record the reader deleted instead of refusing to import it', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    await mountArchive(userId, archiveId(), targetBookId)

    const target = db.select().from(schema.highlights).where(and(
      eq(schema.highlights.userId, userId),
      eq(schema.highlights.text, '独一无二的句子只出现一次。'),
    )).get()!
    expect(target.cfiRange).toBeTruthy()
    db.update(schema.highlights).set({ deletedAt: Date.now() }).where(eq(schema.highlights.id, target.id)).run()

    const again = await applyImport(userId, 'weread', datasetKey, proposal(), 'all')

    expect(again.notes.updated).toBe(1)
    const revived = db.select().from(schema.highlights).where(eq(schema.highlights.id, target.id)).get()!
    expect(revived.deletedAt).toBeNull()
    // Same row, so the position it already had survives the round trip.
    expect(revived.cfiRange).toBe(target.cfiRange)
  })
  it('mounts an orphaned archive from a deleted local book onto a new target book', async () => {
    const orphanId = 'orphan-book-version'
    const now = Date.now()

    // 1. Create an orphaned reading archive without importSource (as left by book deletion)
    db.insert(schema.readingArchives).values({
      userId,
      bookVersionId: orphanId,
      title: '旧版书籍档案',
      author: '原作者',
      format: 'epub',
      coverKey: null,
      createdAt: now,
      updatedAt: now,
    }).run()

    // 2. Attach a highlight and an idea to this orphaned archive
    db.insert(schema.highlights).values({
      id: 'hl-orphan-1',
      userId,
      bookVersionId: orphanId,
      text: '独一无二的句子只出现一次。',
      color: 'yellow',
      cfiRange: null,
      revisionId: null,
      relocation: 'unresolved',
      createdAt: now,
      updatedAt: now,
    }).run()

    db.insert(schema.ideas).values({
      id: 'idea-orphan-1',
      userId,
      bookVersionId: orphanId,
      text: '书里根本找不到的句子。',
      content: '很精彩的观点',
      cfiRange: null,
      revisionId: null,
      relocation: 'unresolved',
      createdAt: now,
      updatedAt: now,
    }).run()

    // 3. Mount the orphaned archive onto the real target book
    const result = await mountArchive(userId, orphanId, targetBookId)

    expect(result.notes.migrated).toBe(2)
    expect(result.notes.positioned).toBe(1)

    // The orphaned archive row is removed
    const leftover = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.bookVersionId, orphanId)).get()
    expect(leftover).toBeUndefined()

    // Highlights & ideas now belong to the target book with valid cfiRange
    const movedHighlight = db.select().from(schema.highlights).where(eq(schema.highlights.id, 'hl-orphan-1')).get()!
    expect(movedHighlight.bookVersionId).toBe(targetBookId)
    expect(movedHighlight.cfiRange).toBeTruthy()

    const movedIdea = db.select().from(schema.ideas).where(eq(schema.ideas.id, 'idea-orphan-1')).get()!
    expect(movedIdea.bookVersionId).toBe(targetBookId)
    expect(movedIdea.cfiRange).toBeNull()

    // No import binding created because it was not an external import source
    const bindings = db.select().from(schema.readingImportBindings).where(eq(schema.readingImportBindings.targetBookVersionId, targetBookId)).all()
    expect(bindings).toHaveLength(0)
  })

  it('re-points the import binding when the snapshot of a deleted mounted book is mounted again', async () => {
    await applyImport(userId, 'weread', datasetKey, proposal(), 'all')
    await mountArchive(userId, archiveId(), targetBookId)

    // A native note the reader made in the mounted book: a keep-data deletion
    // keeps it alongside the imported ones on the same snapshot.
    db.insert(schema.highlights).values({
      id: 'hl-native', userId, bookVersionId: targetBookId, revisionId: null,
      cfiRange: null, color: 'yellow', style: 'highlight', text: '书里根本找不到的句子。',
      relocation: 'unresolved', createdAt: Date.now(), updatedAt: Date.now(),
    }).run()

    savePersonalBookSnapshot(db, userId, targetBookId, { title: '目标书', author: '', format: 'epub', coverKey: null })
    const snapshot = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.bookVersionId, targetBookId)).get()!
    expect(snapshot.importSource).toBe('weread')
    expect(snapshot.importBookKey).toBe(bookKey)

    const secondBookId = createId('book')
    seedTargetBook(secondBookId, '第二本')

    const result = await mountArchive(userId, targetBookId, secondBookId)

    // Imported and native records move together: 2 imported highlights +
    // 1 imported idea + 1 native highlight; the two locatable highlights land
    // on the new bytes, idea and native text stay unpositioned.
    expect(result.notes.migrated).toBe(4)
    expect(result.notes.positioned).toBe(2)
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(0)
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.bookVersionId, secondBookId)).all()).toHaveLength(3)
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.bookVersionId, secondBookId)).all()).toHaveLength(1)
    // The binding follows the mount instead of staying on the dead book, so
    // the next re-import writes into the new target.
    const binding = db.select().from(schema.readingImportBindings).where(and(
      eq(schema.readingImportBindings.userId, userId),
      eq(schema.readingImportBindings.bookKey, bookKey),
    )).get()!
    expect(binding.mode).toBe('mounted')
    expect(binding.targetBookVersionId).toBe(secondBookId)
  })

  it('stamps no import identity on a snapshot no binding points at', () => {
    savePersonalBookSnapshot(db, userId, targetBookId, { title: '目标书', author: '', format: 'epub', coverKey: null })
    const snapshot = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.bookVersionId, targetBookId)).get()!
    expect(snapshot.importSource).toBeNull()
  })
})