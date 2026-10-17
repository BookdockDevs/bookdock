import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { ShelfListItem } from '@bookdock/shared'

import * as apiClient from '@/api/client'
import { useReorderShelves } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiGet: vi.fn(), apiPut: vi.fn() }
})

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function shelf(id: string, name: string): ShelfListItem {
  return { id, userId: 'u1', name, sortOrder: 0, createdAt: 0, updatedAt: 0, pinned: false, bookCount: 0 }
}

describe('useReorderShelves', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(['shelves'], {
      data: [shelf('a', 'A'), shelf('b', 'B'), shelf('c', 'C')],
    })
    vi.mocked(apiClient.apiGet).mockResolvedValue({ data: [shelf('a', 'A'), shelf('b', 'B'), shelf('c', 'C')] })
    vi.mocked(apiClient.apiPut).mockResolvedValue({ data: null } as never)
  })

  it('optimistically reorders the shelves cache before the PUT lands', async () => {
    const { result } = renderHook(() => useReorderShelves(), { wrapper: wrapper(queryClient) })

    result.current.mutate(['c', 'a', 'b'])

    await waitFor(() => expect(apiClient.apiPut).toHaveBeenCalledWith('/shelves/order', { shelfIds: ['c', 'a', 'b'] }))
    const cached = queryClient.getQueryData<{ data: ShelfListItem[] }>(['shelves'])
    expect(cached?.data.map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('rolls the cache back when the PUT fails', async () => {
    vi.mocked(apiClient.apiPut).mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useReorderShelves(), { wrapper: wrapper(queryClient) })

    result.current.mutate(['c', 'a', 'b'])

    await waitFor(() => expect(result.current.isError).toBe(true))
    const cached = queryClient.getQueryData<{ data: ShelfListItem[] }>(['shelves'])
    expect(cached?.data.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('preserves hidden shelves in optimistic cache and invalidates query on settle', async () => {
    const hiddenShelf = { ...shelf('hidden', 'Hidden'), hidden: true }
    queryClient.setQueryData(['shelves'], {
      data: [shelf('a', 'A'), hiddenShelf, shelf('b', 'B')],
    })
    vi.mocked(apiClient.apiGet).mockResolvedValue({ data: [shelf('a', 'A'), hiddenShelf, shelf('b', 'B')] })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useReorderShelves(), { wrapper: wrapper(queryClient) })

    // User only reorders visible shelves ('b', 'a')
    result.current.mutate(['b', 'a'])

    // Hidden shelf remains at its position in optimistic update
    const cached = queryClient.getQueryData<{ data: ShelfListItem[] }>(['shelves'])
    expect(cached?.data.map((s) => s.id)).toEqual(['b', 'hidden', 'a'])

    await waitFor(() => expect(apiClient.apiPut).toHaveBeenCalledWith('/shelves/order', { shelfIds: ['b', 'hidden', 'a'] }))
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['shelves'] }))
  })
})
