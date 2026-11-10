import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientBook, ClientNote, ClientReadingState } from '@bookdock/shared'
import { LocalLibraryRepository } from './repository'

const book: ClientBook = {
  ref: { scope: { kind: 'local', vaultId: 'v' }, bookId: 'b' },
  title: 'Book', authors: [], format: 'epub', content: null,
  availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0,
}
book.content = { book: book.ref, contentId: 'c' }
const state: ClientReadingState = { book: book.ref, readStatus: 'reading', position: null, fraction: 0, coverage: null, lastReadAt: 1, updatedAt: 1, version: 0 }
const note: ClientNote = { id: 'n', book: book.ref, kind: 'highlight', locator: null, text: 'Quote', color: 'yellow', style: 'underline', chapter: null, createdAt: 1, updatedAt: 1, version: 0 }
let repository: LocalLibraryRepository

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile); repository = new LocalLibraryRepository('test') })
afterEach(async () => { await repository.close(); vi.unstubAllGlobals() })

describe('authoritative local library transactions', () => {
  it('refuses a newer database without resetting it and permits safe disposal', async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('test', 4)
      open.onupgradeneeded = () => open.result.createObjectStore('future-records')
      open.onsuccess = () => { open.result.close(); resolve() }
      open.onerror = () => reject(open.error)
    })
    await expect(repository.listBooks('v')).rejects.toMatchObject({ category: 'storage-unavailable' })
    await expect(repository.close()).resolves.toBeUndefined()
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('test', 4)
      open.onsuccess = () => { expect(open.result.objectStoreNames.contains('future-records')).toBe(true); open.result.close(); resolve() }
      open.onerror = () => reject(open.error)
    })
  })

  it('upgrades the prototype database by adding indexes without losing files or notes', async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('test', 1)
      open.onupgradeneeded = () => { for (const name of ['books', 'files', 'states', 'notes', 'deleted', 'settings']) open.result.createObjectStore(name) }
      open.onsuccess = () => {
        const tx = open.result.transaction(['books', 'files', 'notes'], 'readwrite')
        tx.objectStore('books').put(book, JSON.stringify(['local', 'v', 'b']))
        tx.objectStore('files').put(new Blob(['abc']), JSON.stringify(['local', 'v', 'b']))
        tx.objectStore('notes').put({ ...note, version: 1 }, JSON.stringify([['local', 'v', 'b'], 'n']))
        tx.oncomplete = () => { open.result.close(); resolve() }
        tx.onabort = () => reject(tx.error)
      }
      open.onerror = () => reject(open.error)
    })
    expect(await repository.getBook(book.ref)).toEqual(book)
    expect((await repository.getFile(book.ref)).size).toBe(3)
    expect(await repository.listNotes(book.ref)).toMatchObject([{ id: 'n', version: 1 }])
  })

  it('acknowledges identical ingestion retries and rejects changed bytes under the same identity', async () => {
    await repository.addBook(book, new Blob(['abc']))
    expect(await repository.addBook(book, new Blob(['abc']))).toEqual(book)
    await expect(repository.addBook(book, new Blob(['xyz']))).rejects.toMatchObject({ category: 'conflict' })
    expect(await repository.listBooks('v')).toHaveLength(1)
  })
  it('survives closing and reopening without confusing identical IDs in another vault', async () => {
    await repository.addBook(book, new Blob(['abc']))
    await repository.saveState(state, 0)
    await repository.saveNote(note, 0)
    await repository.close()
    expect((await repository.getBook(book.ref)).title).toBe('Book')
    expect((await repository.getState(book.ref))?.fraction).toBe(0)
    expect(await repository.listNotes({ ...book.ref, scope: { kind: 'local', vaultId: 'other' } })).toEqual([])
    expect(await repository.listNotes(book.ref)).toHaveLength(1)
  })

  it('rejects stale state and note writes rather than overwriting another tab', async () => {
    await repository.addBook(book, new Blob(['abc']))
    await repository.saveState(state, 0)
    await expect(repository.saveState({ ...state, fraction: 0.8 }, 0)).rejects.toMatchObject({ category: 'conflict' })
    expect((await repository.getState(book.ref))?.fraction).toBe(0)
    await repository.saveNote(note, 0)
    expect((await repository.saveNote(note, 0)).version).toBe(1)
    await expect(repository.saveNote({ ...note, text: 'Stale' }, 0)).rejects.toMatchObject({ category: 'conflict' })
    expect((await repository.listNotes(book.ref))[0]).toMatchObject({ text: 'Quote' })
  })

  it('rolls back every highlight deletion when replacement validation fails', async () => {
    await repository.addBook(book, new Blob(['abc']))
    await repository.saveNote(note, 0)
    await expect(repository.saveNote({ ...note, id: 'replacement' }, 0, ['n', 'missing'])).rejects.toMatchObject({ category: 'conflict' })
    expect((await repository.listNotes(book.ref)).map((item) => item.id)).toEqual(['n'])
  })

  it('retains records on file removal and blocks resurrection after complete deletion', async () => {
    await repository.addBook(book, new Blob(['abc']))
    await repository.saveNote(note, 0)
    await repository.removeBook(book.ref)
    await expect(repository.getFile(book.ref)).rejects.toMatchObject({ category: 'unavailable-content' })
    await expect(repository.saveState(state, 0)).rejects.toMatchObject({ category: 'unavailable-content' })
    expect(await repository.listNotes(book.ref)).toHaveLength(1)
    await repository.removeBook(book.ref, true)
    await expect(repository.saveState(state, 0)).rejects.toMatchObject({ category: 'unavailable-content' })
    await expect(repository.addBook(book, new Blob(['abc']))).rejects.toMatchObject({ category: 'conflict' })
    expect(await repository.listNotes(book.ref)).toEqual([])
  })

  it('acknowledges identical create retries across time and rejects replay of deleted notes', async () => {
    await repository.addBook(book, new Blob(['abc']))
    const created = await repository.saveNote(note, 0)
    expect(await repository.saveNote({ ...note, createdAt: 99, updatedAt: 99 }, 0)).toEqual(created)
    await expect(repository.saveNote(note, 0, ['another-highlight'])).rejects.toMatchObject({ category: 'conflict' })
    await repository.deleteNote(book.ref, note.id)
    await expect(repository.saveNote(note, 0)).rejects.toMatchObject({ category: 'conflict' })
  })

  it('merges view setting patches transactionally and explicitly clears overrides', async () => {
    await repository.addBook(book, new Blob(['abc']))
    await repository.patchPreferences(book.ref, { viewSettings: { fontSize: 24 } })
    await repository.patchPreferences(book.ref, { viewSettings: { lineHeight: 2 } })
    expect((await repository.getPreferences(book.ref)).viewSettings).toEqual({ fontSize: 24, lineHeight: 2 })
    await repository.patchPreferences(book.ref, { viewSettings: null })
    expect((await repository.getPreferences(book.ref)).viewSettings).toBeUndefined()
  })

  it('does not retain an orphan file after a quota failure while committing metadata', async () => {
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError') })
    try { await expect(repository.addBook(book, new Blob(['abc']))).rejects.toMatchObject({ category: 'storage-full' }) } finally { add.mockRestore() }
    expect(await repository.listBooks('v')).toEqual([])
    const count = await new Promise<number>((resolve, reject) => {
      const open = indexedDB.open('test')
      open.onsuccess = () => {
        const read = open.result.transaction('files').objectStore('files').count()
        read.onsuccess = () => { resolve(read.result); open.result.close() }
        read.onerror = () => reject(read.error)
      }
      open.onerror = () => reject(open.error)
    })
    expect(count).toBe(0)
  })

  it('reports corrupt stored metadata without deleting existing records', async () => {
    await repository.addBook(book, new Blob(['abc']))
    await repository.saveNote(note, 0)
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('test')
      open.onsuccess = () => {
        const tx = open.result.transaction('books', 'readwrite')
        const store = tx.objectStore('books')
        const keys = store.getAllKeys()
        keys.onsuccess = () => store.put({ ...book, content: { book: book.ref, contentId: 42 } }, keys.result[0])
        tx.oncomplete = () => { open.result.close(); resolve() }
        tx.onabort = () => reject(tx.error)
      }
      open.onerror = () => reject(open.error)
    })
    await expect(repository.getBook(book.ref)).rejects.toMatchObject({ category: 'storage-unavailable' })
    expect(await repository.listNotes(book.ref)).toHaveLength(1)
  })

  it('finds active duplicate device books by file digest and ignores trashed ones', async () => {
    const file = new Blob(['duplicate content'], { type: 'text/plain' })
    await repository.addBook(book, file)
    const matched = await repository.findDuplicateBookByFile('v', file)
    expect(matched?.ref).toEqual(book.ref)

    await repository.trashBook(book.ref)
    const afterTrash = await repository.findDuplicateBookByFile('v', file)
    expect(afterTrash).toBeNull()
  })

  it('summarizes active and trashed device books, file bytes, note images, and browser storage state', async () => {
    const secondBook: ClientBook = {
      ...book,
      ref: { scope: { kind: 'local', vaultId: 'v' }, bookId: 'b2' },
      content: { book: { scope: { kind: 'local', vaultId: 'v' }, bookId: 'b2' }, contentId: 'c2' },
      size: 5,
    }
    await repository.addBook(book, new Blob(['abc']))
    await repository.addBook(secondBook, new Blob(['12345']))
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    const imageFile = new File([pngBytes], 'img.png', { type: 'image/png' })
    await repository.stageNoteImage(book.ref, 'draft-1', undefined, imageFile, new AbortController().signal)
    await repository.trashBook(secondBook.ref)

    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn(async () => ({ usage: 1024, quota: 4096 })),
      },
    })

    const summary = await repository.inspectStorage('v')
    expect(summary).toEqual({
      activeBooks: 1,
      totalBytes: 3 + 5 + pngBytes.byteLength,
      browserUsage: 1024,
    })
  })
})
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
