import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiClient from '@/api/client'
import { notify } from '@/lib/notifications'

import { useDeleteBook, usePermanentDeleteBook, useRestoreBook } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiDelete: vi.fn(), apiPost: vi.fn() }
})

vi.mock('@/lib/notifications', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
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
    vi.mocked(notify.success).mockReset()
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
})
