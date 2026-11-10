import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import * as apiClient from '@/api/client'
import { notify } from '@/lib/notifications'
import { useMoveBooksToCategory } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiPatch: vi.fn() }
})

vi.mock('@/lib/notifications', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useMoveBooksToCategory', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.mocked(apiClient.apiPatch).mockResolvedValue({ data: { count: 2 }, undo: { token: 'undo-1', expiresAt: 99999 } } as never)
    vi.mocked(notify.success).mockClear()
  })

  it('sends one batch organize request for private books', async () => {
    const { result } = renderHook(() => useMoveBooksToCategory(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ books: [{ id: 'b1' }, { id: 'b2' }], categoryId: 'cat-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.apiPatch).toHaveBeenCalledExactlyOnceWith('/books/batch/organize', { ids: ['b1', 'b2'], categoryId: 'cat-1' })
    expect(notify.success).toHaveBeenCalledWith(
      { key: 'library.batchClassifySucceeded', params: { count: 2 } },
      { undo: { token: 'undo-1', expiresAt: 99999 } },
    )
  })

  it('sends batch organize request to shared library when libraryId is provided', async () => {
    const { result } = renderHook(() => useMoveBooksToCategory(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ libraryId: 'lib-1', books: [{ id: 'b1' }], categoryId: 'cat-2' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.apiPatch).toHaveBeenCalledWith('/libraries/lib-1/books/batch/organize', { ids: ['b1'], categoryId: 'cat-2' })
  })

  it('invalidates relevant queries on success', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useMoveBooksToCategory(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ books: [{ id: 'b1' }], categoryId: null })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['batch-selection'] })
  })
})
