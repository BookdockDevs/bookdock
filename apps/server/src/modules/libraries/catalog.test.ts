import { bindLibrarySearch, parseLibrarySearch } from '@bookdock/shared'
import { listSearchAuthors } from './search-expression'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateTestBaseWithStorage as migrate } from '../../db/migration-stage'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { registerParser, getParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { appendCityVersionContent, appendTxtBookContent, getVersionTocState, previewCityToc, pushPrivateToVersion, reTocCityVersion, uploadBook, uploadCatalogBook } from '../books/books.service'
import { publishPrivateBook } from './publish.service'
import { updateLibrary } from './libraries.service'
import { createLibrary } from './libraries.service'
import { ensurePrivateLibrary } from './library-access'
import { createLibraryCategory, deleteLibraryCategory, listLibraryCategories, updateLibraryCategory } from '../shelves/shelves.service'
import { listLibraryTags } from '../tags/tags.service'
import { addToPrivateLibrary } from './collect.service'
import { resolveSharedVersionRead, resolveSourceRead } from './library-access'
import {
  deleteCatalogVersion,
  deleteCatalogBook,
  findSimilarWorks,
  getCatalogBook,
  getCatalogBatchSelection,
  getLibraryVersionPublication,
  listCatalogBooks,
  listLibraryVersionEntries,
  moveCatalogVersion,
  organizeCatalogBatch,
  permanentDeleteCatalogBook,
  removeCatalogBookCover,
  removeCatalogVersionCover,
  resetCatalogVersionMetadata,
  updateCatalogBook,
  updateCatalogBookCover,
  updateCatalogVersion,
  updateCatalogVersionCover,
} from './catalog.service'

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
    async get(key, range) {
      const buf = files.get(key)
      if (!buf) throw new Error(`missing blob: ${key}`)
      return Readable.from(range ? buf.subarray(range.start, range.end + 1) : buf)
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

describe('shared library catalog', () => {
  let db: ReturnType<typeof createTestDb>
  let files: Map<string, Buffer>
  let ownerId: string
  let adminId: string
  let memberId: string
  let outsiderId: string
  let libraryId: string

  function seedUser(username: string) {
    const id = createId('user')
    db.insert(schema.users).values({ id, username, passwordHash: null, role: 'member', createdAt: 1 }).run()
    return id
  }

  function seedTag(libraryId: string, name: string) {
    const id = createId('ltag')
    db.insert(schema.libraryTags).values({
      id, libraryId, userId: ownerId, name, sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  function txtFile(name: string, body: string) {
    return new File([body], name, { type: 'text/plain' })
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const memory = createMemoryStorage()
    files = memory.files
    vi.spyOn(storage, 'getStorage').mockReturnValue(memory.driver)
    registerParser(new TxtParser())
    ownerId = seedUser('owner')
    adminId = seedUser('admin')
    memberId = seedUser('member')
    outsiderId = seedUser('outsider')
    libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    // A realistic library: one admin, one plain member, one outsider.
    db.insert(schema.libraryMemberships).values([
      { id: createId('lbm'), libraryId, userId: adminId, role: 'admin', createdAt: 1, updatedAt: 1 },
      { id: createId('lbm'), libraryId, userId: memberId, role: 'member', createdAt: 1, updatedAt: 1 },
    ]).run()
  })

  it('evaluates expressions with visible-version permissions, taxonomy binding and consistent counts', async () => {
    const root = await createLibraryCategory(ownerId, libraryId, { name: 'Root' })
    const child = await createLibraryCategory(ownerId, libraryId, { name: 'Child', parentId: root.id })
    const sf = seedTag(libraryId, 'Sci Fi')
    const keep = seedTag(libraryId, 'Keep')
    const one = await uploadCatalogBook(libraryId, ownerId, txtFile('one.txt', 'One content'), { title: 'One', author: 'A', categoryId: root.id, tagIds: [sf, keep] })
    await uploadCatalogBook(libraryId, ownerId, txtFile('two.txt', 'Two content'), { title: 'Two', author: 'B', categoryId: child.id, tagIds: [sf] })
    const unlisted = await uploadCatalogBook(libraryId, ownerId, txtFile('unlisted.txt', 'Unlisted content'), { title: 'Secret', author: 'Secret Author' })
    await updateCatalogVersion(ownerId, libraryId, unlisted.libraryBookId, unlisted.versionLinkId!, { status: 'unlisted' })
    const hidden = await uploadCatalogBook(libraryId, ownerId, txtFile('hidden.txt', 'Hidden content'), { title: 'Hidden', author: 'Hidden Author' })
    await updateCatalogBook(ownerId, libraryId, hidden.libraryBookId, { hidden: true })
    const deleted = await uploadCatalogBook(libraryId, ownerId, txtFile('deleted.txt', 'Deleted content'), { title: 'Deleted' })
    db.update(schema.libraryBooks).set({ deletedAt: Date.now() }).where(eq(schema.libraryBooks.id, deleted.libraryBookId)).run()
    const encode = (source: string) => JSON.stringify(parseLibrarySearch(source))
    const source = 'category:Root (tag:"Sci Fi" | author:A) !tag:Keep'
    const first = await listCatalogBooks(memberId, libraryId, { expression: encode(source), categoryScope: 'subtree', pageSize: 1 })
    expect(first.total).toBe(1)
    expect(first.items.map((work) => work.title)).toEqual(['Two'])
    expect((await listCatalogBooks(memberId, libraryId, { expression: encode(source), categoryScope: 'direct' })).total).toBe(0)
    expect((await listCatalogBooks(memberId, libraryId, { expression: encode('tag:"Sci Fi",Keep') })).items.map((work) => work.id)).toEqual([one.libraryBookId])
    const broad = encode('One | !"nonexistent"')
    expect((await listCatalogBooks(memberId, libraryId, { expression: broad })).total).toBe(2)
    const pages = await Promise.all([1, 2].map((page) => listCatalogBooks(memberId, libraryId, { expression: broad, page, pageSize: 1 })))
    expect(new Set(pages.flatMap((page) => page.items.map((work) => work.id))).size).toBe(2)
    expect((await listCatalogBooks(ownerId, libraryId, { expression: broad })).total).toBe(4)
    await expect(listCatalogBooks(memberId, libraryId, { expression: encode('author:"Secret Author"') })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(listCatalogBooks(memberId, libraryId, { expression: broad, trash: true })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await listCatalogBooks(ownerId, libraryId, { expression: broad, trash: true })).items.map((work) => work.title)).toEqual(['Deleted'])
    await expect(listCatalogBooks(memberId, libraryId, { expression: encode('status:reading') })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const locked = await createLibrary({ userId: ownerId, isGuest: false }, { name: 'Locked Search', visibility: 'private' })
    await expect(listCatalogBooks(outsiderId, locked.id, { expression: broad })).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    const bound = bindLibrarySearch(parseLibrarySearch('tag:"Sci Fi"')!, { shared: true, tags: [{ id: sf, name: 'Sci Fi' }], categories: [] })
    if (bound.kind === 'field') bound.id = keep + '-foreign'
    await expect(listCatalogBooks(memberId, libraryId, { expression: JSON.stringify(bound) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await listSearchAuthors(memberId, libraryId)).toEqual(['A', 'B'])
    expect(await listSearchAuthors(ownerId, libraryId)).toContain('Secret Author')
  })

  it('keeps subtree paging and taxonomy counts aligned with visible works', async () => {
    const root = await createLibraryCategory(ownerId, libraryId, { name: 'Root' })
    const child = await createLibraryCategory(ownerId, libraryId, { name: 'Child', parentId: root.id })
    const tag = seedTag(libraryId, 'Topic')
    const direct = await uploadCatalogBook(libraryId, ownerId, txtFile('direct.txt', 'Direct text'), { title: 'Direct', categoryId: root.id, tagIds: [tag] })
    const nested = await uploadCatalogBook(libraryId, ownerId, txtFile('child.txt', 'Child text'), { title: 'Nested', categoryId: child.id, tagIds: [tag] })
    await uploadCatalogBook(libraryId, ownerId, txtFile('edition.txt', 'Another edition'), { libraryBookId: nested.libraryBookId })
    const unlisted = await uploadCatalogBook(libraryId, ownerId, txtFile('unlisted.txt', 'Hidden edition'), { title: 'Unlisted', categoryId: child.id, tagIds: [tag] })
    await updateCatalogVersion(ownerId, libraryId, unlisted.libraryBookId, unlisted.versionLinkId!, { status: 'unlisted' })
    await uploadCatalogBook(libraryId, ownerId, txtFile('none.txt', 'Unclassified'), { title: 'None' })
    expect((await listCatalogBooks(memberId, libraryId, { categoryId: root.id })).total).toBe(1)
    const page = await listCatalogBooks(memberId, libraryId, { categoryId: root.id, categoryScope: 'subtree', pageSize: 1, page: 2 })
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect((await listCatalogBooks(memberId, libraryId, { categoryId: root.id, categoryScope: 'subtree', tagId: tag })).total).toBe(2)
    expect((await listCatalogBooks(memberId, libraryId, { categoryId: 'none', categoryScope: 'subtree' })).items.map((w) => w.title)).toEqual(['None'])
    expect((await listLibraryCategories(memberId, libraryId)).find((c) => c.id === root.id)).toMatchObject({ bookCount: 1, subtreeBookCount: 2 })
    expect((await listLibraryCategories(ownerId, libraryId)).find((c) => c.id === root.id)).toMatchObject({ bookCount: 1, subtreeBookCount: 3 })
    expect((await listLibraryTags(memberId, libraryId)).find((t) => t.id === tag)?.bookCount).toBe(2)
    await updateLibraryCategory(ownerId, libraryId, child.id, { hidden: true })
    expect((await listLibraryCategories(memberId, libraryId)).find((c) => c.id === root.id)?.subtreeBookCount).toBe(1)
    expect((await listCatalogBooks(memberId, libraryId, { categoryId: root.id, categoryScope: 'subtree' })).total).toBe(1)
    await updateLibraryCategory(ownerId, libraryId, root.id, { hidden: true })
    expect(await listLibraryCategories(memberId, libraryId)).toEqual([])
    await deleteLibraryCategory(ownerId, libraryId, root.id)
    expect((await getCatalogBook(ownerId, libraryId, direct.libraryBookId)).categoryId).toBeNull()
    expect((await listLibraryCategories(ownerId, libraryId)).find((c) => c.id === child.id)?.parentId).toBeNull()
    await updateLibraryCategory(ownerId, libraryId, child.id, { hidden: false })
    await deleteCatalogBook(ownerId, libraryId, nested.libraryBookId)
    expect((await listLibraryCategories(memberId, libraryId)).find((c) => c.id === child.id)?.bookCount).toBe(0)
    expect((await listLibraryTags(memberId, libraryId)).find((t) => t.id === tag)?.bookCount).toBe(1)
  })

  it('carries the work taxonomy: tags on upload, replacement on update, names on read', async () => {
    const tagA = seedTag(libraryId, 'Sci-Fi')
    const tagB = seedTag(libraryId, 'Classic')
    const categoryId = createId('cat')
    db.insert(schema.libraryCategories).values({
      id: categoryId, libraryId, userId: ownerId, name: 'Shelves', parentId: null,
      sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()

    // Upload accepts a category and tags together, and both read back.
    const uploaded = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '第一章\n甲'), {
      title: 'Alpha', categoryId, tagIds: [tagA, tagB],
    })
    const afterUpload = await getCatalogBook(ownerId, libraryId, uploaded.libraryBookId)
    expect(afterUpload.categoryId).toBe(categoryId)
    expect(afterUpload.tags.map((t) => t.name).sort()).toEqual(['Classic', 'Sci-Fi'])

    // The list carries tags too, so a catalog page needs no second lookup.
    const listed = await listCatalogBooks(ownerId, libraryId, {})
    expect(listed.items[0]!.tags.map((t) => t.id).sort()).toEqual([tagA, tagB].sort())

    // Updating replaces the whole set rather than appending.
    const replaced = await updateCatalogBook(ownerId, libraryId, uploaded.libraryBookId, { tagIds: [tagB] })
    expect(replaced.tags.map((t) => t.name)).toEqual(['Classic'])
    expect((await updateCatalogBook(ownerId, libraryId, uploaded.libraryBookId, { tagIds: [] })).tags).toEqual([])
    // A metadata-only update leaves the tags alone.
    await updateCatalogBook(ownerId, libraryId, uploaded.libraryBookId, { tagIds: [tagA] })
    expect((await updateCatalogBook(ownerId, libraryId, uploaded.libraryBookId, { title: 'Renamed' })).tags)
      .toEqual([{ id: tagA, name: 'Sci-Fi' }])
  })

  it('refuses taxonomy ids from another library on both upload and update', async () => {
    const otherLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherLibraryId, userId: ownerId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const foreignCategory = createId('cat')
    db.insert(schema.libraryCategories).values({
      id: foreignCategory, libraryId: otherLibraryId, userId: ownerId, name: 'Foreign',
      parentId: null, sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()
    const foreignTag = seedTag(otherLibraryId, 'Foreign')

    await expect(uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', 'x'), { categoryId: foreignCategory }))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
    await expect(uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', 'y'), { tagIds: [foreignTag] }))
      .rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })

    const work = await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', 'z'), { title: 'Gamma' })
    await expect(updateCatalogBook(ownerId, libraryId, work.libraryBookId, { categoryId: foreignCategory }))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
    await expect(updateCatalogBook(ownerId, libraryId, work.libraryBookId, { tagIds: [foreignTag] }))
      .rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })

    // A rejected retag must not have cleared the existing set.
    const tag = seedTag(libraryId, 'Mine')
    await updateCatalogBook(ownerId, libraryId, work.libraryBookId, { tagIds: [tag] })
    await expect(updateCatalogBook(ownerId, libraryId, work.libraryBookId, { tagIds: [tag, foreignTag] }))
      .rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })
    expect((await getCatalogBook(ownerId, libraryId, work.libraryBookId)).tags).toEqual([{ id: tag, name: 'Mine' }])
  })

  it('lets any signed-in user read a public catalog, but only managers change it', async () => {
    const work = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', 'x'), { title: 'Alpha' })
    // A plain member reads a public library's catalog, taxonomy included.
    expect((await getCatalogBook(memberId, libraryId, work.libraryBookId)).tags).toEqual([])
    // So does an authenticated non-member: public means discoverable by any
    // signed-in account, which is the whole point of the visibility setting.
    expect((await getCatalogBook(outsiderId, libraryId, work.libraryBookId)).title).toBe('Alpha')

    // Reading is not curating: a member and a non-member are both refused.
    await expect(updateCatalogBook(memberId, libraryId, work.libraryBookId, { tagIds: [] }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateCatalogBook(outsiderId, libraryId, work.libraryBookId, { tagIds: [] }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Nor can a non-member reach a library that is not public.
    const hiddenId = createId('lib')
    db.insert(schema.libraries).values({
      id: hiddenId, userId: ownerId, type: 'shared', name: 'Hidden',
      description: '', visibility: 'private', createdAt: 1, updatedAt: 1,
    }).run()
    const hidden = await uploadCatalogBook(hiddenId, ownerId, txtFile('h.txt', 'x'), { title: 'Secret' })
    await expect(getCatalogBook(outsiderId, hiddenId, hidden.libraryBookId))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })

  it('marks a catalog version already collected by the current user', async () => {
    const source = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', 'x'), { title: 'Already Mine' })
    const privateLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: privateLibraryId, userId: ownerId, type: 'private', name: 'owner',
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()

    await addToPrivateLibrary(ownerId, libraryId, source.versionLinkId!)

    expect((await getCatalogBook(ownerId, libraryId, source.libraryBookId)).versions[0]?.collected).toBe(true)
    expect((await getCatalogBook(memberId, libraryId, source.libraryBookId)).versions[0]?.collected).toBe(false)
  })

  it('pins a work first for everyone, manager-only', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', 'x'), { title: 'Alpha' })
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', 'y'), { title: 'Beta' })
    // Reading is not curating: a plain member cannot pin.
    await expect(updateCatalogBook(memberId, libraryId, second.libraryBookId, { pinned: true }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    const pinned = await updateCatalogBook(ownerId, libraryId, second.libraryBookId, { pinned: true })
    expect(pinned.pinnedAt).not.toBeNull()
    // The pin sorts first for every reader, not just the manager who set it.
    expect((await listCatalogBooks(memberId, libraryId, {})).items.map((work) => work.id))
      .toEqual([second.libraryBookId, first.libraryBookId])
    const unpinned = await updateCatalogBook(adminId, libraryId, second.libraryBookId, { pinned: false })
    expect(unpinned.pinnedAt).toBeNull()
  })

  it('keeps a shared pin on the work when its default version changes', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', 'a'), { title: 'Alpha' })
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', 'b'), {
      libraryBookId: first.libraryBookId,
    })
    await updateCatalogBook(ownerId, libraryId, first.libraryBookId, { pinned: true })
    await updateCatalogBook(ownerId, libraryId, first.libraryBookId, { defaultVersionLinkId: second.versionLinkId! })
    const work = await getCatalogBook(memberId, libraryId, first.libraryBookId)
    expect(work.pinnedAt).not.toBeNull()
    expect(work.versions[0]?.id).toBe(second.versionLinkId)
    expect(work.versions.some((version) => 'pinnedAt' in version)).toBe(false)
  })

  it('organizes selected works by tag delta without replacing unrelated tags', async () => {
    const tagA = seedTag(libraryId, 'A')
    const tagB = seedTag(libraryId, 'B')
    const tagC = seedTag(libraryId, 'C')
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', 'a'), { title: 'Alpha', tagIds: [tagA, tagB] })
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', 'b'), { title: 'Beta', tagIds: [tagC] })
    const ids = [first.libraryBookId, second.libraryBookId]
    await expect(getCatalogBatchSelection(memberId, libraryId, ids)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await getCatalogBatchSelection(ownerId, libraryId, ids)).map((row) => row.tagIds.sort()))
      .toEqual([[tagA, tagB].sort(), [tagC]])
    await organizeCatalogBatch(ownerId, libraryId, { ids, addTagIds: [tagA], removeTagIds: [tagB] })
    expect((await getCatalogBook(ownerId, libraryId, first.libraryBookId)).tags.map((tag) => tag.id)).toEqual([tagA])
    expect((await getCatalogBook(ownerId, libraryId, second.libraryBookId)).tags.map((tag) => tag.id).sort()).toEqual([tagA, tagC].sort())
    await expect(organizeCatalogBatch(ownerId, libraryId, { ids, addTagIds: [tagA], removeTagIds: [tagA] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('deletes every version of one selected shared work', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', 'a'), { title: 'Alpha' })
    await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', 'b'), { libraryBookId: first.libraryBookId })
    expect((await getCatalogBatchSelection(ownerId, libraryId, [first.libraryBookId]))[0]?.versionCount).toBe(2)
    await expect(deleteCatalogBook(memberId, libraryId, first.libraryBookId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Trash is on by default: manager delete soft-deletes into the owner trash.
    expect(await deleteCatalogBook(ownerId, libraryId, first.libraryBookId)).toMatchObject({ trashed: true, versionCount: 2 })
    expect((await listCatalogBooks(ownerId, libraryId, {})).items).toHaveLength(0)
    expect((await listCatalogBooks(ownerId, libraryId, { trash: true })).items).toHaveLength(1)
    expect(await permanentDeleteCatalogBook(ownerId, libraryId, first.libraryBookId)).toMatchObject({ id: first.libraryBookId })
    expect((await listCatalogBooks(ownerId, libraryId, { trash: true })).items).toHaveLength(0)
  })

  it('filters and orders the catalog by the same vocabulary as a private list', async () => {
    const sciFi = createId('cat')
    db.insert(schema.libraryCategories).values({
      id: sciFi, libraryId, userId: ownerId, name: 'Sci-Fi', parentId: null,
      sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()
    const award = seedTag(libraryId, 'Award')
    const plain = seedTag(libraryId, 'Plain')

    const zeta = await uploadCatalogBook(libraryId, ownerId, txtFile('z.txt', '第一章\n丙'), { title: 'Zeta' })
    const alpha = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '第一章\n甲'), {
      title: 'Alpha', categoryId: sciFi, tagIds: [award],
    })
    const beta = await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', '第一章\n乙'), {
      title: 'Beta', tagIds: [plain],
    })

    // Category filter, including the uncategorized sentinel a private list uses.
    expect((await listCatalogBooks(ownerId, libraryId, { categoryId: sciFi })).items.map((b) => b.title))
      .toEqual(['Alpha'])
    expect((await listCatalogBooks(ownerId, libraryId, { categoryId: 'none' })).items.map((b) => b.title).sort())
      .toEqual(['Beta', 'Zeta'])

    // Tag filter, scoped to this library.
    expect((await listCatalogBooks(ownerId, libraryId, { tagId: award })).items.map((b) => b.title))
      .toEqual(['Alpha'])
    const otherLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherLibraryId, userId: ownerId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const foreignTag = seedTag(otherLibraryId, 'Foreign')
    await uploadCatalogBook(otherLibraryId, ownerId, txtFile('f.txt', '第一章\n丁'), { title: 'Foreign' })
    expect((await listCatalogBooks(ownerId, libraryId, { tagId: foreignTag })).items).toHaveLength(0)

    // Search reaches the work description and the taxonomy names, like a
    // private list does, not just title and author.
    await updateCatalogBook(ownerId, libraryId, beta.libraryBookId, { description: '关于奖金的说明' })
    expect((await listCatalogBooks(ownerId, libraryId, { search: '奖金' })).items.map((b) => b.title)).toEqual(['Beta'])
    expect((await listCatalogBooks(ownerId, libraryId, { search: 'Sci-Fi' })).items.map((b) => b.title)).toEqual(['Alpha'])
    expect((await listCatalogBooks(ownerId, libraryId, { search: 'Award' })).items.map((b) => b.title)).toEqual(['Alpha'])

    // Ordering, both directions, with the work id breaking ties.
    const titles = (await listCatalogBooks(ownerId, libraryId, { sortBy: 'title', sortOrder: 'asc' })).items.map((b) => b.title)
    expect(titles).toEqual(['Alpha', 'Beta', 'Zeta'])
    expect((await listCatalogBooks(ownerId, libraryId, { sortBy: 'title', sortOrder: 'desc' })).items.map((b) => b.title))
      .toEqual(['Zeta', 'Beta', 'Alpha'])

    // A sort key a shared catalog cannot honour (progress belongs to a person)
    // falls back instead of producing a broken query.
    expect((await listCatalogBooks(ownerId, libraryId, { sortBy: 'progress' })).items).toHaveLength(3)
    // An unknown key is equally harmless.
    expect((await listCatalogBooks(ownerId, libraryId, { sortBy: 'nonsense' })).items).toHaveLength(3)

    // Paging is honoured and pageSize is now the caller's choice.
    const page1 = await listCatalogBooks(ownerId, libraryId, { sortBy: 'title', sortOrder: 'asc', pageSize: 2 })
    expect(page1.items.map((b) => b.title)).toEqual(['Alpha', 'Beta'])
    expect(page1.total).toBe(3)
    expect(page1.pageSize).toBe(2)
    const page2 = await listCatalogBooks(ownerId, libraryId, { sortBy: 'title', sortOrder: 'asc', pageSize: 2, page: 2 })
    expect(page2.items.map((b) => b.title)).toEqual(['Zeta'])

    // Format filter reads the version's original format, not the stored
    // artifact: a TXT upload is stored as a derived EPUB but stays 'txt'.
    expect((await listCatalogBooks(ownerId, libraryId, { format: 'txt' })).items).toHaveLength(3)
    expect((await listCatalogBooks(ownerId, libraryId, { format: 'epub' })).items).toHaveLength(0)
    expect(zeta.libraryBookId).toBeTruthy()
    expect(alpha.libraryBookId).not.toBe(beta.libraryBookId)
  })

  /**
   * The author drill-down is the one metadata filter a catalog can offer, and it
   * has to mean what it means in a private list: what a reader sees, which is the
   * version's override when there is one and the work's default otherwise. A work
   * whose version overrode the author must not vanish from that author's list.
   */
  it('filters by author through the work default and through a version override', async () => {
    const liu = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '第一章\n甲'), {
      title: '三体', author: '刘慈欣',
    })
    await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', '第一章\n乙'), {
      title: '活着', author: '余华',
    })
    // A second version of the same work, crediting a different author: the work
    // is still the one a reader finds under both names.
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', '第一章\n丙'), {
      libraryBookId: liu.libraryBookId,
    })
    await updateCatalogVersion(ownerId, libraryId, liu.libraryBookId, second.versionLinkId!, { author: '王irkan' })

    expect((await listCatalogBooks(ownerId, libraryId, { author: '刘慈欣' })).items.map((b) => b.title))
      .toEqual(['三体'])
    expect((await listCatalogBooks(ownerId, libraryId, { author: '余华' })).items.map((b) => b.title))
      .toEqual(['活着'])
    expect((await listCatalogBooks(ownerId, libraryId, { author: '王irkan' })).items.map((b) => b.title))
      .toEqual(['三体'])
    expect((await listCatalogBooks(ownerId, libraryId, { author: '查无此人' })).items).toHaveLength(0)
  })

  it('keeps an author filter scoped to its own library', async () => {
    const otherLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherLibraryId, userId: ownerId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '第一章\n甲'), { title: 'Mine', author: 'Shared Name' })
    await uploadCatalogBook(otherLibraryId, ownerId, txtFile('b.txt', '第一章\n乙'), { title: 'Theirs', author: 'Shared Name' })

    expect((await listCatalogBooks(ownerId, libraryId, { author: 'Shared Name' })).items.map((b) => b.title))
      .toEqual(['Mine'])
  })

  it('resolves author and search matches on visible versions, not bare work defaults', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '第一章\n甲'), {
      title: '作品', author: '默认作者',
    })
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', '第一章\n乙'), {
      libraryBookId: first.libraryBookId,
    })
    await updateCatalogVersion(ownerId, libraryId, first.libraryBookId, first.versionLinkId!, { author: '甲', title: '甲标题' })
    await updateCatalogVersion(ownerId, libraryId, first.libraryBookId, second.versionLinkId!, { author: '乙', title: '乙标题' })
    // No visible version resolves to the work default anymore: matching it
    // would be a false positive, not inheritance.
    expect((await listCatalogBooks(ownerId, libraryId, { author: '默认作者' })).total).toBe(0)
    expect((await listCatalogBooks(ownerId, libraryId, { author: '甲' })).total).toBe(1)
    // Search sees what readers see: the version override, not just the work.
    expect((await listCatalogBooks(ownerId, libraryId, { search: '甲标题' })).items.map((b) => b.title))
      .toEqual(['作品'])
    expect((await listCatalogBooks(ownerId, libraryId, { search: '作品' })).total).toBe(1)
    expect((await listCatalogBooks(ownerId, libraryId, { search: '查无此文' })).total).toBe(0)
  })

  it('stores version author-list overrides and matches every credited name', async () => {
    const work = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '第一章\n甲'), {
      title: '合著作品', authors: ['甲', '乙'],
    })
    // The work default resolves both names through inheritance.
    expect((await getCatalogBook(ownerId, libraryId, work.libraryBookId)).authors).toEqual(['甲', '乙'])
    expect((await listCatalogBooks(memberId, libraryId, { author: '乙' })).total).toBe(1)
    // A version override replaces the whole list and mirrors the first name.
    const updated = await updateCatalogVersion(ownerId, libraryId, work.libraryBookId, work.versionLinkId!, { authors: ['丙', '丁'] })
    expect(updated.authors).toEqual(['丙', '丁'])
    expect(updated.author).toBe('丙')
    expect(updated.effective.authors).toEqual(['丙', '丁'])
    expect((await listCatalogBooks(memberId, libraryId, { author: '丁' })).total).toBe(1)
    expect((await listCatalogBooks(memberId, libraryId, { author: '甲' })).total).toBe(0)
    // Null clears the override back to the work default.
    const cleared = await updateCatalogVersion(ownerId, libraryId, work.libraryBookId, work.versionLinkId!, { authors: null })
    expect(cleared.authors).toBeNull()
    expect(cleared.effective.authors).toEqual(['甲', '乙'])
  })

  /**
   * A catalog work has no series column - its title and author are curated
   * fields - but the versions it manages are real BookVersions whose parsed
   * metadata declares a series exactly as a private book's does. The filter has
   * to reach through the version link to the latest content revision, which is
   * where a private list reads it from too.
   */
  it('filters by the series its versions declared in their file metadata', async () => {
    async function uploadWithBookmeta(title: string, bookmeta: Record<string, unknown>) {
      // Distinct bodies: identical content would deduplicate by blob and skip
      // the insert, leaving no version to attach metadata to.
      const created = await uploadCatalogBook(libraryId, ownerId, txtFile(`${title}.txt`, `第一章\n${title} 正文`), { title })
      db.update(schema.contentRevisions)
        .set({ meta: { bookmeta, fileName: `${title}.txt` } })
        .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId))
        .run()
      return created
    }

    await uploadWithBookmeta('基地', { series: '银河帝国编年史' })
    await uploadWithBookmeta('沙丘', { series: ' Dune ' })
    await uploadWithBookmeta('独行', {})

    expect((await listCatalogBooks(ownerId, libraryId, { series: '银河帝国编年史' })).items.map((b) => b.title))
      .toEqual(['基地'])
    // Exact match, like a private list: the stored value is compared, not trimmed.
    expect((await listCatalogBooks(ownerId, libraryId, { series: 'Dune' })).items).toHaveLength(0)
    expect((await listCatalogBooks(ownerId, libraryId, { series: ' Dune ' })).items.map((b) => b.title))
      .toEqual(['沙丘'])
    expect((await listCatalogBooks(ownerId, libraryId, { series: '查无此系列' })).items).toHaveLength(0)
  })

  it('finds a work by a series only one of its versions declared', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '第一章\n甲'), { title: '三体' })
    await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', '第一章\n乙'), { libraryBookId: first.libraryBookId })
    // Only the second version's file names a series.
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', '第一章\n丙'), { libraryBookId: first.libraryBookId })
    db.update(schema.contentRevisions)
      .set({ meta: { bookmeta: { series: '地球往事' } } })
      .where(eq(schema.contentRevisions.bookVersionId, second.bookVersionId))
      .run()

    expect((await listCatalogBooks(ownerId, libraryId, { series: '地球往事' })).items.map((b) => b.title))
      .toEqual(['三体'])
  })

  it('uploads into the library without touching the uploader private library', async () => {
    const result = await uploadCatalogBook(libraryId, adminId, txtFile('novel.txt', '第一章\n正文内容'), { title: '剧评' })
    expect(result.duplicated).toBe(false)

    const work = db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, result.libraryBookId)).get()!
    expect(work).toMatchObject({ libraryId, title: '剧评', categoryId: null })
    const link = db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.id, result.versionLinkId)).get()!
    // A/B/C describe private-library entries: inside a library this row is the
    // library-owned source, and it carries no provenance.
    expect(link).toMatchObject({ kind: 'personal', status: 'published', sourceLibraryId: null })
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, result.bookVersionId)).get()).toBeTruthy()
    expect(db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, result.bookVersionId)).all()).toHaveLength(1)
    // No private card and no reading state for the uploader.
    expect(db.select().from(schema.libraryBooks)
      .where(and(eq(schema.libraryBooks.userId, adminId), eq(schema.libraryBooks.libraryId, libraryId))).all())
      .toHaveLength(1)
    expect(db.select().from(schema.bookStates)
      .where(eq(schema.bookStates.bookVersionId, result.bookVersionId)).all()).toHaveLength(0)
    // The generated EPUB really landed in storage, not just in the registry.
    const blobKey = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, result.bookVersionId)).get()!.blobKey
    expect(files.get(blobKey)?.length ?? 0).toBeGreaterThan(0)
  })

  it('deduplicates the same content inside one library but not across libraries', async () => {
    const file = txtFile('novel.txt', '第一章\n正文内容')
    const first = await uploadCatalogBook(libraryId, ownerId, file)
    expect((await uploadCatalogBook(libraryId, ownerId, file)).duplicated).toBe(true)
    expect(db.select().from(schema.libraryBooks).all()).toHaveLength(1)

    // Another library keeps its own entry: content identity is never merged,
    // only the physical blob is shared.
    const otherId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherId, userId: outsiderId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const second = await uploadCatalogBook(otherId, outsiderId, file)
    expect(second.duplicated).toBe(false)
    expect(second.bookVersionId).not.toBe(first.bookVersionId)
    expect(db.select().from(schema.blobs).all()).toHaveLength(1)
  })

  it('releases an exclusive blob on last-version delete but keeps a shared one', async () => {
    const file = txtFile('novel.txt', '第一章\n正文内容')
    const first = await uploadCatalogBook(libraryId, ownerId, file)
    const blobKey = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, first.bookVersionId)).get()!.blobKey
    expect(files.has(blobKey)).toBe(true)

    // Same content in another library shares the physical blob, not the version.
    const otherId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherId, userId: outsiderId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const second = await uploadCatalogBook(otherId, outsiderId, file)
    expect(db.select().from(schema.blobs).all()).toHaveLength(1)

    await deleteCatalogVersion(ownerId, libraryId, first.libraryBookId, first.versionLinkId!)
    // Last-version delete moves the work into the owner trash; content stays.
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, first.bookVersionId)).get()).toBeTruthy()
    expect(files.has(blobKey)).toBe(true)
    expect(await permanentDeleteCatalogBook(ownerId, libraryId, first.libraryBookId)).toMatchObject({ id: first.libraryBookId })
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, first.bookVersionId)).get()).toBeUndefined()
    expect(files.has(blobKey)).toBe(true)

    await deleteCatalogVersion(outsiderId, otherId, second.libraryBookId, second.versionLinkId!)
    await permanentDeleteCatalogBook(outsiderId, otherId, second.libraryBookId)
    expect(files.has(blobKey)).toBe(false)
    expect(db.select().from(schema.blobs).where(eq(schema.blobs.key, blobKey)).get()).toBeUndefined()
  })

  it('rejects foreign libraries, categories and work targets', async () => {
    const otherId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherId, userId: outsiderId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    await expect(uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', 'a'), { categoryId: createId('cat') }))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
    await expect(uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', 'a'), { libraryBookId: createId('lb') }))
      .rejects.toMatchObject({ code: 'LIBRARY_BOOK_NOT_FOUND' })
    const created = await uploadCatalogBook(otherId, outsiderId, txtFile('b.txt', 'b'))
    // A work in another library is not a grouping target.
    await expect(uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', 'c'), { libraryBookId: created.libraryBookId }))
      .rejects.toMatchObject({ code: 'LIBRARY_BOOK_NOT_FOUND' })
  })

  it('groups a new version into an existing work and keeps both versions', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('first.txt', '第一章\n甲'))
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('second.txt', '第一章\n乙'), {
      libraryBookId: first.libraryBookId,
      name: '第二版',
    })
    expect(second.libraryBookId).toBe(first.libraryBookId)
    const book = await getCatalogBook(ownerId, libraryId, first.libraryBookId)
    expect(book.versions).toHaveLength(2)
    expect(book.versions.map((v) => v.name).sort()).toEqual(['', '第二版'])
    // The second version keeps its own parsed metadata as overrides, because
    // the work default was decided by the first upload.
    const grouped = book.versions.find((v) => v.id === second.versionLinkId)!
    expect(grouped.title).toBe('second')
    expect(grouped.effective.title).toBe('second')
  })

  it('inherits work metadata unless a version overrides it', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('novel.txt', '第一章\n正文'), { title: '作品名' })
    const book = await getCatalogBook(ownerId, libraryId, created.libraryBookId)
    expect(book.versions[0]).toMatchObject({ title: null, effective: { title: '作品名' } })

    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, { title: '版本名' })
    const overridden = await getCatalogBook(ownerId, libraryId, created.libraryBookId)
    expect(overridden.versions[0]).toMatchObject({ title: '版本名', effective: { title: '版本名' } })

    // Work defaults move every inheriting version with them...
    await updateCatalogBook(ownerId, libraryId, created.libraryBookId, { title: '新作品名' })
    expect((await getCatalogBook(ownerId, libraryId, created.libraryBookId)).versions[0].effective.title).toBe('版本名')
    // ...and clearing the override restores inheritance instead of copying.
    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, { title: null })
    expect((await getCatalogBook(ownerId, libraryId, created.libraryBookId)).versions[0].effective.title).toBe('新作品名')
  })

  it('publishes and unlists versions without deleting them', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('novel.txt', '第一章\n正文'))
    const unlisted = await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, { status: 'unlisted' })
    expect(unlisted.status).toBe('unlisted')
    // Managers still see it; anyone else sees neither the version nor the work:
    // an unlisted-only work must not occupy total/items with an empty list.
    expect((await listCatalogBooks(ownerId, libraryId)).items[0].versions).toHaveLength(1)
    const memberView = await listCatalogBooks(memberId, libraryId)
    expect(memberView.total).toBe(0)
    expect(memberView.items).toHaveLength(0)
    expect((await listCatalogBooks(ownerId, libraryId)).items[0].versions[0].status).toBe('unlisted')
  })

  it('hides unlisted versions from work detail, similar works and version-scoped filters', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('first.txt', '第一章\n甲'), { title: '作品', author: '默认作者' })
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('second.txt', '第一章\n乙'), {
      libraryBookId: first.libraryBookId, name: '隐藏版',
    })
    await updateCatalogVersion(ownerId, libraryId, first.libraryBookId, second.versionLinkId!, { author: '隐藏作者' })
    await updateCatalogVersion(ownerId, libraryId, first.libraryBookId, second.versionLinkId!, { status: 'unlisted' })
    expect((await getCatalogBook(ownerId, libraryId, first.libraryBookId)).hidden).toBe(false)
    await updateCatalogBook(ownerId, libraryId, first.libraryBookId, { hidden: true })
    expect((await getCatalogBook(ownerId, libraryId, first.libraryBookId)).versions.map((v) => v.status))
      .toEqual(['published', 'unlisted'])
    await updateCatalogBook(ownerId, libraryId, first.libraryBookId, { hidden: false })

    // Detail: managers see both versions, members only the published one.
    expect((await getCatalogBook(ownerId, libraryId, first.libraryBookId)).versions).toHaveLength(2)
    const memberDetail = await getCatalogBook(memberId, libraryId, first.libraryBookId)
    expect(memberDetail.versions).toHaveLength(1)
    expect(memberDetail.versions.map((v) => v.author)).not.toContain('隐藏作者')

    // Similar works carry no hidden version metadata for members.
    const memberSimilar = await findSimilarWorks(memberId, libraryId, { title: '作品' })
    expect(memberSimilar[0].versions).toHaveLength(1)
    expect((await findSimilarWorks(ownerId, libraryId, { title: '作品' }))[0].versions).toHaveLength(2)

    // Filters scoped to a version (author override, format) cannot be hit
    // through the hidden version by members, but still work for managers.
    expect((await listCatalogBooks(memberId, libraryId, { author: '隐藏作者' })).total).toBe(0)
    expect((await listCatalogBooks(ownerId, libraryId, { author: '隐藏作者' })).total).toBe(1)
    expect((await listCatalogBooks(memberId, libraryId, { author: '默认作者' })).total).toBe(1)

    // Unlisting the last version removes the work from the member scope.
    await updateCatalogVersion(ownerId, libraryId, first.libraryBookId, first.versionLinkId!, { status: 'unlisted' })
    const emptied = await listCatalogBooks(memberId, libraryId)
    expect(emptied.total).toBe(0)
    expect(emptied.items).toHaveLength(0)
    expect((await listCatalogBooks(memberId, libraryId, { format: 'txt' })).total).toBe(0)
    expect((await listCatalogBooks(ownerId, libraryId)).total).toBe(1)
  })

  it('closes the read boundary of an unlisted version (5.4)', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('novel.txt', '第一章\n正文'))
    const expectReadable = async () => {
      expect((await resolveSharedVersionRead(libraryId, created.bookVersionId, memberId)).relation).toBe('member')
    }
    await expectReadable()
    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, { status: 'unlisted' })
    // Hiding is a member-facing switch: it leaves the public read boundary for
    // members and anonymous readers, but the curator keeps their own copy.
    await expect(resolveSharedVersionRead(libraryId, created.bookVersionId, memberId))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    await expect(resolveSharedVersionRead(libraryId, created.bookVersionId, ownerId))
      .resolves.toMatchObject({ relation: 'owner' })
    await expect(resolveSharedVersionRead(libraryId, created.bookVersionId, null))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    // A B pointing at it keeps its provenance and simply becomes unreadable.
    expect(await resolveSourceRead(
      { sourceLibraryId: libraryId, sourceLibraryBookVersionId: created.versionLinkId }, { userId: memberId },
    )).toMatchObject({ readable: false, sourceLibraryId: libraryId })
    // Republishing restores the same content identity.
    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, { status: 'published' })
    await expectReadable()
  })

  it('keeps work and version visibility independent at any version count', async () => {
    await uploadCatalogBook(libraryId, ownerId, txtFile('v.txt', '第一章\n甲'), { title: 'Visible' })
    const hiddenWork = await uploadCatalogBook(libraryId, ownerId, txtFile('h.txt', '第一章\n乙'), { title: 'Hidden' })
    await updateCatalogBook(ownerId, libraryId, hiddenWork.libraryBookId, { hidden: true })
    // The work flag no longer writes the version: hiding one layer must not
    // silently close the other, or a one-version work would behave unlike a
    // many-version one.
    expect((await getCatalogBook(ownerId, libraryId, hiddenWork.libraryBookId)).versions[0].status).toBe('published')

    // Managers see hidden rows badged; members see neither the work nor its count.
    expect((await listCatalogBooks(ownerId, libraryId)).total).toBe(2)
    expect((await listCatalogBooks(ownerId, libraryId)).items.find((b) => b.title === 'Hidden')?.hidden).toBe(true)
    const memberView = await listCatalogBooks(memberId, libraryId)
    expect(memberView.total).toBe(1)
    expect(memberView.items.map((b) => b.title)).toEqual(['Visible'])
    // Detail and the read boundary agree with the list for members...
    await expect(getCatalogBook(memberId, libraryId, hiddenWork.libraryBookId))
      .rejects.toMatchObject({ code: 'LIBRARY_BOOK_NOT_FOUND' })
    await expect(resolveSharedVersionRead(libraryId, hiddenWork.bookVersionId, memberId))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    // ...while the owner keeps reading what they hid.
    await expect(resolveSharedVersionRead(libraryId, hiddenWork.bookVersionId, ownerId))
      .resolves.toMatchObject({ relation: 'owner' })
    await updateCatalogBook(ownerId, libraryId, hiddenWork.libraryBookId, { hidden: false })
    expect((await listCatalogBooks(memberId, libraryId)).total).toBe(2)
    // The reverse direction is independent too.
    await updateCatalogVersion(ownerId, libraryId, hiddenWork.libraryBookId, hiddenWork.versionLinkId!, { status: 'unlisted' })
    expect((await getCatalogBook(ownerId, libraryId, hiddenWork.libraryBookId)).hidden).toBe(false)
    await expect(resolveSharedVersionRead(libraryId, hiddenWork.bookVersionId, ownerId))
      .resolves.toMatchObject({ relation: 'owner' })
    await expect(resolveSharedVersionRead(libraryId, hiddenWork.bookVersionId, memberId))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
  })

  it('lists one row per version for the book source, with the catalog hide asymmetry', async () => {
    const tagId = seedTag(libraryId, 'Sci-Fi')
    const categoryId = createId('cat')
    db.insert(schema.libraryCategories).values({
      id: categoryId, libraryId, userId: ownerId, name: 'Shelves', parentId: null,
      sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('v.txt', '第一章\n甲'), {
      title: 'Visible', categoryId, tagIds: [tagId],
    })

    // One row per version, carrying the taxonomy the Web card shows.
    const listed = await listLibraryVersionEntries(memberId, libraryId, {})
    expect(listed.total).toBe(1)
    expect(listed.items[0]).toMatchObject({
      bookVersionId: created.bookVersionId,
      title: 'Visible',
      categoryName: 'Shelves',
      tags: ['Sci-Fi'],
    })

    // A second version of the same work is its own row, because Legado
    // addresses a book by version and cannot switch between them. The body has
    // to differ: uploads dedupe on content hash.
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('v2.txt', '第一章\n乙乙乙乙乙乙乙乙'), {
      title: 'Visible', categoryId, libraryBookId: created.libraryBookId,
    })
    expect(second.bookVersionId).not.toBe(created.bookVersionId)
    const both = await listLibraryVersionEntries(memberId, libraryId, {})
    expect(both.total).toBe(2)
    expect(both.items.map((entry) => entry.bookVersionId).sort())
      .toEqual([created.bookVersionId, second.bookVersionId].sort())

    // Hiding the work closes every one of its versions for a member and leaves
    // all of them open for a manager.
    await updateCatalogBook(ownerId, libraryId, created.libraryBookId, { hidden: true })
    expect((await listLibraryVersionEntries(memberId, libraryId, {})).total).toBe(0)
    expect((await listLibraryVersionEntries(ownerId, libraryId, {})).total).toBe(2)

    // A hidden version behaves the same way at the version layer.
    await updateCatalogBook(ownerId, libraryId, created.libraryBookId, { hidden: false })
    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, second.versionLinkId!, { status: 'unlisted' })
    const memberView = await listLibraryVersionEntries(memberId, libraryId, {})
    expect(memberView.items.map((entry) => entry.bookVersionId)).toEqual([created.bookVersionId])
    expect((await listLibraryVersionEntries(ownerId, libraryId, {})).total).toBe(2)

    // The single-version publication lookup follows the same rule, so a detail
    // page can never enrich itself for a version the reader may not see.
    const links = db.select().from(schema.libraryBookVersions).all()
    expect(await getLibraryVersionPublication(memberId, second.bookVersionId!)).toBeNull()
    expect(await getLibraryVersionPublication(ownerId, second.bookVersionId!)).not.toBeNull()
    // A public library's published version stays readable for any signed-in
    // outsider, which is the same verdict the content routes give.
    expect(await getLibraryVersionPublication(outsiderId, created.bookVersionId!)).not.toBeNull()
    expect(links.filter((link) => link.status === 'unlisted')).toHaveLength(1)
  })

  it('merges work meta over the revision bookmeta, manager-only', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('m.txt', '第一章\n甲'), { title: 'Meta' })
    await updateCatalogBook(ownerId, libraryId, created.libraryBookId, {
      meta: { publisher: 'City Press', language: 'zh' },
    })
    expect((await getCatalogBook(ownerId, libraryId, created.libraryBookId)).versions[0].effective.bookmeta)
      .toMatchObject({ publisher: 'City Press', language: 'zh' })
    // Work meta replaces wholesale (like tagIds): unmentioned keys drop, and
    // members read the merged result without writing it.
    await updateCatalogBook(ownerId, libraryId, created.libraryBookId, { meta: { publisher: 'Other Press' } })
    expect((await getCatalogBook(memberId, libraryId, created.libraryBookId)).versions[0].effective.bookmeta)
      .toMatchObject({ publisher: 'Other Press' })
    expect((await getCatalogBook(memberId, libraryId, created.libraryBookId)).versions[0].effective.bookmeta)
      .not.toHaveProperty('language')
    await expect(updateCatalogBook(memberId, libraryId, created.libraryBookId, { meta: {} }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('manages the work cover, manager-only', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', '第一章\n甲'), { title: 'Cover' })
    const png = new File(
      [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'cover.png',
      { type: 'image/png' },
    )
    const covered = await updateCatalogBookCover(adminId, libraryId, created.libraryBookId, png)
    expect(covered.coverKey).toMatch(/\.cover\.png$/)
    expect(covered.versions[0].effective.coverKey).toBe(covered.coverKey)
    expect(files.has(covered.coverKey!)).toBe(true)
    await expect(updateCatalogBookCover(memberId, libraryId, created.libraryBookId, png))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateCatalogBookCover(
      ownerId, libraryId, created.libraryBookId,
      new File(['not an image'], 'cover.bin', { type: 'application/octet-stream' }),
    )).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
    const removed = await removeCatalogBookCover(ownerId, libraryId, created.libraryBookId)
    expect(removed.coverKey).toBeNull()
    await expect(removeCatalogBookCover(memberId, libraryId, created.libraryBookId))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })


  it('masks inherited publication metadata with explicit null keys on all read projections', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('empty.txt', '第一章\n正文'), { title: 'Work', author: 'Work Author' })
    await updateCatalogBook(ownerId, libraryId, created.libraryBookId, { description: 'Work description', meta: { publisher: 'Work Press', seriesIndex: 5 } })
    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, {
      authors: [], description: '', meta: { publisher: null, seriesIndex: null, identifier: 'keep' },
    })
    const version = (await getCatalogBook(memberId, libraryId, created.libraryBookId)).versions[0]
    expect(version.effective.authors).toEqual([])
    expect(version.effective.description).toBe('')
    expect(version.effective.bookmeta).toEqual({ identifier: 'keep' })
    expect(version.meta).toEqual({ publisher: null, seriesIndex: null, identifier: 'keep' })
    expect(version.inherited).toMatchObject({ title: 'Work', authors: ['Work Author'], description: 'Work description', bookmeta: { publisher: 'Work Press', seriesIndex: 5 } })
    expect((await listLibraryVersionEntries(memberId, libraryId, {})).items[0].bookmeta).toEqual({ identifier: 'keep' })
    expect((await getLibraryVersionPublication(memberId, created.bookVersionId!))?.bookmeta).toEqual({ identifier: 'keep' })
    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, { meta: {} })
    expect((await getCatalogBook(memberId, libraryId, created.libraryBookId)).versions[0].effective.bookmeta.publisher).toBe('Work Press')
  })

  it('merges version meta over work meta and the revision bookmeta', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('v.txt', '第一章\n甲'), { title: 'Edition' })
    await updateCatalogBook(ownerId, libraryId, created.libraryBookId, {
      meta: { publisher: 'Work Press', language: 'zh' },
    })
    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, {
      meta: { publisher: 'Edition Press' },
    })
    expect((await getCatalogBook(ownerId, libraryId, created.libraryBookId)).versions[0].effective.bookmeta)
      .toMatchObject({ publisher: 'Edition Press', language: 'zh' })
    // Raw layers ride along for editors; display reads `effective`.
    const layered = await getCatalogBook(ownerId, libraryId, created.libraryBookId)
    expect(layered.meta).toMatchObject({ publisher: 'Work Press', language: 'zh' })
    expect(layered.versions[0].meta).toMatchObject({ publisher: 'Edition Press' })
    // Null clears the version override back to the work default.
    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, { meta: null })
    expect((await getCatalogBook(ownerId, libraryId, created.libraryBookId)).versions[0].effective.bookmeta)
      .toMatchObject({ publisher: 'Work Press', language: 'zh' })
    await expect(updateCatalogVersion(memberId, libraryId, created.libraryBookId, created.versionLinkId!, { meta: {} }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('manages version covers with work fallback, manager-only', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('vc.txt', '第一章\n甲'), { title: 'Version Cover' })
    const workPng = new File(
      [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])],
      'work-cover.png',
      { type: 'image/png' },
    )
    const versionPng = new File(
      [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02])],
      'version-cover.png',
      { type: 'image/png' },
    )
    const workCovered = await updateCatalogBookCover(ownerId, libraryId, created.libraryBookId, workPng)
    const covered = await updateCatalogVersionCover(adminId, libraryId, created.libraryBookId, created.versionLinkId!, versionPng)
    expect(covered.coverKey).toMatch(/\.cover\.png$/)
    expect(covered.coverKey).not.toBe(workCovered.coverKey)
    expect(covered.effective.coverKey).toBe(covered.coverKey)
    expect(files.has(covered.coverKey!)).toBe(true)
    await expect(updateCatalogVersionCover(memberId, libraryId, created.libraryBookId, created.versionLinkId!, versionPng))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateCatalogVersionCover(
      ownerId, libraryId, created.libraryBookId, created.versionLinkId!,
      new File(['not an image'], 'cover.bin', { type: 'application/octet-stream' }),
    )).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
    // Clearing the version cover reveals the work cover underneath.
    const removed = await removeCatalogVersionCover(ownerId, libraryId, created.libraryBookId, created.versionLinkId!)
    expect(removed.coverKey).toBeNull()
    expect(removed.effective.coverKey).toBe(workCovered.coverKey)
    await expect(removeCatalogVersionCover(memberId, libraryId, created.libraryBookId, created.versionLinkId!))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('resets version overrides and restores the parsed bookmeta', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('r.txt', '第一章\n甲'), { title: 'Reset Me' })
    await updateCatalogVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, {
      title: 'Edited Title', author: 'Edited Author', description: 'Edited desc', meta: { publisher: 'Edited Press' },
    })
    await updateCatalogVersionCover(
      ownerId, libraryId, created.libraryBookId, created.versionLinkId!,
      new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'cover.png', { type: 'image/png' }),
    )
    // Pollute the revision bookmeta to prove the reset re-parses from the file.
    const revision = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all().at(0)!
    db.update(schema.contentRevisions)
      .set({ meta: { ...((revision.meta ?? {}) as Record<string, unknown>), bookmeta: { publisher: 'Bogus' } } })
      .where(eq(schema.contentRevisions.id, revision.id)).run()
    // Stored content is EPUB bytes (TXT is converted at upload), so the
    // reset re-parses through an EPUB parser like the runtime does.
    registerParser({
      match: (fileName) => fileName.toLowerCase().endsWith('.epub'),
      parse: async () => ({
        meta: { title: 'Parsed', bookmeta: { publisher: 'Parsed Press' } },
        chapters: [],
      }),
    })
    const reset = await resetCatalogVersionMetadata(ownerId, libraryId, created.libraryBookId, created.versionLinkId!)
    const version = reset.versions[0]!
    expect(version.title).toBeNull()
    expect(version.author).toBeNull()
    expect(version.description).toBeNull()
    expect(version.coverKey).toBeNull()
    expect(version.effective.title).toBe('Reset Me')
    expect(version.effective.bookmeta).toMatchObject({ publisher: 'Parsed Press' })
    expect(version.effective.bookmeta).not.toMatchObject({ publisher: 'Bogus' })
    expect(version.effective.fileName).toBe('r.txt')
    await expect(resetCatalogVersionMetadata(memberId, libraryId, created.libraryBookId, created.versionLinkId!))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('appends a version revision instead of overwriting when the catalog parse differs', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('s.txt', '第一章\n甲'), { title: 'Twin' })
    const stored = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all()
    expect(stored).toHaveLength(1)
    db.update(schema.contentRevisions)
      .set({ meta: { ...((stored[0]!.meta ?? {}) as Record<string, unknown>), bookmeta: { publisher: 'Bogus' } } })
      .where(eq(schema.contentRevisions.id, stored[0]!.id)).run()
    registerParser({
      match: (fileName) => fileName.toLowerCase().endsWith('.epub'),
      parse: async () => ({
        meta: { title: 'Parsed', bookmeta: { publisher: 'Parsed Press' } },
        chapters: [],
      }),
    })
    await resetCatalogVersionMetadata(ownerId, libraryId, created.libraryBookId, created.versionLinkId!)
    const rows = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all()
      .sort((a, b) => a.revisionNo - b.revisionNo)
    expect(rows).toHaveLength(2)
    expect(rows[1]!.blobKey).toBe(rows[0]!.blobKey)
    expect((rows[0]!.meta as Record<string, unknown>).bookmeta).toMatchObject({ publisher: 'Bogus' })
    expect((rows[1]!.meta as Record<string, unknown>).bookmeta).toMatchObject({ publisher: 'Parsed Press' })
  })

  it('creates no version revision when the catalog parse is identical', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('t.txt', '第一章\n甲'), { title: 'Twin Same' })
    const stored = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all().at(0)!
    // Echo the winning parser: store exactly what the reset parse returns, so
    // the reset is a guaranteed no-op regardless of parser registration order.
    const parser = getParser(stored.blobKey, '')!
    const parsed = await parser.parse(await storage.getStorage().get(stored.blobKey))
    const parsedBookmeta = parsed.meta.bookmeta ?? {}
    db.update(schema.contentRevisions)
      .set({ meta: { ...((stored.meta ?? {}) as Record<string, unknown>), bookmeta: parsedBookmeta } })
      .where(eq(schema.contentRevisions.id, stored.id)).run()
    await resetCatalogVersionMetadata(ownerId, libraryId, created.libraryBookId, created.versionLinkId!)
    const rows = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all()
    expect(rows).toHaveLength(1)
  })

  it('pushes the linked private draft to its city version', async () => {
    const draft = await uploadBook(ownerId, txtFile('draft.txt', '第一章\n草稿'))
    const pub = await publishPrivateBook(ownerId, libraryId, { bookId: draft.book.id })
    await appendTxtBookContent(ownerId, draft.book.id, '第二章\n续写')

    const result = await pushPrivateToVersion(ownerId, libraryId, pub.libraryBookId, pub.versionLinkId)
    expect(result).toMatchObject({ revisionNo: 2, alreadyUpToDate: false, diverged: false })
    const rows = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, pub.bookVersionId)).all()
      .sort((a, b) => a.revisionNo - b.revisionNo)
    const draftLatest = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, draft.book.id))
      .orderBy(desc(schema.contentRevisions.revisionNo)).get()!
    expect(rows).toHaveLength(2)
    expect(rows[1]!.blobKey).toBe(draftLatest.blobKey)
    // The base advances with the push, so the next identical push is a no-op.
    const again = await pushPrivateToVersion(ownerId, libraryId, pub.libraryBookId, pub.versionLinkId)
    expect(again).toMatchObject({ revisionNo: 2, alreadyUpToDate: true, diverged: false })
  })

  it('refuses a push once the library moved on, leaving both sides intact', async () => {
    // Only a source that leads alone may push. With both sides edited there is
    // no honest merge, and the pin follows the newest revision, so pushing
    // would discard the library's content with no way back.
    const draft = await uploadBook(ownerId, txtFile('draft.txt', '第一章\n草稿'))
    const pub = await publishPrivateBook(ownerId, libraryId, { bookId: draft.book.id })
    await appendCityVersionContent(ownerId, libraryId, pub.libraryBookId, pub.versionLinkId, '第二章\n馆主修订')
    const latestInLibrary = () => db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, pub.bookVersionId))
      .orderBy(desc(schema.contentRevisions.revisionNo)).get()!
    const libraryBlob = latestInLibrary().blobKey
    const revisionsBefore = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, pub.bookVersionId)).all().length

    await appendTxtBookContent(ownerId, draft.book.id, '第二章\n私库续写')
    await expect(pushPrivateToVersion(ownerId, libraryId, pub.libraryBookId, pub.versionLinkId))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    // Nothing was written: no revision appended, and the library still serves
    // exactly what it served before.
    expect(db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, pub.bookVersionId)).all()).toHaveLength(revisionsBefore)
    expect(latestInLibrary().blobKey).toBe(libraryBlob)
  })

  it('refuses a push that would change the target version format', async () => {
    // A version's declared format is part of its content identity and readers
    // branch on it, so a push may only refresh a same-format version — and one
    // work can legitimately hold both formats side by side.
    const draft = await uploadBook(ownerId, txtFile('draft.txt', '第一章\n原稿'))
    const pub = await publishPrivateBook(ownerId, libraryId, { bookId: draft.book.id })
    const epubDraft = await uploadBook(ownerId, new File([new Uint8Array([80, 75, 3, 4])], 'other.epub', { type: 'application/epub+zip' }))

    await expect(pushPrivateToVersion(ownerId, libraryId, pub.libraryBookId, pub.versionLinkId, epubDraft.book.id))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })

    // The same-format push still works, and nothing was written by the refusal.
    const sameFormat = await pushPrivateToVersion(ownerId, libraryId, pub.libraryBookId, pub.versionLinkId, draft.book.id)
    expect(sameFormat.alreadyUpToDate).toBe(true)
    expect(db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, pub.bookVersionId)).all()).toHaveLength(1)
  })

  it('refuses push from non-managers, shared sources and trashed works', async () => {
    const draft = await uploadBook(ownerId, txtFile('draft.txt', '第一章\n草稿'))
    const pub = await publishPrivateBook(ownerId, libraryId, { bookId: draft.book.id })
    await expect(pushPrivateToVersion(memberId, libraryId, pub.libraryBookId, pub.versionLinkId))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await deleteCatalogBook(ownerId, libraryId, pub.libraryBookId)
    await expect(pushPrivateToVersion(ownerId, libraryId, pub.libraryBookId, pub.versionLinkId))
      .rejects.toMatchObject({ code: 'LIBRARY_BOOK_NOT_FOUND' })
  })

  it('lets members upload and maintain own versions once the library opens uploads', async () => {
    await expect(uploadCatalogBook(libraryId, memberId, txtFile('m.txt', '第一章\n成员')))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await updateLibrary(ownerId, libraryId, { allowMemberUpload: true })

    const mine = await uploadCatalogBook(libraryId, memberId, txtFile('m.txt', '第一章\n成员'), { title: 'Mine' })
    const other = await uploadCatalogBook(libraryId, ownerId, txtFile('o.txt', '第一章\n馆主'), { title: 'Theirs' })
    // Own version: content update + delete allowed.
    const updated = await appendCityVersionContent(memberId, libraryId, mine.libraryBookId, mine.versionLinkId!, '第二章\n续')
    expect(updated.revisionNo).toBe(2)
    await deleteCatalogVersion(memberId, libraryId, mine.libraryBookId, mine.versionLinkId!)
    // Someone else's version: still forbidden.
    await expect(appendCityVersionContent(memberId, libraryId, other.libraryBookId, other.versionLinkId!, '第一章\n改'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(deleteCatalogVersion(memberId, libraryId, other.libraryBookId, other.versionLinkId!))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Switch off again: uploads close for members, managers unaffected.
    await updateLibrary(ownerId, libraryId, { allowMemberUpload: false })
    await expect(uploadCatalogBook(libraryId, memberId, txtFile('m2.txt', '第一章\n又来')))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    const owners = await uploadCatalogBook(libraryId, ownerId, txtFile('o2.txt', '第一章\n馆主又来'))
    expect(owners.duplicated).toBe(false)
  })

  it('keeps the member-upload switch owner-only and shared-only', async () => {
    await expect(updateLibrary(memberId, libraryId, { allowMemberUpload: true }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    const privateId = createId('lib')
    db.insert(schema.libraries).values({
      id: privateId, userId: ownerId, type: 'private', name: 'Mine',
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()
    await expect(updateLibrary(ownerId, privateId, { allowMemberUpload: true }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    // Outsiders stay out even with the switch on.
    await updateLibrary(ownerId, libraryId, { allowMemberUpload: true })
    await expect(uploadCatalogBook(libraryId, outsiderId, txtFile('s.txt', '第一章\n外人')))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('appends city content as a new revision and refreshes holder progress', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', '第一章\n甲'), { title: 'City Serial' })
    // Owner + a plain reader hold positions on rev 1.
    const ownerKey = `progress/${ownerId}/${created.bookVersionId}.json`
    const memberKey = `progress/${memberId}/${created.bookVersionId}.json`
    files.set(ownerKey, Buffer.from(JSON.stringify({ cfi: 'chapter-0001.xhtml#epubcfi(/6/1)', chapter: '第一章', percent: 50, updatedAt: 1 })))
    files.set(memberKey, Buffer.from(JSON.stringify({ cfi: 'chapter-0001.xhtml#epubcfi(/6/1)', chapter: '第一章', percent: 30, updatedAt: 1 })))
    db.insert(schema.bookStates).values([
      { userId: ownerId, bookVersionId: created.bookVersionId, percent: 50, updatedAt: 1 },
      { userId: memberId, bookVersionId: created.bookVersionId, percent: 30, updatedAt: 1 },
    ]).run()

    const result = await appendCityVersionContent(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, '第二章\n乙')
    expect(result.revisionNo).toBe(2)
    const rows = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all()
      .sort((a, b) => a.revisionNo - b.revisionNo)
    expect(rows).toHaveLength(2)
    expect(rows[1]!.blobKey).not.toBe(rows[0]!.blobKey)
    // Actor progress rescales; the other holder keeps percent, loses the stale CFI.
    expect(JSON.parse(files.get(ownerKey)!.toString())).toMatchObject({ chapter: null })
    const memberProgress = JSON.parse(files.get(memberKey)!.toString())
    expect(memberProgress.cfi).toBeNull()
    expect(memberProgress.percent).toBe(30)
  })

  it('moves every holder onto the new content and drops their stale position', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('p.txt', '第一章\n甲'), { title: 'Pinned Serial' })
    // A content write moves every pin in the same transaction as the revision,
    // so a collected member is reading the new chapter map on their next open:
    // their CFI describes the old one and has to go, exactly like the outsider's
    // who was already following the latest.
    ensurePrivateLibrary(db, memberId)
    ensurePrivateLibrary(db, outsiderId)
    await addToPrivateLibrary(memberId, libraryId, created.versionLinkId!)
    const rev1 = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all().at(0)!
    const memberKey = `progress/${memberId}/${created.bookVersionId}.json`
    const plainKey = `progress/${outsiderId}/${created.bookVersionId}.json`
    const saved = { cfi: 'chapter-0001.xhtml#epubcfi(/6/1)', chapter: '第一章', percent: 30, updatedAt: 1 }
    files.set(memberKey, Buffer.from(JSON.stringify(saved)))
    files.set(plainKey, Buffer.from(JSON.stringify(saved)))
    // Collecting already creates the member's state row; the outsider reads the
    // library directly and is the only one needing one seeded.
    db.insert(schema.bookStates)
      .values({ userId: outsiderId, bookVersionId: created.bookVersionId, percent: 30, updatedAt: 1 })
      .onConflictDoNothing().run()

    const reToc = await reTocCityVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, null, [
      { level: 1, regex: '^第(.+)$', replacement: '$1' },
    ])
    expect(reToc.chaptersChanged).toBe(true)
    const rev2 = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId))
      .orderBy(desc(schema.contentRevisions.revisionNo)).all().at(0)!
    expect(rev2.id).not.toBe(rev1.id)
    const pin = db.select().from(schema.libraryBookVersions)
      .where(and(
        eq(schema.libraryBookVersions.userId, memberId),
        eq(schema.libraryBookVersions.bookVersionId, created.bookVersionId),
      )).get()!
    expect(pin.pinnedRevisionId).toBe(rev2.id)

    // Percent describes the right book and is kept; the exact position is
    // re-derived from the book fraction by the reader.
    for (const key of [memberKey, plainKey]) {
      expect(JSON.parse(files.get(key)!.toString())).toMatchObject({ cfi: null, chapter: null, percent: 30 })
    }
  })

  it('marks only a version the caller may actually maintain', async () => {
    await updateLibrary(ownerId, libraryId, { allowMemberUpload: true })
    const mine = await uploadCatalogBook(libraryId, memberId, txtFile('mine.txt', '第一章\n我的'), { title: 'Mine' })
    const theirs = await uploadCatalogBook(libraryId, ownerId, txtFile('theirs.txt', '第一章\n馆主'), { title: 'Theirs' })
    // The contributor may maintain their own upload and nobody else's.
    const asMember = (await getCatalogBook(memberId, libraryId, mine.libraryBookId)).versions
    expect(asMember.find((v) => v.id === mine.versionLinkId)!.maintainable).toBe(true)
    const others = (await getCatalogBook(memberId, libraryId, theirs.libraryBookId)).versions
    expect(others.find((v) => v.id === theirs.versionLinkId)!.maintainable).toBe(false)
    // A manager maintains everything in their own library.
    const asOwner = await getCatalogBook(ownerId, libraryId, theirs.libraryBookId)
    expect(asOwner.versions.find((v) => v.id === theirs.versionLinkId)!.maintainable).toBe(true)
    // The flag agrees with the endpoint: what it says false is what gets refused.
    await expect(appendCityVersionContent(memberId, libraryId, theirs.libraryBookId, theirs.versionLinkId!, '第二章\n改'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('refuses content writes to a work sitting in the library trash', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('t.txt', '第一章\n甲'), { title: 'Trashed Serial' })
    await deleteCatalogBook(ownerId, libraryId, created.libraryBookId)
    // push already refused this; append and re-split must refuse the same way,
    // or a deleted work keeps growing revisions behind the owner's back.
    await expect(pushPrivateToVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!))
      .rejects.toMatchObject({ code: 'LIBRARY_BOOK_NOT_FOUND' })
    await expect(appendCityVersionContent(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, '第二章\n乙'))
      .rejects.toMatchObject({ code: 'LIBRARY_BOOK_NOT_FOUND' })
    await expect(previewCityToc(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, {}))
      .rejects.toMatchObject({ code: 'LIBRARY_BOOK_NOT_FOUND' })
    await expect(reTocCityVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!))
      .rejects.toMatchObject({ code: 'LIBRARY_BOOK_NOT_FOUND' })
  })

  it('re-splits a city version the same way whoever maintains it', async () => {
    // The publisher pins one of their own named rules; a different maintainer
    // then re-runs the re-split. Resolving that rule through the second account
    // would re-chapter the shared book with their rules and write their rule id
    // into content every member reads.
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('s.txt', '序言正文\n\n第一章\n甲\n\n第二章\n乙'), { title: 'Shared Rules' })
    const publisherRule = createId('tr')
    db.insert(schema.tocRules).values({
      id: publisherRule, userId: ownerId, name: '出版方规则',
      patterns: [{ level: 1, regex: '^第(.+)章?$' }], enabled: 1, sortOrder: 0, createdAt: 1, updatedAt: 1,
    }).run()
    await reTocCityVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, publisherRule)
    const afterPublisher = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId))
      .orderBy(desc(schema.contentRevisions.revisionNo)).get()!
    const publisherChapters = ((afterPublisher.meta as Record<string, unknown>).chapters as Array<{ title: string }>).map((c) => c.title)

    // A second manager with entirely different rules touches the same version.
    const otherRule = createId('tr')
    db.insert(schema.tocRules).values({
      id: otherRule, userId: adminId, name: '另一套规则',
      patterns: [{ level: 1, regex: '^第(\\S)章$', replacement: '$1' }], enabled: 1, sortOrder: 0, createdAt: 1, updatedAt: 1,
    }).run()
    const byOther = await reTocCityVersion(adminId, libraryId, created.libraryBookId, created.versionLinkId!)
    const latest = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId))
      .orderBy(desc(schema.contentRevisions.revisionNo)).get()!
    const meta = latest.meta as Record<string, unknown>
    // The split is unchanged, so no new revision is written at all.
    expect(latest.id).toBe(afterPublisher.id)
    expect(byOther.chaptersChanged).toBe(false)
    expect(meta.tocRuleId).toBe('custom')
    expect(JSON.stringify(meta.customTocPatterns)).toBe(JSON.stringify([{ level: 1, regex: '^第(.+)章?$' }]))
    // No other account's rule id leaks into shared metadata.
    expect(JSON.stringify(meta)).not.toContain(otherRule)
    expect(((meta.chapters as Array<{ title: string }>).map((c) => c.title))).toEqual(publisherChapters)
  })

  it('refuses city appends from non-maintainers and non-txt versions', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', '第一章\n甲'), { title: 'Guarded Serial' })
    await expect(appendCityVersionContent(memberId, libraryId, created.libraryBookId, created.versionLinkId!, '第二章\n乙'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Member upload lane: own versions are maintainable.
    await updateLibrary(ownerId, libraryId, { allowMemberUpload: true })
    const mine = await uploadCatalogBook(libraryId, memberId, txtFile('m.txt', '第一章\n我的'), { title: 'Mine' })
    const result = await appendCityVersionContent(memberId, libraryId, mine.libraryBookId, mine.versionLinkId!, '第二章\n续')
    expect(result.revisionNo).toBe(2)
  })

  it('re-splits city chapters with the stage-1 write discipline', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', '序言\n\n=== 第一章\n\n正文一'), { title: 'City ReToc' })
    // A rule that moves boundaries appends a revision reusing nothing new.
    const changed = await reTocCityVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, null, [
      { level: 1, regex: '^=== (.+)$', replacement: '$1' },
    ])
    expect(changed.chaptersChanged).toBe(true)
    let rows = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all()
    expect(rows).toHaveLength(2)
    // Same split again: no revision, rule selection persists.
    const same = await reTocCityVersion(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, null, [
      { level: 1, regex: '^=== (.+)$', replacement: '$1' },
    ])
    expect(same.chaptersChanged).toBe(false)
    rows = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, created.bookVersionId)).all()
    expect(rows).toHaveLength(2)
    // Previews and toc-state read through the same derivation.
    const preview = await previewCityToc(ownerId, libraryId, created.libraryBookId, created.versionLinkId!, {})
    expect(preview.totalChapters).toBeGreaterThan(0)
    const state = await getVersionTocState(ownerId, libraryId, created.libraryBookId, created.versionLinkId!)
    expect(state.chapters.length).toBeGreaterThan(0)
    // Members without a lane ticket are refused.
    await expect(reTocCityVersion(memberId, libraryId, created.libraryBookId, created.versionLinkId!))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('leads with the default display version instead of the oldest upload', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('old.txt', '第一章\n甲'), { title: 'Editions' })
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('new.txt', '第一章\n乙'), {
      libraryBookId: first.libraryBookId, name: '精校版',
    })
    expect((await getCatalogBook(ownerId, libraryId, first.libraryBookId)).versions[0].id).toBe(first.versionLinkId)
    await updateCatalogBook(ownerId, libraryId, first.libraryBookId, { defaultVersionLinkId: second.versionLinkId! })
    const detail = await getCatalogBook(ownerId, libraryId, first.libraryBookId)
    expect(detail.defaultVersionLinkId).toBe(second.versionLinkId)
    expect(detail.versions[0].id).toBe(second.versionLinkId)
    // Members follow the same lead; the list agrees with the detail.
    expect((await getCatalogBook(memberId, libraryId, first.libraryBookId)).versions[0].id).toBe(second.versionLinkId)
    expect((await listCatalogBooks(memberId, libraryId)).items[0].versions[0].id).toBe(second.versionLinkId)
    // Foreign and missing ids read as NOT_FOUND; members cannot write it.
    const other = await uploadCatalogBook(libraryId, ownerId, txtFile('other.txt', '第一章\n丙'), { title: 'Other' })
    await expect(updateCatalogBook(ownerId, libraryId, first.libraryBookId, { defaultVersionLinkId: other.versionLinkId! }))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    await expect(updateCatalogBook(ownerId, libraryId, first.libraryBookId, { defaultVersionLinkId: 'lbv_missing' }))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    await expect(updateCatalogBook(memberId, libraryId, first.libraryBookId, { defaultVersionLinkId: first.versionLinkId! }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Null clears back to oldest-first.
    await updateCatalogBook(ownerId, libraryId, first.libraryBookId, { defaultVersionLinkId: null })
    const cleared = await getCatalogBook(ownerId, libraryId, first.libraryBookId)
    expect(cleared.defaultVersionLinkId).toBeNull()
    expect(cleared.versions[0].id).toBe(first.versionLinkId)
    // Deleting the default version clears the pointer via the FK, never dangling.
    await updateCatalogBook(ownerId, libraryId, first.libraryBookId, { defaultVersionLinkId: second.versionLinkId! })
    await deleteCatalogVersion(ownerId, libraryId, first.libraryBookId, second.versionLinkId!)
    const orphaned = await getCatalogBook(ownerId, libraryId, first.libraryBookId)
    expect(orphaned.defaultVersionLinkId).toBeNull()
    expect(orphaned.versions).toHaveLength(1)
  })

  it('hides category subtrees and tagged works from non-managers', async () => {
    const parentId = createId('cat')
    const childId = createId('cat')
    db.insert(schema.libraryCategories).values([
      { id: parentId, libraryId, userId: ownerId, name: 'Vault', parentId: null, sortOrder: 0, pinned: false, hidden: true, createdAt: 1, updatedAt: 1 },
      { id: childId, libraryId, userId: ownerId, name: 'Vault Child', parentId: parentId, sortOrder: 1, pinned: false, hidden: false, createdAt: 1, updatedAt: 1 },
    ]).run()
    const tagId = seedTag(libraryId, 'Secret')
    db.update(schema.libraryTags).set({ hidden: true }).where(eq(schema.libraryTags.id, tagId)).run()
    const inHiddenChild = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '第一章\n甲'), { title: 'InHiddenChild', categoryId: childId })
    const taggedSecret = await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', '第一章\n乙'), { title: 'TaggedSecret', tagIds: [tagId] })
    await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', '第一章\n丙'), { title: 'Plain' })

    // The hidden subtree hides its descendants' works even though the child
    // row itself is not flagged; any hidden tag hides its works the same way.
    expect((await listCatalogBooks(memberId, libraryId)).total).toBe(1)
    expect((await listCatalogBooks(memberId, libraryId)).items.map((b) => b.title)).toEqual(['Plain'])
    expect((await listCatalogBooks(ownerId, libraryId)).total).toBe(3)
    // Taxonomy lists follow the same asymmetry: managers see hidden rows
    // badged, members never see them.
    const memberCategories = await listLibraryCategories(memberId, libraryId)
    expect(memberCategories.map((c) => c.name)).not.toContain('Vault')
    expect(memberCategories.map((c) => c.name)).not.toContain('Vault Child')
    const ownerCategories = await listLibraryCategories(ownerId, libraryId)
    expect(ownerCategories.find((c) => c.name === 'Vault')?.hidden).toBe(true)
    expect((await listLibraryTags(memberId, libraryId)).map((t) => t.name)).not.toContain('Secret')
    expect((await listLibraryTags(ownerId, libraryId)).find((t) => t.name === 'Secret')?.hidden).toBe(true)

    // Managers see taxonomy-hidden works marked effectiveHidden (direct flag
    // stays false); members never receive the rows at all.
    for (const created of [inHiddenChild, taggedSecret]) {
      const detail = await getCatalogBook(ownerId, libraryId, created.libraryBookId)
      expect(detail.hidden).toBe(false)
      expect(detail.effectiveHidden).toBe(true)
      await expect(getCatalogBook(memberId, libraryId, created.libraryBookId))
        .rejects.toMatchObject({ code: 'LIBRARY_BOOK_NOT_FOUND' })
    }
    // The cause names the exact layer: the nearest hidden ancestor for the
    // subtree child, the tag name for the tagged work.
    expect((await getCatalogBook(ownerId, libraryId, inHiddenChild.libraryBookId)).hiddenReason).toBe('category')
    expect((await getCatalogBook(ownerId, libraryId, inHiddenChild.libraryBookId)).hiddenVia).toEqual({ categoryName: 'Vault' })
    expect((await getCatalogBook(ownerId, libraryId, taggedSecret.libraryBookId)).hiddenReason).toBe('tag')
    expect((await getCatalogBook(ownerId, libraryId, taggedSecret.libraryBookId)).hiddenVia).toEqual({ tagNames: ['Secret'] })
    expect((await listCatalogBooks(ownerId, libraryId)).items.find((b) => b.title === 'InHiddenChild')?.effectiveHidden).toBe(true)
    expect((await listCatalogBooks(ownerId, libraryId)).items.find((b) => b.title === 'InHiddenChild')?.hiddenReason).toBe('category')
    expect((await listCatalogBooks(ownerId, libraryId)).items.find((b) => b.title === 'TaggedSecret')?.hiddenVia).toEqual({ tagNames: ['Secret'] })
    expect((await listCatalogBooks(ownerId, libraryId)).items.find((b) => b.title === 'Plain')?.effectiveHidden).toBe(false)
    expect((await listCatalogBooks(ownerId, libraryId)).items.find((b) => b.title === 'Plain')?.hiddenReason).toBeNull()
  })

  it('browses by search and category and pages the catalog', async () => {    const categoryId = createId('cat')
    db.insert(schema.libraryCategories).values({
      id: categoryId, libraryId, userId: ownerId, name: 'Sci-Fi',
      parentId: null, sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()
    await uploadCatalogBook(libraryId, ownerId, txtFile('alpha.txt', '第一章\n甲'), { title: 'Alpha', categoryId })
    await uploadCatalogBook(libraryId, ownerId, txtFile('beta.txt', '第一章\n乙'), { title: 'Beta' })

    const all = await listCatalogBooks(ownerId, libraryId)
    expect(all.total).toBe(2)
    expect(all.items.map((b) => b.title).sort()).toEqual(['Alpha', 'Beta'])
    expect((await listCatalogBooks(ownerId, libraryId, { search: 'alph' })).items.map((b) => b.title)).toEqual(['Alpha'])
    expect((await listCatalogBooks(ownerId, libraryId, { categoryId })).items.map((b) => b.title)).toEqual(['Alpha'])
    const paged = await listCatalogBooks(ownerId, libraryId, { page: 2 })
    expect(paged.page).toBe(2)
    expect(paged.items).toHaveLength(0)
  })

  it('keeps catalog writes to owners and admins', async () => {
    const created = await uploadCatalogBook(libraryId, adminId, txtFile('novel.txt', '第一章\n正文'))

    await expect(uploadCatalogBook(libraryId, memberId, txtFile('m.txt', 'm')))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(uploadCatalogBook(libraryId, outsiderId, txtFile('o.txt', 'o')))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateCatalogBook(memberId, libraryId, created.libraryBookId, { title: 'x' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateCatalogVersion(memberId, libraryId, created.libraryBookId, created.versionLinkId!, { status: 'unlisted' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Admins manage the catalog.
    expect((await updateCatalogBook(adminId, libraryId, created.libraryBookId, { title: 'Admin' })).title).toBe('Admin')
  })

  it('hides the catalog from users who cannot reach the library', async () => {
    const locked = await createLibrary({ userId: ownerId, isGuest: false }, { name: 'Locked' })
    await uploadCatalogBook(locked.id, ownerId, txtFile('secret.txt', '第一章\n密'))
    await expect(listCatalogBooks(outsiderId, locked.id)).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    await expect(listCatalogBooks(memberId, libraryId)).resolves.toMatchObject({ total: 0 })
  })

  it('suggests grouping candidates without ever grouping on its own', async () => {
    const exact = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: '三体', author: '刘慈欣' })
    await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', '乙'), { title: '三体 精校版', author: '刘慈欣' })
    await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', '丙'), { title: '球状闪电', author: '刘慈欣' })
    await uploadCatalogBook(libraryId, ownerId, txtFile('d.txt', '丁'), { title: '活着', author: '余华' })

    const byTitle = await findSimilarWorks(ownerId, libraryId, { title: ' 三体 ' })
    expect(byTitle.map((w) => w.title)).toEqual(['三体', '三体 精校版'])
    expect(byTitle[0]).toMatchObject({ matchScore: 3, id: exact.libraryBookId })
    // Same author alone is a weak hint, an unrelated book is not suggested.
    const byAuthor = await findSimilarWorks(ownerId, libraryId, { title: '陌生书名', author: '刘慈欣' })
    expect(byAuthor.map((w) => w.title).sort()).toEqual(['三体', '三体 精校版', '球状闪电'])
    expect(await findSimilarWorks(ownerId, libraryId, { title: '陌生书名', author: '无名' })).toEqual([])
    // The work being edited is never suggested as its own target.
    expect((await findSimilarWorks(ownerId, libraryId, { title: '三体', excludeLibraryBookId: exact.libraryBookId }))[0].id)
      .not.toBe(exact.libraryBookId)
    // Suggestions are a read for anyone who can browse, and a manager-only write follows.
    await uploadCatalogBook(libraryId, adminId, txtFile('e.txt', '戊'), { title: '三体（英译）' })
    expect(await findSimilarWorks(memberId, libraryId, { title: '三体' })).toHaveLength(3)
  })

  it('withholds hidden works from similar suggestions for non-managers', async () => {
    // A directly hidden work with published versions: the version filter
    // alone cannot catch it, only the work-level gate can.
    const hidden = await uploadCatalogBook(libraryId, ownerId, txtFile('h1.txt', '甲'), { title: '机密三体' })
    await uploadCatalogBook(libraryId, ownerId, txtFile('h2.txt', '乙'), {
      libraryBookId: hidden.libraryBookId, name: '第二版',
    })
    await updateCatalogBook(ownerId, libraryId, hidden.libraryBookId, { hidden: true })
    expect((await getCatalogBook(ownerId, libraryId, hidden.libraryBookId)).versions.map((v) => v.status))
      .toEqual(['published', 'published'])
    await uploadCatalogBook(libraryId, ownerId, txtFile('v.txt', '丙'), { title: '三体公开版' })

    expect((await findSimilarWorks(memberId, libraryId, { title: '三体' })).map((w) => w.title))
      .toEqual(['三体公开版'])
    // Managers still get the hint, badged.
    const managerHits = await findSimilarWorks(ownerId, libraryId, { title: '三体' })
    expect(managerHits.map((w) => w.title).sort()).toEqual(['三体公开版', '机密三体'].sort())
    expect(managerHits.find((w) => w.title === '机密三体')?.hidden).toBe(true)
  })

  it('moves a misfiled version without touching its content identity', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: '作品甲' })
    const second = await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', '乙'), {
      libraryBookId: first.libraryBookId, title: '作品甲第二版',
    })
    const other = await uploadCatalogBook(libraryId, ownerId, txtFile('c.txt', '丙'), { title: '作品乙' })

    const before = await getCatalogBook(ownerId, libraryId, other.libraryBookId)
    const moved = await moveCatalogVersion(ownerId, libraryId, first.libraryBookId, second.versionLinkId!, other.libraryBookId)
    // Version order inside a work is not meaningful, only the membership is.
    expect(moved.versions.map((v) => v.id).sort()).toEqual([before.versions[0].id, second.versionLinkId].sort())
    expect(moved.versions.find((v) => v.id === second.versionLinkId)?.bookVersionId).toBe(second.bookVersionId)
    // Content identity, revisions and the source work's own version are intact.
    expect(db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, second.bookVersionId)).all()).toHaveLength(1)
    expect((await getCatalogBook(ownerId, libraryId, first.libraryBookId)).versions.map((v) => v.id))
      .toEqual([first.versionLinkId])
  })

  it('refuses a move that would empty the source work', async () => {
    const only = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'))
    const target = await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', '乙'))
    await expect(moveCatalogVersion(ownerId, libraryId, only.libraryBookId, only.versionLinkId!, target.libraryBookId))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(moveCatalogVersion(ownerId, libraryId, only.libraryBookId, only.versionLinkId!, only.libraryBookId))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(moveCatalogVersion(memberId, libraryId, only.libraryBookId, only.versionLinkId!, target.libraryBookId))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await getCatalogBook(ownerId, libraryId, only.libraryBookId)).versions).toHaveLength(1)
  })

  it('deletes the last version together with its work and keeps shared content alive', async () => {
    const city = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: '作品甲' })
    const grouped = await uploadCatalogBook(libraryId, ownerId, txtFile('b.txt', '乙'), {
      libraryBookId: city.libraryBookId, title: '作品乙',
    })
    // The same file also lives in another library, so its blob must survive.
    const mirrorId = createId('lib')
    db.insert(schema.libraries).values({
      id: mirrorId, userId: ownerId, type: 'shared', name: 'Mirror',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const mirror = await uploadCatalogBook(mirrorId, ownerId, txtFile('a.txt', '甲'))
    const blobKey = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).get()!.blobKey

    // One of two versions: the work survives.
    expect(await deleteCatalogVersion(ownerId, libraryId, city.libraryBookId, grouped.versionLinkId!))
      .toMatchObject({ workDeleted: false })
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, city.libraryBookId)).get()).toBeTruthy()

    // The last version moves its work into the owner trash, mirrored content stays.
    expect(await deleteCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!))
      .toMatchObject({ trashed: true })
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, city.libraryBookId)).get()?.deletedAt).toEqual(expect.any(Number))
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, city.bookVersionId)).get()).toBeTruthy()
    expect(db.select().from(schema.blobs).where(eq(schema.blobs.key, blobKey)).get()).toBeTruthy()
    expect(files.get(blobKey)?.length ?? 0).toBeGreaterThan(0)
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, mirror.bookVersionId)).get()).toBeTruthy()
    await permanentDeleteCatalogBook(ownerId, libraryId, city.libraryBookId)
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, city.libraryBookId)).get()).toBeUndefined()
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, city.bookVersionId)).get()).toBeUndefined()
  })

  it('releases the work-level cover when the last version goes', async () => {
    const city = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: '作品甲' })
    // New works carry their cover on the work row, not on the version link.
    const coverKey = 'blobs/co/work.cover.jpg'
    db.update(schema.libraryBooks).set({ coverKey }).where(eq(schema.libraryBooks.id, city.libraryBookId)).run()
    db.insert(schema.blobs).values({ key: coverKey, size: 4, kind: 'cover', createdAt: 1 }).run()
    files.set(coverKey, Buffer.from('cover'))

    expect(await deleteCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!))
      .toMatchObject({ trashed: true })
    expect(files.has(coverKey)).toBe(true)
    await permanentDeleteCatalogBook(ownerId, libraryId, city.libraryBookId)
    expect(files.has(coverKey)).toBe(false)
    expect(db.select().from(schema.blobs).where(eq(schema.blobs.key, coverKey)).get()).toBeUndefined()
  })

  it('keeps a private B readable as provenance after its source version is deleted', async () => {
    const source = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: '作品甲' })
    // A private B referencing the city version, as Phase 7 will create it.
    const privateLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: privateLibraryId, userId: memberId, type: 'private', name: 'member',
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()
    const bWorkId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: bWorkId, libraryId: privateLibraryId, userId: memberId, categoryId: null,
      title: '作品甲', author: '', description: '', coverKey: null, createdAt: 1, updatedAt: 1,
    }).run()
    const bVersionId = createId('lbv')
    db.insert(schema.libraryBookVersions).values({
      id: bVersionId, libraryId: privateLibraryId, libraryBookId: bWorkId, bookVersionId: source.bookVersionId,
      kind: 'shared', sourceLibraryId: libraryId, sourceLibraryBookVersionId: source.versionLinkId,
      createdAt: 1, updatedAt: 1,
    }).run()
    expect(await resolveSourceRead(
      { sourceLibraryId: libraryId, sourceLibraryBookVersionId: source.versionLinkId }, { userId: memberId },
    )).toMatchObject({ readable: true })

    await deleteCatalogVersion(ownerId, libraryId, source.libraryBookId, source.versionLinkId!)

    // The B row is untouched and still names its source; only readability is gone.
    const bRow = db.select().from(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.id, bVersionId)).get()!
    expect(bRow).toMatchObject({ sourceLibraryId: libraryId, sourceLibraryBookVersionId: source.versionLinkId })
    expect(await resolveSourceRead(
      { sourceLibraryId: bRow.sourceLibraryId, sourceLibraryBookVersionId: bRow.sourceLibraryBookVersionId },
      { userId: memberId },
    )).toMatchObject({ readable: false, sourceLibraryId: libraryId, sourceLibraryBookVersionId: source.versionLinkId })
  })
})
