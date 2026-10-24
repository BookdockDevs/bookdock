import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiClient from '@/api/client'
import { notify } from '@/lib/notifications'

import { useDeleteBook, useEmptyLibraryTrash, useEmptyTrash, useMoveBooksToShelf, usePermanentDeleteBook, useRestoreBook } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiDelete: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }
})

vi.mock('@/lib/notifications', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('book action notifications', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.mocked(apiClient.apiDelete).mockResolvedValue({ data: null } as never)
    vi.mocked(apiClient.apiPost).mockResolvedValue({ data: null } as never)
    vi.mocked(apiClient.apiPatch).mockResolvedValue({ data: { succeeded: 2, failed: 0, failedIds: [] } } as never)
    vi.mocked(notify.success).mockReset()
    vi.mocked(notify.error).mockReset()
    vi.mocked(notify.warning).mockReset()
    vi.mocked(notify.info).mockReset()
  })

  it('includes the title when moving a book to trash', async () => {
    const { result } = renderHook(() => useDeleteBook(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ id: 'book-1', title: '百年孤独' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(notify.success).toHaveBeenCalledWith({
      key: 'library.bookMovedToTrash',
      params: { title: '百年孤独' },
    })
  })

  it('reports partial shelf move counts from the single batch response', async () => {
    vi.mocked(apiClient.apiPatch).mockResolvedValue({ data: { succeeded: 1, failed: 1, failedIds: ['b'] } } as never)
    const { result } = renderHook(() => useMoveBooksToShelf(), { wrapper: wrapper(queryClient) })
    result.current.mutate({ bookIds: ['a', 'b'], shelfId: 'shelf-1' })
    await waitFor(() => expect(notify.warning).toHaveBeenCalledWith({ key: 'library.moveBooksPartial', params: { succeeded: 1, failed: 1 } }))
    expect(notify.error).not.toHaveBeenCalled()
  })

  it('uses one batch shelf request for a multi-book move', async () => {
    const { result } = renderHook(() => useMoveBooksToShelf(), { wrapper: wrapper(queryClient) })
    result.current.mutate({ bookIds: ['a', 'b'], shelfId: 'shelf-1' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.apiPatch).toHaveBeenCalledWith('/books/batch/move-shelf', { ids: ['a', 'b'], shelfId: 'shelf-1' })
    expect(notify.warning).not.toHaveBeenCalled()
  })

  it('includes the title when restoring a book', async () => {
    const { result } = renderHook(() => useRestoreBook(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ id: 'book-1', title: '百年孤独' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(notify.success).toHaveBeenCalledWith({
      key: 'library.bookRestored',
      params: { title: '百年孤独' },
    })
  })

  it('includes the title when permanently deleting a book', async () => {
    const { result } = renderHook(() => usePermanentDeleteBook(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ id: 'book-1', title: '百年孤独' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(notify.success).toHaveBeenCalledWith({
      key: 'library.bookPermanentlyDeleted',
      params: { title: '百年孤独' },
    })
  })

  it.each([false, true])('reports no change when trash is already empty (shared: %s)', async (shared) => {
    vi.mocked(apiClient.apiDelete).mockResolvedValue({ data: { count: 0 } } as never)
    const { result } = renderHook(() => ({ privateTrash: useEmptyTrash(), sharedTrash: useEmptyLibraryTrash() }), { wrapper: wrapper(queryClient) })
    if (shared) result.current.sharedTrash.mutate({ libraryId: 'library-1' })
    else result.current.privateTrash.mutate()
    await waitFor(() => expect(notify.info).toHaveBeenCalledWith({ key: 'library.trashAlreadyEmpty' }))
    expect(notify.success).not.toHaveBeenCalled()
  })

  it('uses the server count for a completed trash cleanup', async () => {
    vi.mocked(apiClient.apiDelete).mockResolvedValue({ data: { count: 3 } } as never)
    const { result } = renderHook(() => useEmptyTrash(), { wrapper: wrapper(queryClient) })
    result.current.mutate()
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith({ key: 'library.trashEmptied', params: { count: 3 } }))
    expect(notify.info).not.toHaveBeenCalled()
  })
})
