import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Book, ClientBook, ClientNote, ClientReadingState } from '@bookdock/shared'

import { ApiError } from '@/api/client'

import { LocalLibraryError, LocalLibraryRepository } from './repository'
import { uploadLocalBookToServer } from './upload-to-server'

const apiPostMock = vi.fn()
const apiUploadMock = vi.fn()

vi.mock('@/api/client', async (original) => ({
  ...await original<typeof import('@/api/client')>(),
  apiPost: (...args: unknown[]) => apiPostMock(...args),
  apiUpload: (...args: unknown[]) => apiUploadMock(...args),
}))

const bookRef = { scope: { kind: 'local' as const, vaultId: 'v1' }, bookId: 'local-1' }

function makeBook(withCatalogTaxonomy = false): ClientBook {
  return {
    ref: bookRef,
    title: 'Local Novel',
    authors: ['Author One'],
    format: 'epub',
    fileName: 'local-novel.epub',
    content: { book: bookRef, contentId: 'c1' },
    availability: 'available',
    size: 11,
    createdAt: 1000,
    updatedAt: 2000,
    version: 0,
    catalog: {
      ...(withCatalogTaxonomy ? { shelfId: 'shelf-1', categoryId: 'cat-1', tagIds: ['tag-1'] } : {}),
      metadata: { publisher: 'Press' },
    },
  }
}

let repository: LocalLibraryRepository

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('File', NativeFile)
  apiPostMock.mockReset()
  apiUploadMock.mockReset()
  repository = new LocalLibraryRepository('upload-to-server-test')
})

afterEach(async () => {
  await repository.close()
  vi.unstubAllGlobals()
})

describe('uploadLocalBookToServer', () => {
  it('blocks migration when an active reading timer lease exists', async () => {
    await repository.addBook(makeBook(), new Blob(['epub-bytes-1']))
    await repository.claimReadingTimer('v1', {
      deviceId: 'dev-1',
      mode: 'auto',
      activityAt: Date.now(),
      explicit: true,
    })

    await expect(
      uploadLocalBookToServer(bookRef, { accountId: 'user-1', repository }),
    ).rejects.toMatchObject({ category: 'pending-reading' } satisfies Partial<LocalLibraryError>)
    expect(apiPostMock).not.toHaveBeenCalled()
    expect(apiUploadMock).not.toHaveBeenCalled()
    expect(await repository.listBooks('v1')).toHaveLength(1)
  })

  it('rejects duplicate server books without deleting the local copy', async () => {
    await repository.addBook(makeBook(), new Blob(['epub-bytes-1']))
    apiPostMock.mockResolvedValueOnce({ data: { duplicated: true, bookId: 'srv-1', title: 'Existing' } })

    await expect(
      uploadLocalBookToServer(bookRef, { accountId: 'user-1', repository }),
    ).rejects.toMatchObject({ code: 'BOOK_DUPLICATE' })
    expect(apiUploadMock).not.toHaveBeenCalled()
    expect((await repository.getBook(bookRef)).title).toBe('Local Novel')
  })

  it('keeps local copy untouched when upload fails with a network error', async () => {
    await repository.addBook(makeBook(), new Blob(['epub-bytes-1']))
    apiPostMock.mockResolvedValueOnce({ data: { duplicated: false } })
    apiUploadMock.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', undefined, 0))

    await expect(
      uploadLocalBookToServer(bookRef, { accountId: 'user-1', repository }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    expect((await repository.getBook(bookRef)).title).toBe('Local Novel')
  })

  it('migrates file, cover, metadata, reading state, notes/images, review, and removes local copy', async () => {
    await repository.saveOrganization('v1', {
      version: 0,
      items: [
        { id: 'shelf-1', kind: 'shelf', name: 'Favorites', parentId: null, sortOrder: 0, pinned: false, hidden: false, createdAt: 1000, updatedAt: 1000 },
        { id: 'cat-1', kind: 'category', name: 'Fiction', parentId: null, sortOrder: 0, pinned: false, hidden: false, createdAt: 1000, updatedAt: 1000 },
        { id: 'tag-1', kind: 'tag', name: 'Sci-Fi', parentId: null, sortOrder: 0, pinned: false, hidden: false, createdAt: 1000, updatedAt: 1000 },
      ],
    }, 0)
    const coverBlob = new Blob(['cover-bytes'], { type: 'image/webp' })
    await repository.addBook(makeBook(true), new Blob(['epub-bytes-1']), coverBlob)

    const state: ClientReadingState = {
      book: bookRef,
      readStatus: 'reading',
      position: { content: { book: bookRef, contentId: 'c1' }, schemaVersion: 1, kind: 'epub-cfi', value: 'epubcfi(/6/4!/2)' },
      fraction: 0.42,
      chapter: 'Chapter 2',
      coverage: { content: { book: bookRef, contentId: 'c1' }, fraction: 0.42, available: true },
      lastReadAt: 3000,
      updatedAt: 3000,
      version: 0,
    }
    await repository.saveState(state, 0, [[0, 0.42]])

    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    const staged = await repository.stageNoteImage(
      bookRef,
      'draft-1',
      undefined,
      new File([pngBytes], 'note.png', { type: 'image/png' }),
      new AbortController().signal,
    )
    const note: ClientNote = {
      id: 'note-1',
      book: bookRef,
      kind: 'idea',
      locator: { content: { book: bookRef, contentId: 'c1' }, schemaVersion: 1, kind: 'epub-cfi', href: 'ch2.xhtml', value: 'epubcfi(/6/4!/2)' },
      text: 'Important sentence',
      body: 'My thought',
      images: [staged],
      chapter: 'Chapter 2',
      createdAt: 3100,
      updatedAt: 3200,
      version: 0,
    }
    await repository.saveNote(note, 0, [], { imageIds: [staged.id], draftId: 'draft-1' })
    await repository.saveReview(bookRef, { ratingHalves: 8, title: 'Great read', body: 'Loved it', bodyFormat: 'plain' })

    const serverBook: Book = {
      id: 'srv-imported-1',
      title: 'Local Novel',
      author: 'Author One',
      authors: ['Author One'],
      format: 'epub',
      coverKey: 'cov-1',
      size: 12,
      readStatus: 'reading',
      progress: 42,
      createdAt: 1000,
      updatedAt: 4000,
      shelfId: 'shelf-1',
      effectiveHidden: false,
      hiddenReason: null,
    }
    apiPostMock.mockResolvedValueOnce({ data: { duplicated: false } })
    apiUploadMock.mockImplementationOnce(async (_url: string, formData: FormData) => {
      const payloadRaw = formData.get('payload')
      expect(typeof payloadRaw).toBe('string')
      const parsed = JSON.parse(String(payloadRaw)) as {
        book: { title: string; fileName: string; contentId: string }
        notes: Array<{ id: string; imageIds?: string[] }>
        review: { title: string; ratingHalves: number }
      }
      expect(parsed.book.title).toBe('Local Novel')
      expect(parsed.book.fileName).toBe('local-novel.epub')
      expect(parsed.notes).toHaveLength(1)
      expect(parsed.notes[0]?.imageIds).toEqual([staged.id])
      expect(parsed.review.title).toBe('Great read')
      expect(parsed.review.ratingHalves).toBe(8)
      expect(formData.get('file')).toBeTruthy()
      expect(formData.get('cover')).toBeTruthy()
      expect(formData.get(`image_${staged.id}`)).toBeTruthy()
      return { data: { book: serverBook, requestId: 'req-1' } }
    })

    const uploaded = await uploadLocalBookToServer(bookRef, { accountId: 'user-1', repository })
    expect(uploaded.id).toBe('srv-imported-1')
    expect(await repository.listBooks('v1')).toEqual([])
    await expect(repository.getFile(bookRef)).rejects.toMatchObject({ category: 'unavailable-content' })
  })

  it('reuses persisted requestId and skips duplicate-check if local cleanup fails after upload', async () => {
    await repository.addBook(makeBook(), new Blob(['epub-bytes-1']))
    apiPostMock.mockResolvedValueOnce({ data: { duplicated: false } })
    let seenRequestId: string | null = null
    apiUploadMock.mockImplementation(async (_url: string, formData: FormData) => {
      const payload = JSON.parse(String(formData.get('payload'))) as { requestId: string }
      if (!seenRequestId) seenRequestId = payload.requestId
      else expect(payload.requestId).toBe(seenRequestId)
      return {
        data: {
          book: {
            id: 'srv-1',
            title: 'Local Novel',
            author: 'Author One',
            authors: ['Author One'],
            format: 'epub',
            coverKey: null,
            size: 12,
            readStatus: 'wishlist',
            progress: null,
            createdAt: 1000,
            updatedAt: 2000,
            shelfId: null,
            effectiveHidden: false,
            hiddenReason: null,
          },
          requestId: payload.requestId,
        },
      }
    })

    const removeSpy = vi.spyOn(repository, 'removeBook').mockRejectedValueOnce(new Error('IDB transient error'))
    await expect(uploadLocalBookToServer(bookRef, { accountId: 'user-1', repository })).rejects.toThrow('IDB transient error')
    expect(seenRequestId).toBeTruthy()
    expect(await repository.getUploadMigrationReceipt(bookRef, 'user-1')).toBe(seenRequestId)

    removeSpy.mockRestore()
    const retried = await uploadLocalBookToServer(bookRef, { accountId: 'user-1', repository })
    expect(retried.id).toBe('srv-1')
    expect(apiPostMock).toHaveBeenCalledTimes(1)
    expect(await repository.listBooks('v1')).toEqual([])
  })
})
