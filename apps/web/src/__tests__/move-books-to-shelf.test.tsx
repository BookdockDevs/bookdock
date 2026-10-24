import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import * as apiClient from '@/api/client'
import { useMoveBooksToShelf } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiPatch: vi.fn() }
})

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useMoveBooksToShelf', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.mocked(apiClient.apiPatch).mockResolvedValue({ data: { succeeded: 2, failed: 0, failedIds: [] } } as never)
  })

  it('sends one batch organize request for all books', async () => {
    const { result } = renderHook(() => useMoveBooksToShelf(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ bookIds: ['b1', 'b2'], shelfId: 's1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.apiPatch).toHaveBeenCalledExactlyOnceWith('/books/batch/move-shelf', { ids: ['b1', 'b2'], shelfId: 's1' })
  })

  it('sends shelfId null when moving out of a shelf', async () => {
    const { result } = renderHook(() => useMoveBooksToShelf(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ bookIds: ['b1'], shelfId: null })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.apiPatch).toHaveBeenCalledWith('/books/batch/move-shelf', { ids: ['b1'], shelfId: null })
  })

  it('invalidates the batch-selection snapshot so the organize dialog re-reads membership', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useMoveBooksToShelf(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ bookIds: ['b1'], shelfId: 's1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['batch-selection'] })
  })
})
