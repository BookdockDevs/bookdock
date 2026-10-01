import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiClient from '@/api/client'

import { useAppendBookContent } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiPost: vi.fn() }
})

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useAppendBookContent', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.mocked(apiClient.apiPost).mockResolvedValue({
      data: { id: 'book-1', updatedAt: 2 },
    } as never)
  })

  it('updates and invalidates the reader book cache after appending', async () => {
    queryClient.setQueryData(['book', 'book-1'], { data: { id: 'book-1', updatedAt: 1 } })
    const { result } = renderHook(() => useAppendBookContent(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ target: { bookId: 'book-1' }, text: '新内容' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(queryClient.getQueryData(['book', 'book-1'])).toEqual({ data: { id: 'book-1', updatedAt: 2 } })
    expect(queryClient.getQueryState(['book', 'book-1'])?.isInvalidated).toBe(true)
  })

  it('posts city appends to the version URL and invalidates the catalog', async () => {
    queryClient.setQueryData(['libraries', 'lib1', 'catalog'], { data: [] })
    const { result } = renderHook(() => useAppendBookContent(), { wrapper: wrapper(queryClient) })

    result.current.mutate({
      target: { libraryId: 'lib1', libraryBookId: 'lb1', versionLinkId: 'lbv1' },
      text: '新内容',
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(vi.mocked(apiClient.apiPost)).toHaveBeenCalledWith(
      '/libraries/lib1/books/lb1/versions/lbv1/append',
      expect.anything(),
    )
    expect(queryClient.getQueryState(['libraries', 'lib1', 'catalog'])?.isInvalidated).toBe(true)
  })
})
