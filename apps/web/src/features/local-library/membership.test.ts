import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBDatabase, IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import { localCatalogOperations } from './catalog'
import { deviceMembershipCounts } from './catalog-view'
import { LocalLibraryRepository } from './repository'

const scope = { kind: 'local' as const, vaultId: 'device' }
const ref = { scope, bookId: 'device-book' }
const book: ClientBook = {
  ref, title: 'Device book', authors: ['Author'], format: 'epub',
  content: { book: ref, contentId: 'content' },
  availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0,
}
const query = { page: 1, pageSize: 24, search: '', sortBy: 'title', sortOrder: 'asc', shelfId: null, tagId: null, format: null, readStatus: null }

let repository: LocalLibraryRepository

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('File', NativeFile)
  repository = new LocalLibraryRepository('membership')
})
afterEach(async () => { await repository.close(); vi.unstubAllGlobals() })

describe('device membership', () => {
  it('files a book under a mirrored tree node and finds it from that shelf', async () => {
    // The shelf lives on the server; mirroring is what lets the device book
    // point at it while membership validation stays strict.
    await repository.mirrorOrganization('device', [{ id: 'shelf_from_server', kind: 'shelf', name: '服务器上的书架', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 }])
    await repository.addBook({ ...book, catalog: { shelfId: 'shelf_from_server' } }, new Blob(['abc']))
    const page = await localCatalogOperations(scope, repository).list({ ...query, shelfId: 'shelf_from_server' })
    expect(page.entries.map((entry) => entry.book.ref.bookId)).toEqual(['device-book'])
    const other = await localCatalogOperations(scope, repository).list({ ...query, shelfId: 'shelf_somewhere_else' })
    expect(other.entries).toEqual([])
  })

  it('rejects an id nobody owns, even with a mirror in place', async () => {
    await repository.mirrorOrganization('device', [{ id: 'shelf_from_server', kind: 'shelf', name: 'S', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 }])
    await expect(repository.addBook({ ...book, catalog: { shelfId: 'nobody_owns_this' } }, new Blob(['abc'])))
      .rejects.toMatchObject({ category: 'invalid-input' })
  })

  it('still rejects an id the vault owns when its kind does not match', async () => {
    await repository.saveOrganization('device', {
      version: 0,
      items: [{ id: 'shelf_local', kind: 'shelf', name: '本地书架', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 }],
    }, 0)
    await expect(repository.addBook({ ...book, catalog: { categoryId: 'shelf_local' } }, new Blob(['abc'])))
      .rejects.toThrow(/Organization does not belong to this vault/)
  })

  it('counts membership from the books, whichever tree the ids came from', async () => {
    await repository.mirrorOrganization('device', [
      { id: 'shelf_from_server', kind: 'shelf', name: 'S', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
      { id: 'category_server', kind: 'category', name: 'C', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
      { id: 'tag_server', kind: 'tag', name: 'T', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
    ])
    await repository.addBook({ ...book, catalog: { shelfId: 'shelf_from_server', categoryId: 'category_server', tagIds: ['tag_server'] } }, new Blob(['abc']))
    const counts = deviceMembershipCounts(await repository.readCatalog('device'))
    expect(counts.shelves.get('shelf_from_server')).toBe(1)
    expect(counts.categories.get('category_server')).toBe(1)
    expect(counts.tags.get('tag_server')).toBe(1)
  })

  it('drops the count once the book is trashed', async () => {
    await repository.mirrorOrganization('device', [{ id: 'shelf_from_server', kind: 'shelf', name: 'S', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 }])
    await repository.addBook({ ...book, catalog: { shelfId: 'shelf_from_server' } }, new Blob(['abc']))
    await repository.trashBook(ref)
    const counts = deviceMembershipCounts(await repository.readCatalog('device'))
    expect(counts.shelves.get('shelf_from_server')).toBeUndefined()
  })

  it('serializes concurrent mirrorOrganization and syncAccountTaxonomy without CAS conflict', async () => {
    await repository.mirrorOrganization('device', [
      { id: 'shelf_1', kind: 'shelf', name: 'One', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
    ])
    await expect(
      Promise.all([
        repository.mirrorOrganization('device', [
          { id: 'shelf_1', kind: 'shelf', name: 'One', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
          { id: 'shelf_2', kind: 'shelf', name: 'Two', parentId: null, pinned: false, hidden: false, sortOrder: 1, createdAt: 1, updatedAt: 1 },
        ]),
        repository.syncAccountTaxonomy('device', [
          { id: 'shelf_1', kind: 'shelf', name: 'One', sortOrder: 0 },
          { id: 'shelf_2', kind: 'shelf', name: 'Two', sortOrder: 1 },
        ]),
      ]),
    ).resolves.toBeDefined()
    const snapshot = await repository.readCatalog('device')
    expect(snapshot.organization.items.map((item) => item.id).sort()).toEqual(['shelf_1', 'shelf_2'])
  })

  it('skips organization writes when syncAccountTaxonomy sees no changes', async () => {
    await repository.mirrorOrganization('device', [
      { id: 'shelf_1', kind: 'shelf', name: 'One', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
    ])
    await repository.syncAccountTaxonomy('device', [{ id: 'shelf_1', kind: 'shelf', name: 'One', sortOrder: 0 }])
    const before = (await repository.readCatalog('device')).organization.version
    const txSpy = vi.spyOn(IDBDatabase.prototype, 'transaction')
    try {
      await repository.syncAccountTaxonomy('device', [{ id: 'shelf_1', kind: 'shelf', name: 'One', sortOrder: 0 }])
      expect(txSpy.mock.calls.some(([, mode]) => mode === 'readwrite')).toBe(false)
    } finally {
      txSpy.mockRestore()
    }
    const after = (await repository.readCatalog('device')).organization.version
    expect(after).toBe(before)
  })

  it('skips readwrite trash cleanup transactions during readCatalog when nothing is expired or oversized', async () => {
    await repository.addBook(book, new Blob(['abc']))
    const txSpy = vi.spyOn(IDBDatabase.prototype, 'transaction')
    try {
      const snapshot = await repository.readCatalog('device')
      expect(snapshot.books).toHaveLength(1)
      expect(txSpy.mock.calls.some(([, mode]) => mode === 'readwrite')).toBe(false)
    } finally {
      txSpy.mockRestore()
    }
  })
})
