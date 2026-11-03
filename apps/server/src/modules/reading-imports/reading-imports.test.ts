import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq } from 'drizzle-orm'
import JSZip from 'jszip'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { getByBook, getDaily, getSummary } from '../reading-records/reading-records.service'
import { deleteReadingArchive, getReadingLedger, getReadingLedgerStats } from '../reading-records/reading-ledger.service'
import { getBookDetail, getOverview, listBooks } from '../archive/archive.service'
import { exportNotes } from '../archive/archive.service'
import { parseLegadoBackup } from './legado-import'
import { applyImport, applyWereadImport, buildPreview, commitImportInTx, prepareImport, scopeProposal, selectProposalBooks, wereadDatasetKey, type ImportProposal } from './reading-imports.service'

function wereadProposal(sourceBookId: string): ImportProposal {
  return {
    books: [{ sourceBookId, title: `书 ${sourceBookId}`, author: '', coverUrl: null, finished: null, meta: {} }],
    notes: [{ sourceBookId, sourceRecordId: 'n1', kind: 'highlight', text: '一条划线', note: null, chapter: null, color: null, locator: null, chapterIndex: null, createdAt: null }],
    reviews: [],
    durationFacts: [],
    skipped: 0,
    unprocessable: [],
  }
}

type TestDb = ReturnType<typeof drizzle<typeof schema>>

async function legadoBackup(files: Record<string, unknown>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, value] of Object.entries(files)) {
    zip.file(name, JSON.stringify(value))
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('reading imports', () => {
  let db: TestDb
  let ownerId: string
  let otherId: string

  beforeEach(async () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    ownerId = createId('user')
    db.insert(schema.users).values({ id: ownerId, username: 'owner', createdAt: Date.now() }).run()
    otherId = createId('user')
    db.insert(schema.users).values({ id: otherId, username: 'other', createdAt: Date.now() }).run()
  })

  const legadoFiles = {
    'bookshelf.json': [
      { name: '三体', author: '刘慈欣', origin: 'loc_book:///sdcard/三体.txt', coverUrl: 'http://x/cover.jpg' },
      { name: '笔记书', author: '作者乙' },
    ],
    'bookmark.json': [
      { bookName: '三体', bookAuthor: '刘慈欣', time: 1700000000000, chapterName: '第一章', chapterIndex: 3, bookText: '黑暗森林' },
      { bookName: '笔记书', bookAuthor: '作者乙', time: 1700000100000, chapterName: '序', chapterIndex: 0, bookText: '原文', content: '我的想法' },
    ],
    'readRecord.json': [
      { deviceId: 'phone', bookName: '三体', readTime: 3600_000 },
    ],
  }

  it('imports a legado backup into unified archives with notes and totals', async () => {
    const proposal = await parseLegadoBackup(await legadoBackup(legadoFiles))
    expect(proposal.books).toHaveLength(2)
    expect(proposal.notes).toHaveLength(2)
    expect(proposal.unprocessable).toEqual([])

    const preview = buildPreview(ownerId, 'legado', '', proposal, 'all')
    expect(preview.items.map((item) => [item.title, item.status, item.notes, item.selectable])).toEqual([
      ['三体', 'new', 1, true],
      ['笔记书', 'new', 1, true],
    ])
    expect(preview.items.find((item) => item.title === '三体')!.durationFacts).toBe(1)

    const result = await applyImport(ownerId, 'legado', '', proposal, 'all')
    expect(result.books).toEqual({ new: 2, updated: 0 })

    const archives = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all()
    expect(archives).toHaveLength(2)
    const santi = archives.find((row) => row.title === '三体')!
    expect(santi.importSource).toBe('legado')
    const totalFact = db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.bookVersionId, santi.bookVersionId)).get()!
    expect(totalFact).toMatchObject({ granularity: 'book_total', durationSeconds: 3600, aggregationRole: 'additive', date: null })
    expect(santi.coverUrl).toBe('http://x/cover.jpg')
    expect(santi.legacyDaily).toEqual([])
    const notes = db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()
    const ideas = db.select().from(schema.ideas).where(eq(schema.ideas.userId, ownerId)).all()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ text: '黑暗森林', cfiRange: null, relocation: 'unresolved', chapter: '第一章', importChapterIndex: 3 })
    expect(ideas).toHaveLength(1)
    expect(ideas[0]).toMatchObject({ text: '原文', note: '我的想法', visibility: 'private' })

    // The archive list and detail show imported books through the unified paths.
    const list = await listBooks(ownerId, { sort: 'recent', page: 1, pageSize: 20 })
    const row = list.entries.find((entry) => entry.bookVersionId === santi.bookVersionId)!
    expect(row).toMatchObject({ title: '三体', author: '刘慈欣', imported: true, coverUrl: 'http://x/cover.jpg', highlights: 1 })
    expect(row.durationSeconds).toBe(3600)
    const detail = await getBookDetail(ownerId, santi.bookVersionId)
    expect(detail.annotations).toHaveLength(1)
    expect(detail.annotations[0]).toMatchObject({ text: '黑暗森林', cfiRange: null, locationAvailable: false, importChapterIndex: 3 })

    // Export includes imported notes like native ones.
    const exported = await exportNotes(ownerId)
    const exportedBook = exported.books.find((book) => book.bookId === santi.bookVersionId)!
    expect(exportedBook).toMatchObject({ title: '三体' })
    expect(exportedBook.highlights[0]).toMatchObject({ text: '黑暗森林', cfiRange: null })

    // Totals-only duration joins all-time totals only (no dates).
    const today = '2026-11-01'
    const summary = await getSummary(ownerId, today)
    expect(summary.totalSeconds).toBe(3600)
    expect(summary.totalDays).toBe(0)
    expect(summary.totalBooks).toBe(1)
  })

  it('imports a Web time-only selection through the regular archive and duration pipeline', async () => {
    const proposal: ImportProposal = {
      books: [{ sourceBookId: 'web-only-book', title: '只有时长的书', author: '作者', coverUrl: null, finished: false, meta: {} }],
      notes: [],
      reviews: [],
      durationFacts: [{
        sourceBookId: 'web-only-book',
        sourceRecordKey: 'web-day:web-only-book:2026-10-31',
        granularity: 'book_day',
        date: '2026-10-31',
        seconds: 3222,
        aggregationRole: 'additive',
      }],
      skipped: 0,
      unprocessable: [],
    }

    const result = await applyImport(ownerId, 'weread', 'vid:306734116', proposal, 'time')

    expect(result.books).toEqual({ new: 1, updated: 0 })
    expect(result.durationFacts).toEqual({ new: 1, updated: 0, unchanged: 0 })
    const archive = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).get()!
    const fact = db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.userId, ownerId)).get()!
    expect(archive).toMatchObject({ title: '只有时长的书', importSource: 'weread', importAccountKey: 'vid:306734116' })
    expect(fact).toMatchObject({ bookVersionId: archive.bookVersionId, granularity: 'book_day', date: '2026-10-31', durationSeconds: 3222 })
  })

  it('reuses an existing Skill binding for Web notes and daily time by book identity', async () => {
    const skillKey = wereadDatasetKey('wrk-test')
    const existing: ImportProposal = {
      books: [{ sourceBookId: 'same-book', title: '同一本书', author: '作者', coverUrl: null, finished: null, meta: {} }],
      notes: [{ sourceBookId: 'same-book', sourceRecordId: 'note-1', kind: 'highlight', text: '已有划线', note: null, chapter: null, color: null, locator: null, chapterIndex: null, createdAt: null }],
      reviews: [], durationFacts: [], skipped: 0, unprocessable: [],
    }
    await applyImport(ownerId, 'weread', skillKey, existing, 'all')
    const existingArchive = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).get()!

    const webProposal: ImportProposal = {
      ...existing,
      notes: [...existing.notes, { sourceBookId: 'same-book', sourceRecordId: 'note-2', kind: 'idea', text: '引用', note: '想法', chapter: null, color: null, locator: null, chapterIndex: null, createdAt: null }],
      durationFacts: [{ sourceBookId: 'same-book', sourceRecordKey: 'web-day:same-book:2026-10-31', granularity: 'book_day', date: '2026-10-31', seconds: 3222, aggregationRole: 'additive' }],
    }
    await applyWereadImport(ownerId, 'vid:306734116', webProposal, 'all')

    const archives = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all()
    const day = db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.userId, ownerId)).get()!
    expect(archives).toHaveLength(1)
    expect(archives[0]).toMatchObject({ bookVersionId: existingArchive.bookVersionId, importAccountKey: skillKey })
    expect(day).toMatchObject({ bookVersionId: existingArchive.bookVersionId, sourceNamespace: skillKey, granularity: 'book_day', date: '2026-10-31' })
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(1)
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.userId, ownerId)).all()).toHaveLength(1)
  })

  it('marks books the chosen scope leaves empty as not selectable', async () => {
    const proposal = await parseLegadoBackup(await legadoBackup(legadoFiles))
    const timeScope = buildPreview(ownerId, 'legado', '', proposal, 'time')
    expect(timeScope.items.map((item) => [item.title, item.durationFacts, item.selectable])).toEqual([
      ['三体', 1, true],
      // Only a bookmark, no readRecord: nothing to import in a time-only pass.
      ['笔记书', 0, false],
    ])
    const notesScope = buildPreview(ownerId, 'legado', '', proposal, 'notes')
    expect(notesScope.items.every((item) => item.durationFacts === 0 && item.selectable)).toBe(true)
  })

  it('imports only the ticked books from a preview snapshot', async () => {
    const proposal = await parseLegadoBackup(await legadoBackup(legadoFiles))
    const noteBook = proposal.books.find((book) => book.title === '笔记书')!.sourceBookId

    const result = await applyImport(ownerId, 'legado', '', selectProposalBooks(proposal, [noteBook]), 'all')
    expect(result.books).toEqual({ new: 1, updated: 0 })
    expect(result.notes).toEqual({ new: 1, updated: 0, unchanged: 0 })
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all())
      .toMatchObject([{ title: '笔记书' }])
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(0)
    expect(db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.userId, ownerId)).all()).toHaveLength(0)

    // An empty selection is a real choice: nothing is created.
    expect((await applyImport(ownerId, 'legado', '', selectProposalBooks(proposal, []), 'all')).books).toEqual({ new: 0, updated: 0 })
  })

  it('keeps source format and finished state on the archive, list, and re-import', async () => {
    const book = (overrides: Partial<ImportProposal['books'][number]> = {}) => ({
      sourceBookId: 'b-format',
      title: '已读完的书',
      author: '作者甲',
      coverUrl: null,
      finished: true as boolean | null,
      meta: { format: 'epub' } as Record<string, unknown>,
      ...overrides,
    })
    const proposal = (overrides: Partial<ImportProposal['books'][number]> = {}): ImportProposal => ({
      books: [book(overrides)], notes: [], reviews: [], durationFacts: [], skipped: 0, unprocessable: [],
    })

    await applyImport(ownerId, 'weread', 'vid:reader', proposal(), 'all')
    const archive = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).get()!
    expect(archive.format).toBe('epub')
    expect(archive.meta).toMatchObject({ format: 'epub', finished: true })

    // A book with no notes still reaches the list, and carries the source
    // format plus a finished status derived from the archive metadata.
    const list = await listBooks(ownerId, { sort: 'recent', page: 1, pageSize: 20 })
    expect(list.entries).toHaveLength(1)
    expect(list.entries[0]).toMatchObject({ format: 'epub', readStatus: 'finished', imported: true })

    // Re-import picks up a changed finished flag but never downgrades a known
    // format to unknown just because the source stopped reporting one.
    const second = proposal({ finished: false, meta: { format: 'pdf' } })
    expect(buildPreview(ownerId, 'weread', 'vid:reader', second, 'all').items[0]).toMatchObject({ status: 'imported', selectable: true })
    await applyImport(ownerId, 'weread', 'vid:reader', second, 'all')
    const updated = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).get()!
    expect(updated.format).toBe('epub')
    expect(updated.meta).toMatchObject({ finished: false })
    expect((await listBooks(ownerId, { sort: 'recent', page: 1, pageSize: 20 })).entries[0].readStatus).toBeNull()

    // Nothing changed on the third pass, so it is not counted as an update.
    expect((await applyImport(ownerId, 'weread', 'vid:reader', second, 'all')).books).toEqual({ new: 0, updated: 0 })
  })

  it('re-imports safely: unchanged skip, changed update, totals max-merge, delete-then-reimport recreates', async () => {
    const proposal = await parseLegadoBackup(await legadoBackup(legadoFiles))
    await applyImport(ownerId, 'legado', '', proposal, 'all')

    const again = buildPreview(ownerId, 'legado', '', proposal, 'all')
    expect(again.items.map((item) => item.status)).toEqual(['imported', 'imported'])
    expect(again.items.map((item) => item.notes)).toEqual([1, 1])
    const rerun = await applyImport(ownerId, 'legado', '', proposal, 'all')
    expect(rerun.notes).toEqual({ new: 0, updated: 0, unchanged: 2 })

    // Per-device cumulative facts update by their stable source key.
    const moreTime = await parseLegadoBackup(await legadoBackup({
      'bookshelf.json': legadoFiles['bookshelf.json'],
      'bookmark.json': [],
      'readRecord.json': [{ deviceId: 'phone', bookName: '三体', readTime: 7200_000 }],
    }))
    const merged = await applyImport(ownerId, 'legado', '', moreTime, 'all')
    expect(merged.notes).toEqual({ new: 0, updated: 0, unchanged: 0 })
    const santi = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all().find((row) => row.title === '三体')!
    expect(db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.bookVersionId, santi.bookVersionId)).get()?.durationSeconds).toBe(7200)

    // A changed note updates in place; a deleted archive is recreated on re-import.
    const changed = await parseLegadoBackup(await legadoBackup({
      'bookshelf.json': legadoFiles['bookshelf.json'],
      'bookmark.json': [{ ...legadoFiles['bookmark.json'][0], bookText: '黑暗森林之上' }],
      'readRecord.json': [],
    }))
    const updated = await applyImport(ownerId, 'legado', '', changed, 'all')
    expect(updated.notes).toEqual({ new: 0, updated: 1, unchanged: 0 })
    const highlights = db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()
    expect(highlights).toHaveLength(1)
    expect(highlights[0].text).toBe('黑暗森林之上')

    deleteReadingArchive(ownerId, santi.bookVersionId)
    expect(db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.bookVersionId, santi.bookVersionId)).all()).toHaveLength(0)
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(1)
    const recreated = await applyImport(ownerId, 'legado', '', proposal, 'all')
    expect(recreated.books).toEqual({ new: 0, updated: 0 })
    expect(db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.bookVersionId, santi.bookVersionId)).get()?.durationSeconds).toBe(3600)
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(1)
  })

  it('moves a legado bookmark to an idea when it gains a note', async () => {
    const before = await parseLegadoBackup(await legadoBackup({
      'bookshelf.json': [{ name: '笔记书', author: '作者乙' }],
      'bookmark.json': [{ bookName: '笔记书', bookAuthor: '作者乙', time: 1700000100000, chapterName: '序', chapterIndex: 0, bookText: '原文' }],
      'readRecord.json': [],
    }))
    await applyImport(ownerId, 'legado', '', before, 'all')
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(1)

    const after = await parseLegadoBackup(await legadoBackup({
      'bookshelf.json': [{ name: '笔记书', author: '作者乙' }],
      'bookmark.json': [{ bookName: '笔记书', bookAuthor: '作者乙', time: 1700000100000, chapterName: '序', chapterIndex: 0, bookText: '原文', content: '想法' }],
      'readRecord.json': [],
    }))
    const result = await applyImport(ownerId, 'legado', '', after, 'all')
    expect(result.notes).toEqual({ new: 0, updated: 1, unchanged: 0 })
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(0)
    const ideas = db.select().from(schema.ideas).where(eq(schema.ideas.userId, ownerId)).all()
    expect(ideas).toHaveLength(1)
    expect(ideas[0]).toMatchObject({ text: '原文', note: '想法' })
  })

  it('protects user edits and restores deleted notes on re-import', async () => {
    const original = await parseLegadoBackup(await legadoBackup({
      'bookshelf.json': [{ name: 'Notes', author: 'Writer' }],
      'bookmark.json': [
        { bookName: 'Notes', bookAuthor: 'Writer', time: 1700000000000, chapterName: 'One', bookText: 'Quote' },
        { bookName: 'Notes', bookAuthor: 'Writer', time: 1700000001000, chapterName: 'Two', bookText: 'Idea quote', content: 'Source thought' },
      ],
      'readRecord.json': [],
    }))
    await applyImport(ownerId, 'legado', '', original, 'all')
    const archive = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).get()!
    const highlight = db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).get()!
    const idea = db.select().from(schema.ideas).where(eq(schema.ideas.userId, ownerId)).get()!

    db.update(schema.highlights).set({ text: 'My edited quote', updatedAt: highlight.createdAt + 1 }).where(eq(schema.highlights.id, highlight.id)).run()
    db.update(schema.ideas).set({ note: 'My edited thought', updatedAt: idea.createdAt + 1 }).where(eq(schema.ideas.id, idea.id)).run()
    const changedSource = await parseLegadoBackup(await legadoBackup({
      'bookshelf.json': [{ name: 'Notes', author: 'Writer' }],
      'bookmark.json': [
        { bookName: 'Notes', bookAuthor: 'Writer', time: 1700000000000, chapterName: 'One', bookText: 'Updated source quote' },
        { bookName: 'Notes', bookAuthor: 'Writer', time: 1700000001000, chapterName: 'Two', bookText: 'Updated source idea', content: 'Updated source thought' },
      ],
      'readRecord.json': [],
    }))
    const preserved = await applyImport(ownerId, 'legado', '', changedSource, 'all')
    expect(preserved.notes).toEqual({ new: 0, updated: 0, unchanged: 0 })
    // Both sides moved, so neither version wins by default: nothing is written
    // and the report names the two records instead of hiding a bare count.
    expect(preserved.unprocessable).toEqual([])
    expect(preserved.conflicts.map((conflict) => conflict.kind).sort()).toEqual(['highlight', 'idea'])
    expect(preserved.conflicts.find((conflict) => conflict.kind === 'highlight')).toMatchObject({
      incomingText: 'Updated source quote',
      localText: 'My edited quote',
    })
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.id, highlight.id)).get()?.text).toBe('My edited quote')
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.id, idea.id)).get()?.note).toBe('My edited thought')

    db.update(schema.highlights).set({ deletedAt: Date.now() }).where(eq(schema.highlights.id, highlight.id)).run()
    db.update(schema.ideas).set({ deletedAt: Date.now() }).where(eq(schema.ideas.id, idea.id)).run()
    const restored = await applyImport(ownerId, 'legado', '', changedSource, 'all')
    // Importing is explicit: a record the reader deleted comes back. Both rows
    // were edited before deletion, so only the tombstone is lifted.
    expect(restored.notes).toEqual({ new: 0, updated: 2, unchanged: 0 })
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.id, highlight.id)).get()).toMatchObject({
      text: 'My edited quote', deletedAt: null,
    })
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.id, idea.id)).get()).toMatchObject({
      text: 'Idea quote', note: 'My edited thought', deletedAt: null,
    })
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all()).toHaveLength(1)
    expect(archive.importSource).toBe('legado')

    // Replacing is the reader's call and applies only to the records named in
    // the retry; the untouched conflict keeps the local version.
    const reopened = await applyImport(ownerId, 'legado', '', changedSource, 'all')
    expect(reopened.conflicts).toHaveLength(2)
    const highlightConflict = reopened.conflicts.find((conflict) => conflict.kind === 'highlight')!
    const replaced = await applyImport(ownerId, 'legado', '', changedSource, 'all', new Set([highlightConflict.key]))
    expect(replaced.conflicts.map((conflict) => conflict.kind)).toEqual(['idea'])
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.id, highlight.id)).get()?.text).toBe('Updated source quote')
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.id, idea.id)).get()?.note).toBe('My edited thought')
    // Once the source version is in place the same import has nothing left to do.
    const settled = await applyImport(ownerId, 'legado', '', changedSource, 'all')
    expect(settled.conflicts).toHaveLength(1)
    expect(settled.notes.updated).toBe(0)
  })

  it('reports ambiguous legado durations instead of guessing', async () => {
    const proposal = await parseLegadoBackup(await legadoBackup({
      'bookshelf.json': [{ name: '同名书', author: '甲' }, { name: '同名书', author: '乙' }],
      'bookmark.json': [],
      'readRecord.json': [{ deviceId: 'phone', bookName: '同名书', readTime: 60000 }],
    }))
    expect(proposal.durationFacts).toMatchObject([{ granularity: 'book_total', date: null, seconds: 60, aggregationRole: 'additive' }])
    expect(proposal.unprocessable).toEqual([{ reason: 'duration-book-author-ambiguous', count: 1 }])
  })

  it('scopes imports so time and notes never cross-contaminate', async () => {
    const proposal = await parseLegadoBackup(await legadoBackup(legadoFiles))
    const timeScoped = scopeProposal(proposal, 'time')
    expect(timeScoped.notes).toEqual([])
    expect(timeScoped.books.map((book) => book.title)).toEqual(['三体'])
    await applyImport(ownerId, 'legado', '', timeScoped, 'time')
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(0)
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.userId, ownerId)).all()).toHaveLength(0)
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all()).toHaveLength(1)

    const notesScoped = scopeProposal(await parseLegadoBackup(await legadoBackup(legadoFiles)), 'notes')
    expect(notesScoped.books.map((book) => book.title).sort()).toEqual(['三体', '笔记书'])
    expect(notesScoped.durationFacts).toEqual([])
    await applyImport(ownerId, 'legado', '', notesScoped, 'notes')
    // The totals-only fact is untouched by the notes scope.
    const santi = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all().find((row) => row.title === '三体')!
    expect(db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.bookVersionId, santi.bookVersionId)).get()?.durationSeconds).toBe(3600)
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(1)
  })

  it('keeps dataset identities separate: same record ids from two accounts never merge', async () => {
    const keyA = wereadDatasetKey('wrk-aaa')
    const keyB = wereadDatasetKey('wrk-bbb')
    const proposal: ImportProposal = {
      books: [{ sourceBookId: 'bk-1', title: 'Same Book', author: 'A', coverUrl: null, finished: null, meta: {} }],
      notes: [{ sourceBookId: 'bk-1', sourceRecordId: 'bm_1_1-2', kind: 'highlight', text: 'from account', note: null, chapter: 'c1', color: null, locator: null, chapterIndex: null, createdAt: 1000 }],
      reviews: [],
      durationFacts: [],
      skipped: 0,
      unprocessable: [],
    }
    await applyImport(ownerId, 'weread', keyA, proposal, 'all')
    await applyImport(ownerId, 'weread', keyB, proposal, 'all')
    const archives = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all()
    expect(archives).toHaveLength(2)
    expect(new Set(archives.map((row) => row.importAccountKey))).toEqual(new Set([keyA, keyB]))
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(2)
    // Re-import into the same dataset stays a single row.
    await applyImport(ownerId, 'weread', keyA, proposal, 'all')
    expect(db.select().from(schema.highlights).where(eq(schema.highlights.userId, ownerId)).all()).toHaveLength(2)
  })

  it('imports whole-book weread reviews with ratings', async () => {
    const proposal: ImportProposal = {
      books: [{ sourceBookId: 'bk-1', title: 'Review Book', author: 'A', coverUrl: null, finished: null, meta: {} }],
      notes: [],
      reviews: [{ sourceBookId: 'bk-1', sourceRecordId: 'rv-1', body: '一本好书', rating: 4, createdAt: 5000 }],
      durationFacts: [],
      skipped: 0,
      unprocessable: [],
    }
    await applyImport(ownerId, 'weread', 'key:x', proposal, 'all')
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all())
      .toMatchObject([{ importSource: 'weread', importAccountKey: 'key:x', importBookKey: 'bk-1' }])
    const reviews = db.select().from(schema.bookReviews).where(eq(schema.bookReviews.userId, ownerId)).all()
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ body: '一本好书', ratingHalves: 8, visibility: 'private' })
    const archiveId = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).get()!.bookVersionId
    const detail = await getBookDetail(ownerId, archiveId)
    expect(detail.reviews).toHaveLength(1)
    db.update(schema.bookReviews).set({ body: 'My edited review', updatedAt: reviews[0].createdAt + 1 })
      .where(eq(schema.bookReviews.id, reviews[0].id)).run()
    const changed = await applyImport(ownerId, 'weread', 'key:x', {
      ...proposal, reviews: [{ ...proposal.reviews[0], body: 'Changed source review' }],
    }, 'all')
    expect(changed.reviews).toEqual({ new: 0, updated: 0, unchanged: 0 })
    expect(changed.unprocessable).toEqual([])
    expect(changed.conflicts).toMatchObject([{ kind: 'review', incomingText: 'Changed source review', localText: 'My edited review' }])
    expect(db.select().from(schema.bookReviews).where(eq(schema.bookReviews.id, reviews[0].id)).get()?.body).toBe('My edited review')
    const replaced = await applyImport(ownerId, 'weread', 'key:x', {
      ...proposal, reviews: [{ ...proposal.reviews[0], body: 'Changed source review' }],
    }, 'all', new Set([changed.conflicts[0]!.key]))
    expect(replaced.conflicts).toEqual([])
    expect(db.select().from(schema.bookReviews).where(eq(schema.bookReviews.id, reviews[0].id)).get()?.body).toBe('Changed source review')
    deleteReadingArchive(ownerId, archiveId)
    // Deleting the archive keeps the reader's review as it stands now.
    expect(db.select().from(schema.bookReviews).where(eq(schema.bookReviews.id, reviews[0].id)).get()?.body).toBe('Changed source review')
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).get()?.bookVersionId).toBe(archiveId)
  })

  it('rejects account-scoped buckets instead of creating a placeholder archive', async () => {
    const proposal: ImportProposal = {
      books: [{ sourceBookId: 'bk-total', title: 'Cumulative Book', author: 'A', coverUrl: null, finished: null, meta: {} }],
      notes: [], reviews: [],
      durationFacts: [
        { sourceBookId: 'bk-total', sourceRecordKey: 'book:bk-total', granularity: 'book_total', date: null, seconds: 900, aggregationRole: 'additive' },
        { sourceBookId: null, sourceRecordKey: 'day:2026-10-30', granularity: 'account_day', date: '2026-10-30', seconds: 300, aggregationRole: 'additive' },
        { sourceBookId: null, sourceRecordKey: 'day:2026-11-01', granularity: 'account_day', date: '2026-11-01', seconds: 120, aggregationRole: 'additive' },
      ],
      skipped: 0, unprocessable: [],
    }
    const datasetKey = wereadDatasetKey('wrk-aaa')
    const result = await applyImport(ownerId, 'weread', datasetKey, proposal, 'all')
    // Unattributable buckets are reported and dropped, never stored (0.10).
    expect(result.unprocessable).toEqual([{ reason: 'duration-unattributable', count: 2 }])
    expect(result.durationFacts).toEqual({ new: 1, updated: 0, unchanged: 0 })

    const archives = db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all()
    expect(archives).toHaveLength(1)
    expect(archives[0].archiveKind).toBe('book')

    const facts = db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.userId, ownerId)).all()
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ granularity: 'book_total', durationSeconds: 900 })

    const summary = await getSummary(ownerId, '2026-11-01')
    expect(summary).toMatchObject({ totalSeconds: 900, todaySeconds: 0, totalDays: 0, totalBooks: 1 })
    expect(await getDaily(ownerId, {})).toEqual([])
    expect((await getByBook(ownerId, {})).find((book) => book.bookId === archives[0].bookVersionId))
      .toMatchObject({ durationSeconds: 900 })
    expect((await getReadingLedger(ownerId, archives[0].bookVersionId)).totalSeconds).toBe(900)
    expect((await getReadingLedgerStats(ownerId, archives[0].bookVersionId)).totalSeconds).toBe(900)
    expect((await listBooks(ownerId, { sort: 'reading-time', page: 1, pageSize: 20 })).entries)
      .toMatchObject([{ bookVersionId: archives[0].bookVersionId, durationSeconds: 900, readingDays: null }])
    expect((await getOverview(ownerId)).totalBooks).toBe(1)

    // Another user importing the same shape keeps their own single archive.
    await applyImport(otherId, 'weread', datasetKey, proposal, 'all')
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, otherId)).all()).toHaveLength(1)
    expect(db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.userId, otherId)).all()).toHaveLength(1)
    deleteReadingArchive(ownerId, archives[0].bookVersionId)
    expect(db.select().from(schema.readingDurationFacts).where(eq(schema.readingDurationFacts.userId, ownerId)).all()).toHaveLength(0)
  })

  it('rolls back every dataset when one group fails at commit time', async () => {
    // Two accounts in one apply: both prepare cleanly, then the second
    // dataset's binding drifts before the (shared) commit transaction opens.
    // Group A carries a REAL new note — an unchanged proposal would write
    // nothing, and the rollback assertion would prove nothing.
    const proposalA = wereadProposal('bk-a')
    const proposalB = wereadProposal('bk-b')
    await applyImport(ownerId, 'weread', 'key:acct-a', proposalA, 'all')
    await applyImport(ownerId, 'weread', 'key:acct-b', proposalB, 'all')

    const freshA = wereadProposal('bk-a')
    freshA.notes.push({
      sourceBookId: 'bk-a', sourceRecordId: 'n2', kind: 'highlight',
      text: 'A 组在本次请求里真正新增的划线', note: null, chapter: null, color: null, locator: null, chapterIndex: null, createdAt: null,
    })
    const prepA = await prepareImport(ownerId, 'weread', 'key:acct-a', freshA, 'all')
    expect(prepA.plan.noteWrites.filter((write) => write.isNew)).toHaveLength(1)
    const prepB = await prepareImport(ownerId, 'weread', 'key:acct-b', proposalB, 'all')
    db.update(schema.readingImportBindings)
      .set({ targetBookVersionId: 'ver_drifted', updatedAt: Date.now() })
      .where(eq(schema.readingImportBindings.accountKey, 'key:acct-b'))
      .run()

    let caught: unknown = null
    try {
      client.getDb().transaction((rawTx) => {
        const tx = rawTx as unknown as Parameters<typeof commitImportInTx>[0]
        commitImportInTx(tx, prepA)
        commitImportInTx(tx, prepB)
      })
    } catch (error) {
      caught = error
    }
    expect((caught as { code?: string }).code).toBe('UPDATE_IN_PROGRESS')

    // Group A's note insert shared the transaction: rolled back with group B's
    // refusal — the new highlight must not exist, and nothing else moved.
    const archiveA = db.select().from(schema.readingArchives).where(and(
      eq(schema.readingArchives.userId, ownerId), eq(schema.readingArchives.importBookKey, 'bk-a'),
    )).get()!
    const notesA = db.select().from(schema.highlights).where(eq(schema.highlights.bookVersionId, archiveA.bookVersionId)).all()
    expect(notesA).toHaveLength(1)
    expect(notesA[0]!.text).toBe('一条划线')
    expect(db.select().from(schema.readingArchives).where(eq(schema.readingArchives.userId, ownerId)).all())
      .toHaveLength(2)
  })
})
