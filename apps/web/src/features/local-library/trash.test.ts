import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { localCatalogOperations } from './catalog'
import { LocalLibraryRepository } from './repository'

const ref = { scope: { kind: 'local' as const, vaultId: 'trash' }, bookId: 'book' }
let repository: LocalLibraryRepository
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  repository = new LocalLibraryRepository('trash-test')
  await repository.addBook({ ref, content: { book: ref, contentId: 'content' }, format: 'epub', title: 'Book', authors: [], availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }, new Blob(['abc']))
  await repository.saveNote({ id: 'note', book: ref, kind: 'idea', body: 'Personal note', text: '', locator: null, chapter: null, createdAt: 1, updatedAt: 1, version: 0 }, 0)
})
afterEach(async () => { await repository.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

it('keeps bytes and notes through soft deletion and restores the same identity with version checks', async () => {
  await repository.trashBook(ref, true)
  expect(await repository.hasPublication(ref)).toBe(false)
  await expect(repository.getFile(ref)).rejects.toMatchObject({ category: 'unavailable-content' })
  expect(await repository.listNotes(ref)).toHaveLength(1)
  await expect(repository.restoreBook(ref, 0)).rejects.toMatchObject({ category: 'conflict' })
  await repository.restoreBook(ref, 1)
  expect(await (await repository.getFile(ref)).text()).toBe('abc')
  expect(await repository.getBook(ref)).toMatchObject({ deletedAt: null, trashDeleteUserData: false, version: 2 })
  await expect(repository.purgeBook(ref, 1)).rejects.toMatchObject({ category: 'conflict' })
})

it('purges publication bytes without re-listing retained private records and honors deferred full deletion', async () => {
  await repository.trashBook(ref)
  await repository.purgeBook(ref, 1)
  expect(await repository.getBook(ref)).toMatchObject({ availability: 'removed', catalogRemoved: true, deletedAt: null })
  expect(await repository.listNotes(ref)).toHaveLength(1)
  await expect(repository.restoreBook(ref)).rejects.toMatchObject({ category: 'conflict' })
  const other = { ...ref, bookId: 'other' }
  await repository.addBook({ ...(await repository.getBook(ref)), ref: other, content: { book: other, contentId: 'other-content' }, availability: 'available', catalogRemoved: false, version: 0 }, new Blob(['xyz']))
  await repository.trashBook(other, true)
  expect(await repository.emptyTrash('trash')).toBe(1)
  await expect(repository.getBook(other)).rejects.toMatchObject({ category: 'unavailable-content' })
})

it('applies the existing expiry/disable settings in the vault without touching another vault', async () => {
  await repository.patchTrashSettings('trash', { autoCleanDays: 7 })
  const now = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01').getTime())
  await repository.trashBook(ref)
  now.mockReturnValue(new Date('2026-01-09').getTime())
  expect(await repository.emptyTrash('other', false)).toBe(0)
  expect(await repository.emptyTrash('trash', false)).toBe(1)
  await repository.patchTrashSettings('trash', { enabled: false })
  expect((await repository.getTrashSettings('trash')).enabled).toBe(false)
})

it('uses separate active/trash lists and the original deleted-time sort', async () => {
  const operations = localCatalogOperations(ref.scope, repository)
  const query = { page: 1, pageSize: 20, search: '', sortBy: 'deletedAt', sortOrder: 'desc', shelfId: null, tagId: null, format: null, readStatus: null }
  await operations.trash(ref)
  expect((await operations.list({ ...query, trash: false })).total).toBe(0)
  expect((await operations.list({ ...query, trash: true })).entries[0]?.book.ref).toEqual(ref)
  await operations.restore(ref, 1)
  expect((await operations.list({ ...query, trash: false })).total).toBe(1)
  expect((await operations.list({ ...query, trash: true })).total).toBe(0)
})

it('enforces the configured capacity without allocating a GiB fixture or evicting an active book', async () => {
  const large = { ...ref, bookId: 'large' }
  await repository.addBook({ ...(await repository.getBook(ref)), ref: large, content: { book: large, contentId: 'large-content' }, size: 2 * 1024 ** 3 }, new Blob(['xyz']))
  await repository.patchTrashSettings('trash', { maxTrashBytes: 1073741824 })
  await repository.trashBook(large)
  expect(await repository.getBook(large)).toMatchObject({ availability: 'removed', catalogRemoved: true })
  expect(await (await repository.getFile(ref)).text()).toBe('abc')
})

it('rolls back partial physical cleanup if storage fails', async () => {
  await repository.trashBook(ref)
  const originalDelete = IDBObjectStore.prototype.delete
  const failure = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (query) {
    if (this.name === 'files' && String(query).startsWith('digest:')) throw new DOMException('Injected failure', 'QuotaExceededError')
    return originalDelete.call(this, query)
  })
  await expect(repository.purgeBook(ref, 1)).rejects.toMatchObject({ category: 'storage-full' })
  failure.mockRestore()
  expect((await repository.getBook(ref)).deletedAt).not.toBeNull()
  expect(await repository.listNotes(ref)).toHaveLength(1)
  await repository.restoreBook(ref, 1)
  expect(await (await repository.getFile(ref)).text()).toBe('abc')
})
