import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiClient from '@/api/client'
import { notify } from '@/lib/notifications'
import { readStoredSettings } from '@/lib/settings-cache'
import { useUpdateProfileSettings } from '@/features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiPut: vi.fn(), apiGet: vi.fn() }
})

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('profile setting mutation ordering and rollback', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('bd-user', JSON.stringify({ id: 'user-test' }))
    vi.mocked(apiClient.apiPut).mockReset()
    vi.mocked(apiClient.apiGet).mockReset()
    vi.mocked(notify.error).mockReset()
  })

  it('(a) first patch fails, second patch succeeds: final cache & storage equal server merged result', async () => {
    // Simulated server state starts with all true
    let serverProfile = { showStats: true, showShowcase: true, isPublic: true }

    const first = deferred<{ data: { profile: typeof serverProfile } }>()
    const second = deferred<{ data: { profile: typeof serverProfile } }>()

    vi.mocked(apiClient.apiPut).mockImplementation(async (_path, body) => {
      const patch = (body as { profile: Partial<typeof serverProfile> })?.profile
      if (patch && 'showStats' in patch && patch.showStats === false && !('showShowcase' in patch)) {
        return first.promise
      }
      if (patch && 'showShowcase' in patch && patch.showShowcase === false && !('showStats' in patch)) {
        return second.promise
      }
      return { data: { profile: serverProfile } }
    })

    vi.mocked(apiClient.apiGet).mockImplementation(async (path) => {
      if (path === '/settings') {
        return { data: { profile: serverProfile } }
      }
      return { data: {} }
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => apiClient.apiGet<{ data: { profile: typeof serverProfile } }>('/settings'),
        },
        mutations: { retry: false },
      },
    })
    queryClient.setQueryData(['settings'], {
      data: { profile: { ...serverProfile } },
    })

    const { result } = renderHook(() => useUpdateProfileSettings(), { wrapper: wrapper(queryClient) })

    // Fire two rapid patches
    result.current.mutate({ showStats: false })
    result.current.mutate({ showShowcase: false })

    await waitFor(() => expect(apiClient.apiPut).toHaveBeenCalledTimes(1))
    // Optimistic cache shows both updated
    expect(queryClient.getQueryData<{ data: { profile: typeof serverProfile } }>(['settings'])?.data.profile)
      .toMatchObject({ showStats: false, showShowcase: false })

    // First write fails on server (e.g. 500); server profile unchanged
    first.reject(new Error('first write failed'))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    await waitFor(() => expect(apiClient.apiPut).toHaveBeenCalledTimes(2))

    // Second write succeeds on server; server merges showShowcase: false
    serverProfile = { ...serverProfile, showShowcase: false }
    second.resolve({ data: { profile: serverProfile } })

    // After all writes settle, refetchQueries fires and aligns cache & storage with server
    await waitFor(() => {
      expect(queryClient.getQueryData<{ data: { profile: typeof serverProfile } }>(['settings'])?.data.profile)
        .toEqual({ showStats: true, showShowcase: false, isPublic: true })
    })

    const stored = readStoredSettings('user-test')
    expect(stored?.profile).toEqual({ showStats: true, showShowcase: false, isPublic: true })
  })

  it('(b) both patches fail: fields roll back to original values without corrupted optimistic leaks', async () => {
    const serverProfile = { showStats: true, showShowcase: true, isPublic: true }
    const first = deferred<{ data: unknown }>()
    const second = deferred<{ data: unknown }>()

    vi.mocked(apiClient.apiPut)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    vi.mocked(apiClient.apiGet).mockImplementation(async (path) => {
      if (path === '/settings') {
        return { data: { profile: serverProfile } }
      }
      return { data: {} }
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => apiClient.apiGet<{ data: { profile: typeof serverProfile } }>('/settings'),
        },
        mutations: { retry: false },
      },
    })
    queryClient.setQueryData(['settings'], {
      data: { profile: { ...serverProfile } },
    })

    const { result } = renderHook(() => useUpdateProfileSettings(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ showStats: false })
    result.current.mutate({ showShowcase: false })

    await waitFor(() => expect(apiClient.apiPut).toHaveBeenCalledTimes(1))

    first.reject(new Error('first write failed'))
    await waitFor(() => expect(apiClient.apiPut).toHaveBeenCalledTimes(2))

    second.reject(new Error('second write failed'))
    await waitFor(() => expect(notify.error).toHaveBeenCalledTimes(2))

    await waitFor(() => {
      expect(queryClient.getQueryData<{ data: { profile: typeof serverProfile } }>(['settings'])?.data.profile)
        .toEqual({ showStats: true, showShowcase: true, isPublic: true })
    })

    const stored = readStoredSettings('user-test')
    expect(stored?.profile).toEqual({ showStats: true, showShowcase: true, isPublic: true })
  })

  it('(c) converges and aligns localStorage even without active query observers', async () => {
    let serverProfile = { showStats: true, showShowcase: true, isPublic: true }

    vi.mocked(apiClient.apiPut).mockImplementation(async (_path, body) => {
      const patch = (body as { profile: Partial<typeof serverProfile> })?.profile
      serverProfile = { ...serverProfile, ...patch }
      return { data: { profile: serverProfile } }
    })

    vi.mocked(apiClient.apiGet).mockImplementation(async (path) => {
      if (path === '/settings') {
        return { data: { profile: serverProfile } }
      }
      return { data: {} }
    })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => apiClient.apiGet<{ data: { profile: typeof serverProfile } }>('/settings'),
        },
        mutations: { retry: false },
      },
    })
    // Pre-populate cache without mounting any useQuery hook (0 active observers)
    queryClient.setQueryData(['settings'], {
      data: { profile: { ...serverProfile } },
    })

    // Confirm 0 active query observers
    expect(queryClient.getQueryCache().find({ queryKey: ['settings'] })?.getObserversCount()).toBe(0)

    const { result } = renderHook(() => useUpdateProfileSettings(), { wrapper: wrapper(queryClient) })
    result.current.mutate({ showStats: false })

    await waitFor(() => {
      expect(queryClient.getQueryData<{ data: { profile: typeof serverProfile } }>(['settings'])?.data.profile?.showStats).toBe(false)
    })

    // Settlement fires refetchQueries, which triggers queryFn even with 0 observers
    await waitFor(() => expect(apiClient.apiGet).toHaveBeenCalledWith('/settings'))

    const stored = readStoredSettings('user-test')
    expect(stored?.profile?.showStats).toBe(false)
  })
})
