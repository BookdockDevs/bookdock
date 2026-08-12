import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import * as apiClient from '@/api/client'
import { useMoveBooksToShelf } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiPut: vi.fn() }
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
    vi.mocked(apiClient.apiPut).mockResolvedValue({ data: null } as never)
  })

  it('PUTs each book to the target shelf', async () => {
    const { result } = renderHook(() => useMoveBooksToShelf(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ bookIds: ['b1', 'b2'], shelfId: 's1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.apiPut).toHaveBeenCalledWith('/books/b1/shelves', { shelfId: 's1' })
    expect(apiClient.apiPut).toHaveBeenCalledWith('/books/b2/shelves', { shelfId: 's1' })
  })

  it('PUTs shelfId null when moving out of a shelf', async () => {
    const { result } = renderHook(() => useMoveBooksToShelf(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ bookIds: ['b1'], shelfId: null })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.apiPut).toHaveBeenCalledWith('/books/b1/shelves', { shelfId: null })
  })
})
