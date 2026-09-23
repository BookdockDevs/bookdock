import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { TagListItem } from '@bookdock/shared'

import * as apiClient from '@/api/client'
import { useReorderTags } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiPut: vi.fn() }
})

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function tag(id: string, name: string): TagListItem {
  return { id, userId: 'u1', name, sortOrder: 0, createdAt: 0, updatedAt: 0, pinned: false, bookCount: 0 }
}

describe('useReorderTags', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(['tags'], {
      data: [tag('a', 'A'), tag('b', 'B'), tag('c', 'C')],
    })
    vi.mocked(apiClient.apiPut).mockResolvedValue({ data: null } as never)
  })

  it('optimistically reorders the tags cache before the PUT lands', async () => {
    const { result } = renderHook(() => useReorderTags(), { wrapper: wrapper(queryClient) })

    result.current.mutate(['c', 'a', 'b'])

    await waitFor(() => expect(apiClient.apiPut).toHaveBeenCalledWith('/tags/order', { tagIds: ['c', 'a', 'b'] }))
    const cached = queryClient.getQueryData<{ data: TagListItem[] }>(['tags'])
    expect(cached?.data.map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('rolls the cache back when the PUT fails', async () => {
    vi.mocked(apiClient.apiPut).mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useReorderTags(), { wrapper: wrapper(queryClient) })

    result.current.mutate(['c', 'a', 'b'])

    await waitFor(() => expect(result.current.isError).toBe(true))
    const cached = queryClient.getQueryData<{ data: TagListItem[] }>(['tags'])
    expect(cached?.data.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })
})
