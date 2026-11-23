import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirementIncluding as migrate } from '../../db/migration-stage'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { classificationValueKey } from '@bookdock/shared'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { updateCategoryValue } from '../classification/classification.service'
import { getBook, savePrivateBook } from '../books/books.service'
import {
  deleteExternalBook,
  getExternalBook,
  listExternalBooks,
  listExternalLibraries,
  updateExternalBook,
} from './ext.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '../../db/migrations') }, [])
  return db
}

describe('external API projection', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let memberId: string
  let privateLibraryId: string
  let sharedLibraryId: string

  function seedUser(username: string) {
    const id = createId('user')
    db.insert(schema.users).values({ id, username, passwordHash: null, role: 'member', createdAt: 1 }).run()
    return id
  }

  function seedLibrary(id: string, userId: string, type: 'private' | 'shared', name: string) {
    db.insert(schema.libraries).values({
      id, userId, type, name, description: '', visibility: type === 'shared' ? 'password' : null, createdAt: 1, updatedAt: 1,
    }).run()
  }

  /**
   * One version in `libraryId`, with the revision timestamp the sync watermark
   * is derived from.
   */
  function seedVersion(
    libraryId: string,
    userId: string,
    opts: { title: string; revisionAt: number; workUpdatedAt?: number; hidden?: boolean; status?: 'published' | 'unlisted'; sameVersionAs?: string },
  ) {
    const workId = createId('lbook')
    // The same file linked into a second library is one version id in two
    // libraries, which is what a real cross-library copy looks like.
    const versionId = opts.sameVersionAs ?? createId('book')
    const createdAt = opts.revisionAt - 1000
    db.insert(schema.libraryBooks).values({
      id: workId, libraryId, userId, title: opts.title, author: 'A', createdAt, updatedAt: opts.workUpdatedAt ?? createdAt, hidden: opts.hidden ?? false,
    }).run()
    if (!opts.sameVersionAs) {
      db.insert(schema.bookVersions).values({ id: versionId, format: 'epub', size: 100, createdAt, updatedAt: createdAt }).run()
    }
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId, libraryBookId: workId, bookVersionId: versionId,
      kind: 'personal', status: opts.status ?? 'published', createdAt, updatedAt: createdAt,
    }).run()
    if (!opts.sameVersionAs) {
      db.insert(schema.contentRevisions).values({
        id: createId('rev'), bookVersionId: versionId, revisionNo: 1, blobKey: `blobs/aa/${versionId}.epub`,
        size: 100, chapterCount: 1, wordCount: 10, meta: { fileName: `${opts.title}.epub` }, createdAt: opts.revisionAt,
      }).run()
    }
    return { workId, versionId }
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    ownerId = seedUser('owner')
    memberId = seedUser('member')
    privateLibraryId = createId('lib')
    seedLibrary(privateLibraryId, ownerId, 'private', '')
    sharedLibraryId = createId('lib')
    seedLibrary(sharedLibraryId, ownerId, 'shared', 'Book Club')
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedLibraryId, userId: memberId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
  })

  it('lists the private library and joined shared ones, and reports who may write', async () => {
    const libraries = await listExternalLibraries(ownerId)

    expect(libraries.map((l) => [l.id, l.type, l.canWrite])).toEqual([
      [privateLibraryId, 'private', true],
      [sharedLibraryId, 'shared', true],
    ])

    // A plain member reads the shared library but may not curate it, which is
    // what keeps an upload from being a way around requireLibraryManager.
    const asMember = await listExternalLibraries(memberId)
    expect(asMember.map((l) => [l.id, l.canWrite])).toEqual([[sharedLibraryId, false]])
  })

  it('omits a public library the caller never joined', async () => {
    const openId = createId('lib')
    seedLibrary(openId, ownerId, 'shared', 'Open')
    db.update(schema.libraries).set({ visibility: 'public' }).where(eq(schema.libraries.id, openId)).run()

    const libraries = await listExternalLibraries(memberId)
    expect(libraries.map((l) => l.id)).toEqual([sharedLibraryId])
  })

  it('carries the head counts and the whole taxonomy on the library row', async () => {
    // Everything a client needs to place an upload, in the one call it already
    // makes. The counts come from the Web's own list, so they follow the same
    // role-aware rule and cannot drift from the sidebar.
    const fantasyId = classificationValueKey('category', ['Fantasy'])
    const one = seedVersion(sharedLibraryId, ownerId, { title: 'One', revisionAt: 1000 })
    db.update(schema.libraryBooks).set({ categoryRoot: 'Fantasy', categoryLeaf: 'Urban' }).where(eq(schema.libraryBooks.id, one.workId)).run()
    db.insert(schema.libraryBookTagValues).values({ id: createId('btv'), libraryBookId: one.workId, name: 'Finished', sortOrder: 0 }).run()
    seedVersion(sharedLibraryId, ownerId, { title: 'Two', revisionAt: 1000 })

    const library = (await listExternalLibraries(ownerId)).find((l) => l.id === sharedLibraryId)!
    expect(library.memberCount).toBe(2)
    expect(library.workCount).toBe(2)
    // Depth is derived from parentId so a client can indent without walking the
    // tree, and the nesting is real rather than flat.
    expect(library.categories.map((c) => [c.name, c.parentId, c.depth])).toEqual([
      ['Fantasy', null, 0],
      ['Urban', fantasyId, 1],
    ])
    expect(library.tags).toEqual([{ id: 'Finished', name: 'Finished', bookCount: 1, hidden: false }])

    // The book source synthesises the uncategorized bucket for display.
    expect(library.categories.map((c) => c.id)).not.toContain('none')
  })

  it('projects private shelves separately from categories', async () => {
    const shelfId = createId('shelf')
    const categoryId = classificationValueKey('category', ['Mystery'])
    db.insert(schema.shelves).values({
      id: shelfId, libraryId: privateLibraryId, userId: ownerId, name: 'Reading',
      sortOrder: 0, createdAt: 1, updatedAt: 1,
    }).run()
    const seeded = seedVersion(privateLibraryId, ownerId, { title: 'Filed', revisionAt: 1000 })
    db.update(schema.libraryBooks).set({ categoryRoot: 'Mystery' }).where(eq(schema.libraryBooks.id, seeded.workId)).run()

    const library = (await listExternalLibraries(ownerId)).find((row) => row.id === privateLibraryId)!

    expect(library.shelves.map((row) => row.id)).toEqual([shelfId])
    expect(library.categories.map((row) => row.id)).toEqual([categoryId])
    expect((await listExternalLibraries(ownerId)).find((row) => row.id === sharedLibraryId)!.shelves).toEqual([])
  })

  it('returns private shelf and category labels as separate book fields', async () => {
    const shelfId = createId('shelf')
    db.insert(schema.shelves).values({
      id: shelfId, libraryId: privateLibraryId, userId: ownerId, name: 'Reading',
      sortOrder: 0, createdAt: 1, updatedAt: 1,
    }).run()
    const seeded = seedVersion(privateLibraryId, ownerId, { title: 'Filed', revisionAt: 1000 })
    db.update(schema.libraryBooks).set({ shelfId, categoryRoot: 'Mystery' }).where(eq(schema.libraryBooks.id, seeded.workId)).run()

    const book = (await listExternalBooks(ownerId, { page: 1, pageSize: 10 })).items[0]!

    expect(book).toMatchObject({ shelfName: 'Reading', categoryName: 'Mystery' })
  })

  it('shows a hidden category to its manager and to nobody else', async () => {
    // Same asymmetry the book rows follow, and for the same reason: a manager is
    // the one who can still file into it, so it is the one who needs to see it.
    const hiddenId = classificationValueKey('category', ['Draft'])
    const seeded = seedVersion(sharedLibraryId, ownerId, { title: 'Draft', revisionAt: 1000 })
    db.update(schema.libraryBooks).set({ categoryRoot: 'Draft' }).where(eq(schema.libraryBooks.id, seeded.workId)).run()
    await updateCategoryValue(ownerId, sharedLibraryId, { path: ['Draft'], hidden: true })

    const asOwner = (await listExternalLibraries(ownerId)).find((l) => l.id === sharedLibraryId)!
    expect(asOwner.categories).toMatchObject([{ id: hiddenId, name: 'Draft', hidden: true }])

    const asMember = (await listExternalLibraries(memberId)).find((l) => l.id === sharedLibraryId)!
    expect(asMember.categories).toEqual([])
  })

  it('spans every browsable library in one list, one row per version', async () => {
    seedVersion(privateLibraryId, ownerId, { title: 'Mine', revisionAt: 1000 })
    const shared = seedVersion(sharedLibraryId, ownerId, { title: 'Shared', revisionAt: 2000 })

    const all = await listExternalBooks(ownerId, { page: 1, pageSize: 50 })
    expect(all.total).toBe(2)
    expect(all.items.map((b) => [b.title, b.libraryName])).toEqual([['Mine', ''], ['Shared', 'Book Club']])
    expect(all.hasMore).toBe(false)

    // libraryId narrows rather than replaces the browsable set.
    const only = await listExternalBooks(ownerId, { page: 1, pageSize: 50, libraryId: sharedLibraryId })
    expect(only.items.map((b) => b.bookVersionId)).toEqual([shared.versionId])
  })

  it('reports the watermark as the newer of a work touch and a content revision', async () => {
    // The work row was touched long before the file was revised, and a content
    // change never touches the work, so a client syncing on the watermark has to
    // see the revision or an append would look like nothing happened.
    seedVersion(privateLibraryId, ownerId, { title: 'Appended', revisionAt: 5000, workUpdatedAt: 1000 })

    const list = await listExternalBooks(ownerId, { page: 1, pageSize: 50 })
    expect(list.items[0]!.updatedAt).toBe(5000)

    // And the filter has to agree with the field, or the watermark is a lie.
    const since = await listExternalBooks(ownerId, { page: 1, pageSize: 50, updatedSince: 4000 })
    expect(since.items.map((b) => b.title)).toEqual(['Appended'])
    const before = await listExternalBooks(ownerId, { page: 1, pageSize: 50, updatedSince: 6000 })
    expect(before.items).toEqual([])
  })

  it('pages globally so a second library is not skipped', async () => {
    // 150 private rows and one shared row: a page of 100 has to reach past the
    // first library, which per-library paging would silently not do.
    for (let i = 0; i < 150; i++) {
      seedVersion(privateLibraryId, ownerId, { title: `Book ${i}`, revisionAt: 1000 + i })
    }
    seedVersion(sharedLibraryId, ownerId, { title: 'The Shared One', revisionAt: 9999 })

    const first = await listExternalBooks(ownerId, { page: 1, pageSize: 100 })
    expect(first.items).toHaveLength(100)
    expect(first.total).toBe(151)
    expect(first.hasMore).toBe(true)

    const second = await listExternalBooks(ownerId, { page: 2, pageSize: 100 })
    expect(second.items).toHaveLength(51)
    expect(second.items.map((b) => b.title)).toContain('The Shared One')
    const globallySorted = await listExternalBooks(ownerId, { page: 1, pageSize: 2, sortScope: 'global' })
    expect(globallySorted.items.map((book) => book.title)).toEqual(['The Shared One', 'Book 149'])

    const beyondFirstPage = second.items.find((book) => book.libraryId === privateLibraryId)!
    await expect(getExternalBook(ownerId, beyondFirstPage.bookVersionId, privateLibraryId))
      .resolves.toMatchObject({ title: beyondFirstPage.title, libraryId: privateLibraryId })
  })

  it('keeps hidden rows away from a member but not from a manager, and says which', async () => {
    seedVersion(sharedLibraryId, ownerId, { title: 'Hidden Work', revisionAt: 1000, hidden: true })
    seedVersion(sharedLibraryId, ownerId, { title: 'Unlisted Version', revisionAt: 1000, status: 'unlisted' })
    seedVersion(sharedLibraryId, ownerId, { title: 'Visible', revisionAt: 1000 })

    const asMember = await listExternalBooks(memberId, { page: 1, pageSize: 50 })
    expect(asMember.items.map((b) => b.title)).toEqual(['Visible'])
    expect(asMember.items[0]!.hidden).toBe(false)

    const asOwner = await listExternalBooks(ownerId, { page: 1, pageSize: 50 })
    expect(asOwner.items.map((b) => b.title).sort()).toEqual(['Hidden Work', 'Unlisted Version', 'Visible'])
    // A row a manager can see has to say it is hidden, the way the Web badges it.
    expect(asOwner.items.find((b) => b.title === 'Hidden Work')!.hidden).toBe(true)
    expect(asOwner.items.find((b) => b.title === 'Visible')!.hidden).toBe(false)
  })

  it('opens a hidden book the listing already showed, instead of 404ing on it', async () => {
    // Regression: the listing skips the hide filter for a manager, so a private
    // vault's hidden rows appear. Reading them back through getActiveBook
    // without showHidden made the list point at rows that 404 on detail and
    // download — the same trap the book source avoids with its own read flag.
    const { versionId } = seedVersion(privateLibraryId, ownerId, { title: 'Vaulted', revisionAt: 1000, hidden: true })

    const listed = await listExternalBooks(ownerId, { page: 1, pageSize: 50 })
    expect(listed.items.map((b) => b.bookVersionId)).toEqual([versionId])

    await expect(getExternalBook(ownerId, versionId)).resolves.toMatchObject({ bookVersionId: versionId, hidden: true })
    // And a different account still cannot reach it.
    await expect(getExternalBook(memberId, versionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('returns a detail with the heavy fields the list leaves out', async () => {
    const { versionId } = seedVersion(privateLibraryId, ownerId, { title: 'Detail', revisionAt: 1000 })

    const detail = await getExternalBook(ownerId, versionId)
    expect(detail).toMatchObject({
      bookVersionId: versionId,
      title: 'Detail',
      fileName: 'Detail.epub',
      // No cover on the seeded revision, so the field is present and null rather
      // than absent: a client should not have to distinguish the two.
      cover: null,
    })
    expect(detail.hasCover).toBe(false)
  })

  it('returns publication metadata as an object, not as a char-index blob', async () => {
    // Regression: the revision meta was read with json_extract(..., '$.bookmeta'),
    // which returns an *object* value as its JSON text, and spreading that string
    // produced {"0":"{","1":"\""...}. Every publication field read as missing, so
    // the book source's detail page showed no publisher/series/isbn at all.
    const { versionId } = seedVersion(privateLibraryId, ownerId, { title: 'Published', revisionAt: 1000 })
    db.update(schema.contentRevisions)
      .set({ meta: { fileName: 'Published.epub', bookmeta: { publisher: 'Acme Press', language: 'zh-CN' } } })
      .where(eq(schema.contentRevisions.bookVersionId, versionId)).run()

    const detail = await getExternalBook(ownerId, versionId)
    expect(detail.bookmeta).toMatchObject({ publisher: 'Acme Press', language: 'zh-CN' })
    expect(detail.fileName).toBe('Published.epub')
  })

  it('refuses to trash a shared library book with 403, not a 404 that reads as missing', async () => {
    // trashBook clears deletedAt on the shared work row, so it is scoped to the
    // caller's own private library. Left to that lookup the refusal surfaced as
    // BOOK_NOT_FOUND for a row the caller can list and open, which says "no such
    // book" rather than "you may not delete this".
    const { versionId } = seedVersion(sharedLibraryId, ownerId, { title: 'Shared', revisionAt: 1000 })

    await expect(listExternalBooks(ownerId, { page: 1, pageSize: 50 })).resolves.toMatchObject({
      items: [expect.objectContaining({ bookVersionId: versionId })],
    })
    await expect(deleteExternalBook(ownerId, versionId)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Still untouched: the refusal happens before any write.
    const work = db.select({ deletedAt: schema.libraryBooks.deletedAt }).from(schema.libraryBooks).all()
    expect(work.every((row) => row.deletedAt === null)).toBe(true)
  })

  it('trashes the reader\'s own copy of a version that is also in a shared library', async () => {
    // The same file in two libraries is one bookVersionId, so the delete check
    // has to consider every library holding it. Answering from the first link
    // SQLite returned refused a book the reader plainly owns.
    const { versionId } = seedVersion(privateLibraryId, ownerId, { title: 'Mine', revisionAt: 1000 })
    seedVersion(sharedLibraryId, ownerId, { title: 'Also shared', revisionAt: 1000, sameVersionAs: versionId })

    await expect(getExternalBook(ownerId, versionId)).resolves.toMatchObject({ title: 'Mine', libraryId: privateLibraryId })
    await expect(getExternalBook(ownerId, versionId, sharedLibraryId)).resolves.toMatchObject({ title: 'Also shared', libraryId: sharedLibraryId })
    await expect(deleteExternalBook(ownerId, versionId, sharedLibraryId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(db.select().from(schema.libraryBooks).all().every((work) => work.deletedAt === null)).toBe(true)
    await expect(deleteExternalBook(ownerId, versionId)).resolves.toEqual({ bookVersionId: versionId })
    // Only the private work is trashed; the shared library's copy is a separate
    // row and stays readable for everyone else.
    const trashed = db.select({ libraryId: schema.libraryBooks.libraryId, deletedAt: schema.libraryBooks.deletedAt })
      .from(schema.libraryBooks).where(eq(schema.libraryBooks.libraryId, privateLibraryId)).all()
    expect(trashed.every((row) => row.deletedAt !== null)).toBe(true)
    const shared = db.select({ deletedAt: schema.libraryBooks.deletedAt })
      .from(schema.libraryBooks).where(eq(schema.libraryBooks.libraryId, sharedLibraryId)).all()
    expect(shared.every((row) => row.deletedAt === null)).toBe(true)
    await expect(getExternalBook(ownerId, versionId, sharedLibraryId))
      .resolves.toMatchObject({ title: 'Also shared', libraryId: sharedLibraryId })
    await expect(getExternalBook(ownerId, versionId, privateLibraryId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('reports the uploaded format as sourceFormat, never as what a download returns', async () => {
    // The download is always application/epub+zip: an uploaded EPUB comes back
    // as stored, and a TXT book is served the EPUB the server derived from its
    // normalized text because the original .txt bytes are never kept. Naming the
    // field `format` invited reading it as the payload's shape.
    const { versionId } = seedVersion(privateLibraryId, ownerId, { title: 'Plain', revisionAt: 1000 })

    const detail = await getExternalBook(ownerId, versionId)
    expect(detail.sourceFormat).toBe('epub')
    expect(detail).not.toHaveProperty('format')
  })

  it('refuses a version the caller cannot see', async () => {
    const { versionId } = seedVersion(privateLibraryId, ownerId, { title: 'Private', revisionAt: 1000 })

    await expect(getExternalBook(memberId, versionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(getExternalBook(ownerId, 'missing')).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('moves a book to the trash, which is the only delete the surface offers', async () => {
    const { workId, versionId } = seedVersion(privateLibraryId, ownerId, { title: 'Doomed', revisionAt: 1000 })

    await deleteExternalBook(ownerId, versionId)

    const work = db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, workId)).get()
    expect(work?.deletedAt).toEqual(expect.any(Number))
  })

  it('refuses a delete from an account that cannot see the version', async () => {
    const { versionId } = seedVersion(privateLibraryId, ownerId, { title: 'Private', revisionAt: 1000 })

    await expect(deleteExternalBook(memberId, versionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('updates only the work in the chosen library and exposes its changed taxonomy to filters', async () => {
    const { versionId, workId } = seedVersion(privateLibraryId, ownerId, { title: 'Private title', revisionAt: 1000 })
    seedVersion(sharedLibraryId, ownerId, { title: 'Shared title', revisionAt: 1200, sameVersionAs: versionId })
    const shelfId = createId('shelf')
    db.insert(schema.shelves).values({ id: shelfId, libraryId: privateLibraryId, userId: ownerId, name: 'Inbox', createdAt: 1, updatedAt: 1 }).run()
    await expect(updateExternalBook(memberId, sharedLibraryId, versionId, { title: 'Forbidden' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateExternalBook(ownerId, sharedLibraryId, versionId, { title: 'Must roll back', shelfId }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(updateExternalBook(ownerId, privateLibraryId, versionId, {
      title: 'Filed', author: 'Lin', categoryPath: ['Fiction'], tags: ['Favorite'], shelfId,
    })).resolves.toEqual({ libraryId: privateLibraryId, bookVersionId: versionId, libraryBookId: workId })
    const result = await listExternalBooks(ownerId, {
      page: 1, pageSize: 10, author: 'Lin', categoryPath: ['Fiction'], tag: 'Favorite', shelfId,
    })
    expect(result.items).toMatchObject([{ libraryId: privateLibraryId, title: 'Filed', authors: ['Lin'], shelfName: 'Inbox' }])
    await expect(getExternalBook(ownerId, versionId, sharedLibraryId)).resolves.toMatchObject({ title: 'Shared title' })
  })

  it('shares a private description between Web and external edits without changing the shared edition', async () => {
    const { versionId, workId } = seedVersion(privateLibraryId, ownerId, { title: 'Private', revisionAt: 1000 })
    const shared = seedVersion(sharedLibraryId, ownerId, { title: 'Shared', revisionAt: 1000, sameVersionAs: versionId })
    db.update(schema.libraryBooks).set({ description: 'Publisher summary' }).where(eq(schema.libraryBooks.id, workId)).run()
    db.update(schema.libraryBooks).set({ description: 'Shared summary' }).where(eq(schema.libraryBooks.id, shared.workId)).run()
    db.update(schema.contentRevisions).set({ meta: { bookmeta: { description: 'Publisher summary' } } })
      .where(eq(schema.contentRevisions.bookVersionId, versionId)).run()

    await savePrivateBook(ownerId, versionId, { book: { descriptionOverride: 'Written in Web' } })
    await expect(getExternalBook(ownerId, versionId, privateLibraryId)).resolves.toMatchObject({
      description: 'Written in Web', bookmeta: { description: 'Written in Web' },
    })
    await updateExternalBook(ownerId, privateLibraryId, versionId, { description: 'Written through API' })
    await expect(getBook(ownerId, versionId)).resolves.toMatchObject({
      descriptionOverride: 'Written through API', meta: { bookmeta: { description: 'Written through API' } },
    })
    await expect(listExternalBooks(ownerId, {
      libraryId: privateLibraryId, q: 'Written through API', page: 1, pageSize: 10,
    })).resolves.toMatchObject({ total: 1 })
    await expect(getExternalBook(ownerId, versionId, sharedLibraryId)).resolves.toMatchObject({ description: 'Shared summary' })

    await updateExternalBook(ownerId, privateLibraryId, versionId, { description: '' })
    await expect(getExternalBook(ownerId, versionId, privateLibraryId)).resolves.toMatchObject({ description: 'Publisher summary' })
    await expect(getBook(ownerId, versionId)).resolves.toMatchObject({ descriptionOverride: null, meta: { bookmeta: { description: 'Publisher summary' } } })
  })

})
