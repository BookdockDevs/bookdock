import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnnotationRes, BookDetailRes, ReadingProgressRes } from '@bookdock/shared'

import { ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'

import { remoteReaderSession } from '../reading-data/remote-reader-session'
import { applyOfflineNoteOps, flushRemoteOfflineOutbox, isOfflineOrNetworkError, mergePendingProgress } from './offline-sync'
import { RemoteBookCacheRepository, remoteBookCache, remoteCacheScopeKey } from './remote-book-cache'
import { useRemoteCacheStore } from './remote-cache.store'

const apiGetMock = vi.fn()
const apiPostMock = vi.fn()
const apiPutMock = vi.fn()
const apiPatchMock = vi.fn()
const apiDeleteMock = vi.fn()
const apiUploadMock = vi.fn()

vi.mock('@/api/client', async (original) => ({
  ...await original<typeof import('@/api/client')>(),
  BASE_URL: '/api/v1',
  apiGet: (...args: unknown[]) => apiGetMock(...args),
  apiPost: (...args: unknown[]) => apiPostMock(...args),
  apiPut: (...args: unknown[]) => apiPutMock(...args),
  apiPatch: (...args: unknown[]) => apiPatchMock(...args),
  apiDelete: (...args: unknown[]) => apiDeleteMock(...args),
  apiUpload: (...args: unknown[]) => apiUploadMock(...args),
}))

function makeDetail(overrides: Partial<BookDetailRes> = {}): BookDetailRes {
  return {
    id: 'book-1',
    title: 'Server Book',
    author: 'Writer',
    authors: ['Writer'],
    format: 'epub',
    coverKey: null,
    size: 12,
    readStatus: 'reading',
    progress: 10,
    createdAt: 1000,
    updatedAt: 2000,
    shelfId: null,
    effectiveHidden: false,
    hiddenReason: null,
    revisionId: 'rev-1',
    filePath: 'blob://rev-1',
    meta: {},
    readerSettings: {},
    ...overrides,
  }
}

let repository: RemoteBookCacheRepository

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('File', NativeFile)
  apiGetMock.mockReset()
  apiPostMock.mockReset()
  apiPutMock.mockReset()
  apiPatchMock.mockReset()
  apiDeleteMock.mockReset()
  apiUploadMock.mockReset()
  useToastStore.setState({ toasts: [] })
  useAuthStore.setState({ user: { id: 'u1', username: 'alice', role: 'owner' } })
  useRemoteCacheStore.setState({ scopeKey: remoteCacheScopeKey('u1'), hydrated: true, cached: {}, tasks: {}, pendingSync: {} })
  repository = new RemoteBookCacheRepository('remote-cache-test')
})

afterEach(async () => {
  await repository.close()
  await remoteBookCache.close()
  vi.unstubAllGlobals()
})

describe('RemoteBookCacheRepository', () => {
  it('stores, reads, updates prompt revision, and deletes cached snapshots', async () => {
    const scope = remoteCacheScopeKey('u1')
    const detail = makeDetail()
    await repository.saveBook(
      {
        bookId: 'book-1',
        scopeKey: scope,
        revisionId: 'rev-1',
        contentUpdatedAt: 2000,
        format: 'epub',
        title: 'Server Book',
        size: 9,
        cachedAt: 3000,
        updatedAt: 3000,
        promptedUpdateRevisionId: null,
        detail,
        chapters: [],
        progress: null,
        notes: [],
        replacements: [],
      },
      new Blob(['epub-body']),
      new Blob(['cover-body']),
    )

    const summaries = await repository.listSummaries(scope)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ bookId: 'book-1', revisionId: 'rev-1', size: 9 })

    const loaded = await repository.getBook(scope, 'book-1')
    expect(await loaded?.file.text()).toBe('epub-body')
    expect(await loaded?.cover?.text()).toBe('cover-body')

    await repository.markUpdatePrompted(scope, 'book-1', 'rev-2')
    expect((await repository.getBookRecord(scope, 'book-1'))?.promptedUpdateRevisionId).toBe('rev-2')

    await repository.removeBook(scope, 'book-1')
    expect(await repository.getBook(scope, 'book-1')).toBeNull()
  })

  it('coalesces create+update and cancels create+delete note ops with staged images', async () => {
    const scope = remoteCacheScopeKey('u1')
    await repository.stageOutboxImage(scope, 'book-1', 'pending-img-1', new Blob(['img']))
    const baseNote: AnnotationRes = {
      id: 'tmp-1',
      userId: 'u1',
      bookId: 'book-1',
      type: 'idea',
      text: 'Quote',
      note: 'Initial',
      cfi: 'epubcfi(/6/2)',
      chapter: 'Ch 1',
      createdAt: 100,
      updatedAt: 100,
    }
    await repository.enqueueNoteOp(scope, 'book-1', {
      type: 'create',
      tempId: 'tmp-1',
      body: { type: 'idea', text: 'Quote', note: 'Initial', cfi: 'epubcfi(/6/2)', chapter: 'Ch 1' },
      pendingImageIds: ['pending-img-1'],
      optimistic: baseNote,
      createdAt: 100,
    })
    await repository.enqueueNoteOp(scope, 'book-1', {
      type: 'update',
      noteId: 'tmp-1',
      body: { note: 'Edited offline' },
      updatedAt: 200,
    })

    let ops = await repository.getPendingNoteOps(scope, 'book-1')
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ type: 'create', body: { note: 'Edited offline' } })
    expect(applyOfflineNoteOps([], ops)[0]?.note).toBe('Edited offline')

    await repository.enqueueNoteOp(scope, 'book-1', {
      type: 'delete',
      noteId: 'tmp-1',
      deletedAt: 300,
    })
    ops = await repository.getPendingNoteOps(scope, 'book-1')
    expect(ops).toEqual([])
    expect(await repository.getOutboxImage(scope, 'book-1', 'pending-img-1')).toBeNull()
  })

  it('preserves newer offline pending progress over older clear requests', async () => {
    const scope = remoteCacheScopeKey('u1')
    await repository.savePendingProgress({
      bookId: 'book-1',
      scopeKey: scope,
      revisionId: 'rev-1',
      body: { cfi: 'epubcfi(/6/8)', percent: 75, fraction: 0.75, revisionId: 'rev-1' },
      updatedAt: 5000,
    })
    await repository.clearPendingProgress(scope, 'book-1', 4000)
    expect(await repository.getPendingProgress(scope, 'book-1')).not.toBeNull()

    const merged = mergePendingProgress(
      { id: 'p1', bookId: 'book-1', cfi: 'epubcfi(/6/2)', percent: 10, updatedAt: 2000 } satisfies ReadingProgressRes,
      await repository.getPendingProgress(scope, 'book-1'),
    )
    expect(merged?.percent).toBe(75)
  })
})

describe('useRemoteCacheStore & offline sync', () => {
  it('downloads and caches a server book with progress tracking and supports removal', async () => {
    const detail = makeDetail()
    apiGetMock.mockImplementation(async (url: string) => {
      if (url === '/books/book-1') return { data: detail }
      if (url === '/books/book-1/chapters') return { data: [] }
      if (url === '/progress/book-1') return { data: null }
      if (url === '/annotations/book/book-1') return { data: [] }
      if (url.startsWith('/replacements')) return { data: [] }
      return { data: null }
    })

    const payloadBytes = new TextEncoder().encode('cached-epub-content')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payloadBytes.slice(0, 6))
        controller.enqueue(payloadBytes.slice(6))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'content-length': String(payloadBytes.byteLength) },
    })))

    const ok = await useRemoteCacheStore.getState().cacheBook(
      { id: 'book-1', title: 'Server Book', format: 'epub', size: payloadBytes.byteLength, revisionId: 'rev-1' },
      'u1',
      false,
      repository,
    )
    expect(ok).toBe(true)
    expect(useRemoteCacheStore.getState().cached['book-1']).toMatchObject({ revisionId: 'rev-1' })
    expect(useRemoteCacheStore.getState().tasks['book-1']).toBeUndefined()

    const loaded = await repository.getBook(remoteCacheScopeKey('u1'), 'book-1')
    expect(await loaded?.file.text()).toBe('cached-epub-content')

    await useRemoteCacheStore.getState().removeCache('book-1', 'u1', repository)
    expect(useRemoteCacheStore.getState().cached['book-1']).toBeUndefined()
  })

  it('flushes queued progress and note ops including staged images when back online', async () => {
    const scope = remoteCacheScopeKey('u1')
    await repository.saveBook(
      {
        bookId: 'book-1',
        scopeKey: scope,
        revisionId: 'rev-1',
        contentUpdatedAt: 2000,
        format: 'epub',
        title: 'Server Book',
        size: 4,
        cachedAt: 1000,
        updatedAt: 1000,
        promptedUpdateRevisionId: null,
        detail: makeDetail(),
        chapters: [],
        progress: null,
        notes: [],
        replacements: [],
      },
      new Blob(['epub']),
    )
    await repository.savePendingProgress({
      bookId: 'book-1',
      scopeKey: scope,
      revisionId: 'rev-1',
      body: { cfi: 'epubcfi(/6/6)', percent: 60, fraction: 0.6, revisionId: 'rev-1' },
      updatedAt: 4000,
    })
    await repository.stageOutboxImage(scope, 'book-1', 'pending-1', new Blob(['png-bytes'], { type: 'image/webp' }))
    await repository.enqueueNoteOp(scope, 'book-1', {
      type: 'create',
      tempId: 'tmp-note-1',
      body: { type: 'idea', text: 'Excerpt', note: 'Offline idea', cfi: 'epubcfi(/6/6)', chapter: 'Ch 3', draftId: 'draft-1' },
      pendingImageIds: ['pending-1'],
      optimistic: {
        id: 'tmp-note-1',
        userId: 'u1',
        bookId: 'book-1',
        type: 'idea',
        text: 'Excerpt',
        note: 'Offline idea',
        cfi: 'epubcfi(/6/6)',
        chapter: 'Ch 3',
        createdAt: 4000,
        updatedAt: 4000,
      },
      createdAt: 4000,
    })

    apiPutMock.mockResolvedValue({ data: { id: 'p1', bookId: 'book-1', cfi: 'epubcfi(/6/6)', percent: 60, updatedAt: 4500 } })
    apiUploadMock.mockResolvedValue({ data: { id: 'srv-img-1' } })
    apiPostMock.mockResolvedValue({ data: { id: 'srv-note-1', userId: 'u1', bookId: 'book-1', type: 'idea', createdAt: 4500, updatedAt: 4500 } })

    await flushRemoteOfflineOutbox('u1', 'book-1', repository)

    expect(apiPutMock).toHaveBeenCalledWith('/progress/book-1', expect.objectContaining({ percent: 60 }))
    expect(apiUploadMock).toHaveBeenCalledTimes(1)
    expect(apiPostMock).toHaveBeenCalledWith(
      '/annotations/book/book-1',
      expect.objectContaining({ imageIds: ['srv-img-1'], note: 'Offline idea' }),
    )
    expect(await repository.getPendingProgress(scope, 'book-1')).toBeNull()
    expect(await repository.getPendingNoteOps(scope, 'book-1')).toEqual([])
    expect(await repository.getOutboxImage(scope, 'book-1', 'pending-1')).toBeNull()
  })

  it('falls back to cached snapshot when offline and emits a one-time notice on server revision mismatch', async () => {
    const scope = remoteCacheScopeKey('u1')
    await remoteBookCache.saveBook(
      {
        bookId: 'book-1',
        scopeKey: scope,
        revisionId: 'rev-1',
        contentUpdatedAt: 2000,
        format: 'epub',
        title: 'Server Book',
        size: 4,
        cachedAt: 1000,
        updatedAt: 1000,
        promptedUpdateRevisionId: null,
        detail: makeDetail({ revisionId: 'rev-1' }),
        chapters: [],
        progress: null,
        notes: [],
        replacements: [],
      },
      new Blob(['epub']),
    )

    apiGetMock.mockResolvedValue({ data: makeDetail({ revisionId: 'rev-2' }) })
    const session = remoteReaderSession('book-1', false)
    const first = await session.getBook()
    expect(first.data.revisionId).toBe('rev-2')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    await session.getBook()
    expect(useToastStore.getState().toasts).toHaveLength(1)

    apiGetMock.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', undefined, 0))
    const offline = await session.getBook()
    expect(offline.data.revisionId).toBe('rev-1')
  })

  it('rewrites pending note IDs atomically across flush restarts and does not mask 5xx errors as offline', async () => {
    expect(isOfflineOrNetworkError(new ApiError('INTERNAL_ERROR', 'Bad gateway', undefined, 502))).toBe(false)
    expect(isOfflineOrNetworkError(new ApiError('NETWORK_ERROR', 'offline', undefined, 0))).toBe(true)

    const scope = remoteCacheScopeKey('u1')
    await repository.enqueueNoteOp(scope, 'book-1', {
      opId: 'op-create',
      type: 'create',
      tempId: 'tmp-1',
      body: { type: 'idea', text: 'Excerpt', note: 'V1', cfi: 'epubcfi(/6/2)', chapter: 'Ch 1' },
      optimistic: {
        id: 'tmp-1',
        bookId: 'book-1',
        revisionId: null,
        cfiRange: 'epubcfi(/6/2)',
        cfiAnchor: null,
        type: 'idea',
        color: 'yellow',
        style: 'underline',
        text: 'Excerpt',
        contextText: null,
        note: 'V1',
        chapter: 'Ch 1',
        chapterHref: null,
        createdAt: 100,
        updatedAt: 100,
      },
      createdAt: 100,
    })
    await repository.replacePendingNoteOps(scope, 'book-1', [
      ...(await repository.getPendingNoteOps(scope, 'book-1')),
      { opId: 'op-update', type: 'update', noteId: 'tmp-1', body: { note: 'V2' }, updatedAt: 200 },
    ])

    apiPostMock.mockResolvedValueOnce({
      data: {
        id: 'srv-note-99',
        bookId: 'book-1',
        revisionId: null,
        cfiRange: 'epubcfi(/6/2)',
        cfiAnchor: null,
        type: 'idea',
        color: 'yellow',
        style: 'underline',
        text: 'Excerpt',
        contextText: null,
        note: 'V1',
        chapter: 'Ch 1',
        chapterHref: null,
        createdAt: 100,
        updatedAt: 100,
      },
    })
    apiPutMock.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'offline', undefined, 0))

    await flushRemoteOfflineOutbox('u1', 'book-1', repository)
    const remaining = await repository.getPendingNoteOps(scope, 'book-1')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toMatchObject({ type: 'update', noteId: 'srv-note-99', body: { note: 'V2' } })

    apiPutMock.mockResolvedValueOnce({
      data: {
        id: 'srv-note-99',
        bookId: 'book-1',
        revisionId: null,
        cfiRange: 'epubcfi(/6/2)',
        cfiAnchor: null,
        type: 'idea',
        color: 'yellow',
        style: 'underline',
        text: 'Excerpt',
        contextText: null,
        note: 'V2',
        chapter: 'Ch 1',
        chapterHref: null,
        createdAt: 100,
        updatedAt: 200,
      },
    })
    await flushRemoteOfflineOutbox('u1', 'book-1', repository)
    expect(apiPutMock).toHaveBeenLastCalledWith('/annotations/srv-note-99', { note: 'V2' })
    expect(await repository.getPendingNoteOps(scope, 'book-1')).toEqual([])
  })
})
