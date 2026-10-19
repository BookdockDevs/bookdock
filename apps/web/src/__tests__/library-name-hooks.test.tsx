import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiClient from '@/api/client'
import { useLibraries } from '@/features/library/hooks'
import { readLibraryNames } from '@/lib/library-name-cache'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiGet: vi.fn() }
})

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('library navigation name query persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    useAuthStore.setState({ user: null })
  })

  afterEach(() => {
    useAuthStore.getState().clearAuth()
    localStorage.clear()
  })

  it('persists only names after a successful authoritative API response and forwards the query signal', async () => {
    useAuthStore.getState().setAuth({ id: 'user-1', username: 'reader', role: 'member' })
    vi.mocked(apiClient.apiGet).mockResolvedValue({ data: [{
      id: 'library-1', type: 'shared', name: 'Shared', relation: 'owner', allowMemberUpload: true,
    }] } as never)
    const client = createClient()
    const { result } = renderHook(() => useLibraries(), { wrapper: wrapper(client) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiClient.apiGet).toHaveBeenCalledWith('/libraries', expect.any(AbortSignal))
    expect(readLibraryNames('user-1')).toEqual([{ id: 'library-1', type: 'shared', name: 'Shared' }])
    expect(client.getQueryData(['libraries'])).toEqual({ data: [{
      id: 'library-1', type: 'shared', name: 'Shared', relation: 'owner', allowMemberUpload: true,
    }] })
  })

  it('ignores an old response after logout and same-account login', async () => {
    useAuthStore.getState().setAuth({ id: 'user-1', username: 'reader', role: 'member' })
    let resolveRequest: (value: unknown) => void = () => {}
    vi.mocked(apiClient.apiGet).mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }) as never)
    const client = createClient()
    const { result } = renderHook(() => useLibraries(), { wrapper: wrapper(client) })
    await waitFor(() => expect(apiClient.apiGet).toHaveBeenCalledOnce())

    useAuthStore.getState().clearAuth()
    useAuthStore.getState().setAuth({ id: 'user-1', username: 'reader', role: 'member' })
    resolveRequest({ data: [{ id: 'stale', type: 'shared', name: 'Old session' }] })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(readLibraryNames('user-1')).toEqual([])
  })

  it('does not persist a response after the query signal is aborted', async () => {
    useAuthStore.getState().setAuth({ id: 'user-1', username: 'reader', role: 'member' })
    let resolveRequest: (value: unknown) => void = () => {}
    vi.mocked(apiClient.apiGet).mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }) as never)
    const client = createClient()
    const { result } = renderHook(() => useLibraries(), { wrapper: wrapper(client) })
    await waitFor(() => expect(apiClient.apiGet).toHaveBeenCalledOnce())

    await client.cancelQueries({ queryKey: ['libraries'] })
    resolveRequest({ data: [{ id: 'cancelled', type: 'shared', name: 'Cancelled response' }] })
    await waitFor(() => expect(result.current.isFetching).toBe(false))

    expect(readLibraryNames('user-1')).toEqual([])
  })

  it.each([
    ['role change', () => useAuthStore.getState().updateUser({ role: 'admin' })],
    ['account switch', () => useAuthStore.getState().setAuth({ id: 'user-2', username: 'other', role: 'member' })],
  ])('ignores an old response after %s', async (_name, changeSession) => {
    useAuthStore.getState().setAuth({ id: 'user-1', username: 'reader', role: 'member' })
    let resolveRequest: (value: unknown) => void = () => {}
    vi.mocked(apiClient.apiGet).mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }) as never)
    const client = createClient()
    const { result } = renderHook(() => useLibraries(), { wrapper: wrapper(client) })
    await waitFor(() => expect(apiClient.apiGet).toHaveBeenCalledOnce())

    changeSession()
    resolveRequest({ data: [{ id: 'stale', type: 'shared', name: 'Old session' }] })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(readLibraryNames('user-1')).toEqual([])
    expect(readLibraryNames('user-2')).toEqual([])
  })
})
