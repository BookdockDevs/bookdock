import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiClient from '@/api/client'
import {
  useDeleteBook,
  useEmptyTrash,
  usePermanentDeleteBook,
  useRestoreBook,
  useUpdateBook,
  useUploadBooks,
} from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiDelete: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn() }
})

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

/** A query only refetches when something invalidated it, so seeding the cache
 *  and then inspecting the flag is what tells the two apart. */
function seed(queryClient: QueryClient) {
  queryClient.setQueryData(['books'], { data: [] })
  queryClient.setQueryData(['shelves'], { data: [] })
  queryClient.setQueryData(['tags'], { data: [] })
  queryClient.setQueryData(['libraries'], { data: [] })
  queryClient.setQueryData(['libraries', 'lib-1', 'catalog'], { data: { items: [], total: 0 } })
  queryClient.setQueryData(['libraries', 'lib-1', 'categories'], { data: [] })
  queryClient.setQueryData(['libraries', 'lib-1', 'tags'], { data: [] })
}

function invalidated(queryClient: QueryClient, key: unknown[]) {
  return queryClient.getQueryState(key as never)?.isInvalidated === true
}

/**
 * Both taxonomy endpoints count with `isNull(deletedAt)`, so a book leaving the
 * grid leaves those numbers too. Queries run `staleTime: Infinity` with
 * window-focus refetch off, so a mutation that forgets a key leaves the sidebar
 * showing the old count until a full reload - which is exactly the bug this file
 * exists to catch.
 */
describe('book changes refresh the taxonomy counts beside them', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
    })
    vi.mocked(apiClient.apiPatch).mockResolvedValue({ data: null } as never)
    vi.mocked(apiClient.apiPost).mockResolvedValue({ data: null } as never)
    vi.mocked(apiClient.apiDelete).mockResolvedValue({ data: null } as never)
    seed(queryClient)
    // Emptying the trash reads its count out of the body, so this one override
    // has to come after the shared null stub.
    vi.mocked(apiClient.apiDelete).mockResolvedValue({ data: { count: 0 } } as never)
  })

  const privateMutations = [
    {
      name: 'deleting a book (trash on)',
      run: () => {
        const { result } = renderHook(() => useDeleteBook(), { wrapper: wrapper(queryClient) })
        result.current.mutate({ id: 'b1', title: 'Book' })
        return result
      },
    },
    {
      name: 'removing a collected book from the library',
      run: () => {
        const { result } = renderHook(() => useDeleteBook(), { wrapper: wrapper(queryClient) })
        result.current.mutate({ id: 'b1', title: 'Book', isCollected: true })
        return result
      },
    },
    {
      name: 'restoring a book from the trash',
      run: () => {
        const { result } = renderHook(() => useRestoreBook(), { wrapper: wrapper(queryClient) })
        result.current.mutate({ id: 'b1', title: 'Book' })
        return result
      },
    },
    {
      name: 'permanently deleting a book',
      run: () => {
        const { result } = renderHook(() => usePermanentDeleteBook(), { wrapper: wrapper(queryClient) })
        result.current.mutate({ id: 'b1', title: 'Book' })
        return result
      },
    },
    {
      name: 'emptying the trash',
      run: () => {
        const { result } = renderHook(() => useEmptyTrash(), { wrapper: wrapper(queryClient) })
        result.current.mutate()
        return result
      },
    },
  ] as const

  for (const mutation of privateMutations) {
    it(`${mutation.name} refreshes the private shelves and tags`, async () => {
      const result = mutation.run()
      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(invalidated(queryClient, ['books'])).toBe(true)
      expect(invalidated(queryClient, ['shelves'])).toBe(true)
      expect(invalidated(queryClient, ['tags'])).toBe(true)
    })
  }

  it('a settled upload refreshes the private shelves and tags', async () => {
    // The queue refreshes its target lists once nothing is pending, so the
    // assertion is on the state after the settlement effect has run.
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    result.current.addFiles([new File(['x'], 'book.epub')])
    await waitFor(() => expect(result.current.items[0]?.status).toBe('pending'))
    result.current.startUpload()
    await waitFor(() => expect(queryClient.getQueryState(['tags'])?.isInvalidated).toBe(true))

    expect(invalidated(queryClient, ['books'])).toBe(true)
    expect(invalidated(queryClient, ['shelves'])).toBe(true)
  })

  it('a metadata edit does not churn the taxonomy', async () => {
    // The counter-case that rules out a blanket "invalidate everything": editing
    // a title moves no book, so the counts cannot have changed.
    const { result } = renderHook(() => useUpdateBook(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ bookId: 'b1', data: { title: 'New title' } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidated(queryClient, ['books'])).toBe(true)
    expect(invalidated(queryClient, ['shelves'])).toBe(false)
    expect(invalidated(queryClient, ['tags'])).toBe(false)
  })
})
