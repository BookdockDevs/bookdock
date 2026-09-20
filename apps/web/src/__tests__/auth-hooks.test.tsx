import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiGet, apiPost } from '@/api/client'

import { ME_QUERY_KEY, useLogin } from '../features/auth/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() }
})

function SessionProbe() {
  useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiGet<{ data: { id: string; username: string; role: string; avatarKey: string | null } }>('/auth/me'),
    retry: false,
  })
  return null
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProbe />
        {children}
      </QueryClientProvider>
    )
  }
}

describe('useLogin', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    vi.mocked(apiGet).mockReset()
    vi.mocked(apiPost).mockReset()
  })

  it('refreshes the session query after a login follows an unauthenticated probe', async () => {
    const me = { id: 'user-1', username: 'admin', role: 'owner', avatarKey: null }
    vi.mocked(apiGet)
      .mockRejectedValueOnce(new ApiError('UNAUTHORIZED', 'Not authenticated'))
      .mockResolvedValueOnce({ data: me })
    vi.mocked(apiPost).mockResolvedValue({
      data: { token: 'token', user: { id: me.id, username: me.username, role: me.role } },
    })

    const { result } = renderHook(() => useLogin(), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(queryClient.getQueryState(ME_QUERY_KEY)?.status).toBe('error'))

    await act(async () => {
      await result.current.mutateAsync({ username: me.username, password: 'password' })
    })

    await waitFor(() => expect(queryClient.getQueryData(ME_QUERY_KEY)).toEqual({ data: me }))
    expect(apiGet).toHaveBeenCalledTimes(2)
  })
})
