import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { apiGet } from '@/api/client'
import { useFonts } from '@/api/hooks/useFonts'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), apiGet: vi.fn() }))
let client: QueryClient
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); vi.mocked(apiGet).mockReset(); useAuthStore.getState().clearAuth() })
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().clearAuth() })
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }

it('rejects a late private font reply after changing the connected account', async () => {
  let resolveFirst!: (value: unknown) => void
  const first = new Promise((resolve) => { resolveFirst = resolve })
  vi.mocked(apiGet).mockImplementationOnce(() => first as never).mockResolvedValueOnce({ data: [{ id: 'second-font', name: 'Second private font' }] })
  useAuthStore.getState().setAuth({ id: 'first', username: 'First', role: 'member' })
  const query = renderHook(() => useFonts(), { wrapper })
  await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1))
  act(() => useAuthStore.getState().setAuth({ id: 'second', username: 'Second', role: 'member' }))
  await waitFor(() => expect(query.result.current.data?.data[0]?.id).toBe('second-font'))
  await act(async () => { resolveFirst({ data: [{ id: 'first-font', name: 'First private font' }] }); await first })
  expect(query.result.current.data?.data[0]?.id).toBe('second-font')
  expect(client.getQueryCache().getAll().some((entry) => JSON.stringify(entry.state.data ?? null).includes('first-font'))).toBe(false)
})

it('does not inherit private font metadata when anonymous local resource loading is disabled', async () => {
  vi.mocked(apiGet).mockResolvedValueOnce({ data: [{ id: 'private-font', name: 'Private font' }] })
  useAuthStore.getState().setAuth({ id: 'first', username: 'First', role: 'member' })
  const query = renderHook(() => {
    const account = useAuthStore((state) => state.user)
    return useFonts(Boolean(account))
  }, { wrapper })
  await waitFor(() => expect(query.result.current.isSuccess).toBe(true))
  act(() => useAuthStore.getState().clearAuth())
  expect(query.result.current.data).toBeUndefined()
  expect(apiGet).toHaveBeenCalledTimes(1)
})
