import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook, ClientOrganization } from '@bookdock/shared'
import { CATEGORY_TEMPLATES, parseLibrarySearch } from '@bookdock/shared'

import type { CatalogQuery } from '../reading-data/catalog'
import { catalogQueryKey } from '../reading-data/catalog'
import { localCatalogOperations } from './catalog'
import { LocalLibraryRepository } from './repository'

const scope = { kind: 'local' as const, vaultId: 'device' }
const query: CatalogQuery = { page: 1, pageSize: 24, search: '', sortBy: 'title', sortOrder: 'asc', shelfId: null, tagId: null, format: null, readStatus: null }
const book: ClientBook = { ref: { scope, bookId: 'same-id' }, title: 'Lighthouse', authors: ['Author'], format: 'epub', content: null, availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0 }
book.content = { book: book.ref, contentId: 'content' }
const organization: ClientOrganization = { version: 0, items: [
  { id: 'shelf', kind: 'shelf', name: 'Shelf', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
  { id: 'tag', kind: 'tag', name: 'Favorites', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
  { id: 'parent', kind: 'category', name: 'Fiction', parentId: null, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
  { id: 'child', kind: 'category', name: 'Adventure', parentId: 'parent', pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 },
] }
let repository: LocalLibraryRepository
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob); repository = new LocalLibraryRepository('catalog') })
afterEach(async () => { await repository.close(); vi.unstubAllGlobals() })

describe('scoped catalog operations', () => {
  it('rejects invalid initial placement without promoting the file, digest or cover', async () => {
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put')
    try {
      await expect(repository.addBook({ ...book, catalog: { shelfId: 'missing-shelf' } }, new Blob(['abc']), new Blob(['cover']))).rejects.toMatchObject({ category: 'invalid-input' })
      expect(writes).not.toHaveBeenCalled()
      expect(await repository.listBooks(scope.vaultId)).toEqual([])
      expect(await repository.getCover(book.ref)).toBeNull()
      await repository.saveOrganization(scope.vaultId, organization, 0)
      await repository.addBook({ ...book, catalog: { shelfId: 'shelf' } }, new Blob(['abc']), new Blob(['cover']))
      expect((await repository.getBook(book.ref)).catalog?.shelfId).toBe('shelf')
      expect((await repository.getFile(book.ref)).size).toBe(3)
    } finally { writes.mockRestore() }
  })

  it('rolls back the first written book when a later selected book has a stale version', async () => {
    await repository.addBook(book, new Blob(['abc']))
    const secondRef = { scope, bookId: 'second' }
    await repository.addBook({ ...book, ref: secondRef, content: { book: secondRef, contentId: 'second-content' } }, new Blob(['xyz']))
    const operations = localCatalogOperations(scope, repository)
    const selected = await operations.selection([book.ref.bookId, secondRef.bookId])
    expect(selected[0]).not.toHaveProperty('bookVersionId')
    expect(selected[0]).not.toHaveProperty('versionCount')
    expect(selected[0]).not.toHaveProperty('kind')
    await repository.updateMetadata(secondRef, { title: 'Concurrent edit' }, 0)
    const writes = vi.spyOn(IDBObjectStore.prototype, 'put')
    try {
      await expect(operations.updateSelection(selected, { pinned: true })).rejects.toMatchObject({ category: 'conflict' })
      expect(writes.mock.calls.map(([value]) => value)).toContainEqual(expect.objectContaining({ ref: book.ref, version: 1, catalog: expect.objectContaining({ pinnedAt: expect.any(Number) }) }))
    } finally { writes.mockRestore() }
    expect(await repository.getBook(book.ref)).toMatchObject({ version: 0 })
    expect((await repository.getBook(book.ref)).catalog?.pinnedAt).toBeUndefined()
    expect(await repository.getBook(secondRef)).toMatchObject({ title: 'Concurrent edit', version: 1 })
    await operations.updateSelection(await operations.selection([book.ref.bookId, secondRef.bookId]), { pinned: true })
    expect((await repository.getBook(book.ref)).catalog?.pinnedAt).toBeTypeOf('number')
    expect((await repository.getBook(secondRef)).catalog?.pinnedAt).toBeTypeOf('number')
  })

  it('rolls back category-template creation together with invalid metadata and cover changes', async () => {
    await repository.addBook(book, new Blob(['abc']), new Blob(['old']))
    const categoryTemplateKey = CATEGORY_TEMPLATES[0].key
    await expect(repository.updateMetadata(book.ref, { title: 'Rejected', categoryTemplateKey, catalog: { tagIds: ['foreign'] } }, 0, new Blob(['replacement']))).rejects.toMatchObject({ category: 'invalid-input' })
    expect((await repository.getOrganization(scope.vaultId)).items).toEqual([])
    expect((await repository.getBook(book.ref))).toMatchObject({ title: 'Lighthouse', version: 0 })
    expect((await repository.getCover(book.ref))?.size).toBe(3)
    const updated = await repository.updateMetadata(book.ref, { categoryTemplateKey }, 0)
    const organization = await repository.getOrganization(scope.vaultId)
    expect(organization.items.some((item) => item.id === updated.catalog?.categoryId && item.kind === 'category')).toBe(true)
    await repository.updateMetadata(book.ref, { categoryTemplateKey }, 1)
    expect(await repository.getOrganization(scope.vaultId)).toEqual(organization)
  })

  it('retains v2 records across catalog edits, cover promotion and reopening', async () => {
    await repository.addBook(book, new Blob(['abc']), new Blob(['old']))
    await repository.saveOrganization(scope.vaultId, organization, 0)
    const operations = localCatalogOperations(scope, repository)
    const next = await operations.update(book.ref, { title: 'Updated', catalog: { metadata: { publisher: 'Publisher' }, shelfId: 'shelf', categoryId: 'child', tagIds: ['tag'] } }, 0, new Blob(['new-cover']))
    expect(next.version).toBe(1)
    await repository.close()
    expect((await operations.detail(book.ref)).metadata?.publisher).toBe('Publisher')
    expect((await repository.getCover(book.ref))?.size).toBe(9)
    expect((await repository.getFile(book.ref)).size).toBe(3)
    await expect(operations.update(book.ref, { title: 'stale' }, 0, null)).rejects.toMatchObject({ category: 'conflict' })
    expect((await repository.getCover(book.ref))?.size).toBe(9)
  })

  it('rejects another vault and rolls back invalid organization with its cover', async () => {
    await repository.addBook(book, new Blob(['abc']), new Blob(['old']))
    const operations = localCatalogOperations(scope, repository)
    await expect(operations.detail({ ...book.ref, scope: { kind: 'local', vaultId: 'other' } })).rejects.toThrow('different data source')
    await expect(operations.update(book.ref, { title: 'Rejected', catalog: { tagIds: ['foreign-tag'] } }, 0, null)).rejects.toMatchObject({ category: 'invalid-input' })
    expect((await repository.getBook(book.ref)).title).toBe('Lighthouse')
    expect((await repository.getCover(book.ref))?.size).toBe(3)
  })

  it('supports compound search, descendant categories, hidden taxonomy and stable pagination', async () => {
    await repository.addBook(book, new Blob(['abc']))
    await repository.saveOrganization(scope.vaultId, organization, 0)
    await repository.updateMetadata(book.ref, { catalog: { categoryId: 'child', tagIds: ['tag'] } }, 0)
    const second = { ...book, ref: { scope, bookId: 'second' }, title: 'Another', content: null, size: null }
    await repository.addBook({ ...second, content: { book: second.ref, contentId: 'second-content' } }, new Blob(['xyz']))
    const operations = localCatalogOperations(scope, repository)
    expect((await operations.list({ ...query, categoryId: 'parent' })).entries.map((row) => row.book.ref.bookId)).toEqual(['same-id'])
    expect((await operations.list({ ...query, expression: JSON.stringify(parseLibrarySearch('tag:Favorites & !author:Other')) })).total).toBe(1)
    const page = await operations.list({ ...query, pageSize: 1 })
    expect(page.total).toBe(2)
    expect(page.totalSize).toBeNull()
    expect(page.entries[0].book.title).toBe('Another')
    await repository.saveOrganization(scope.vaultId, { ...organization, items: organization.items.map((item) => ({ ...item, hidden: item.id === 'parent' })) }, 1)
    expect((await operations.list(query)).total).toBe(1)
    expect((await operations.list({ ...query, showHidden: true })).total).toBe(2)
  })

  it('clears removed memberships atomically and rejects cycles and stale organization', async () => {
    await repository.addBook(book, new Blob(['abc']))
    await repository.saveOrganization(scope.vaultId, organization, 0)
    await repository.updateMetadata(book.ref, { catalog: { shelfId: 'shelf', tagIds: ['tag'] } }, 0)
    await repository.saveOrganization(scope.vaultId, { version: 1, items: [] }, 1)
    expect((await repository.getBook(book.ref)).catalog).toMatchObject({ shelfId: null, tagIds: [] })
    await expect(repository.updateMetadata(book.ref, { title: 'stale' }, 1)).rejects.toMatchObject({ category: 'conflict' })
    await expect(repository.saveOrganization(scope.vaultId, organization, 1)).rejects.toMatchObject({ category: 'conflict' })
    await expect(repository.saveOrganization(scope.vaultId, { ...organization, items: organization.items.map((item) => ({ ...item, parentId: item.id === 'parent' ? 'child' : item.parentId })) }, 2)).rejects.toMatchObject({ category: 'invalid-input' })
    expect((await repository.getOrganization(scope.vaultId)).items).toEqual([])
  })

  it('keeps missing state unknown and scopes same raw IDs by vault, account and guest', async () => {
    await repository.addBook(book, new Blob(['abc']))
    const operations = localCatalogOperations(scope, repository)
    const page = await operations.list(query)
    expect(page.entries[0]).toMatchObject({ state: null, metadata: null })
    expect(page.entries[0]).not.toHaveProperty('remote')
    const keys = [scope, { kind: 'local', vaultId: 'other' }, { kind: 'remote', connectionId: 'same', accountId: 'a' }, { kind: 'remote', connectionId: 'same', accountId: 'b' }, { kind: 'remote-guest', connectionId: 'same', guestScopeId: 'g' }] as const
    expect(new Set(keys.map((value) => JSON.stringify(catalogQueryKey(value, 'book', 'same-id')))).size).toBe(keys.length)
    const controller = new AbortController(); controller.abort()
    await expect(operations.list(query, controller.signal)).rejects.toThrow()
  })
})
import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

