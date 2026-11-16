import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useAuthStore } from '@/stores/auth.store'
import * as apiClient from '@/api/client'
import { useReorderLibraryTags } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiGet: vi.fn(), apiPut: vi.fn() }
})

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useReorderLibraryTags', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.mocked(apiClient.apiPut).mockResolvedValue({ data: null } as never)
  })

  it('sends the updated order to the server and invalidates tags query', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useReorderLibraryTags(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ libraryId: null, names: ['c', 'a', 'b'] })

    await waitFor(() => expect(apiClient.apiPut).toHaveBeenCalledWith('/tags/order', { names: ['c', 'a', 'b'] }))
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tags'] }))
  })

  it('notifies on error when the PUT fails', async () => {
    vi.mocked(apiClient.apiPut).mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useReorderLibraryTags(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ libraryId: null, names: ['c', 'a', 'b'] })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
