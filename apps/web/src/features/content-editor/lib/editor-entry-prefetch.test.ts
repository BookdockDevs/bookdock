import { QueryClient } from '@tanstack/react-query'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientLibraryDetailView } from '@bookdock/shared'

import { remoteEditorTxtSourceKey, warmEditorEntry } from './editor-entry-prefetch'

const mocks = vi.hoisted(() => ({ epoch: 7 }))

vi.mock('@/stores/auth.store', () => ({
  getAuthSessionRevision: () => mocks.epoch,
  useAuthStore: Object.assign(() => null, { getState: () => ({ user: null }) }),
}))

function seedBook(queryClient: QueryClient, book: Partial<ClientLibraryDetailView>) {
  queryClient.setQueryData(['books', 'detail', book.id], {
    data: { id: 'book-1', title: '测试书', updatedAt: 1, ...book },
  })
}

describe('warmEditorEntry', () => {
  let queryClient: QueryClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mocks.epoch = 7
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    fetchMock = vi.fn(async () => new Response('整本正文'))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    queryClient.clear()
  })

  it('loads the txt source for the revision the opening surface already cached', async () => {
    seedBook(queryClient, { id: 'book-1', format: 'txt', revisionId: 'rev-1' })
    warmEditorEntry(queryClient, { bookId: 'book-1' })

    await waitFor(() => expect(queryClient.getQueryData(remoteEditorTxtSourceKey('book-1', 'rev-1', 7))).toBe('整本正文'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/books/book-1/content')
  })

  it('does nothing without a cached detail, so an unopened book is never downloaded', async () => {
    warmEditorEntry(queryClient, { bookId: 'book-1' })
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips prefetching when the cached detail has no revision yet', async () => {
    seedBook(queryClient, { id: 'book-1', format: 'txt', revisionId: null })
    warmEditorEntry(queryClient, { bookId: 'book-1' })
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not download txt content for another format', async () => {
    seedBook(queryClient, { id: 'book-1', format: 'pdf', revisionId: 'rev-1' })
    warmEditorEntry(queryClient, { bookId: 'book-1' })
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
