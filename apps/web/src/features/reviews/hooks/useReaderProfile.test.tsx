import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReaderProfile } from '@bookdock/shared'

import { useAuthStore } from '@/stores/auth.store'

import { useReaderProfile } from './useReviews'

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }))

vi.mock('@/api/client', () => ({
  apiDelete: vi.fn(),
  apiGet: mocks.apiGet,
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}))

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useReaderProfile query lifecycle', () => {
  afterEach(() => {
    vi.resetAllMocks()
    useAuthStore.setState({ user: null })
  })

  it('settles a pending profile query and renders a bounded number of times', async () => {
    let resolveProfile: ((value: { data: ReaderProfile }) => void) | undefined
    mocks.apiGet.mockImplementation(() => new Promise((resolve) => { resolveProfile = resolve }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let renderCount = 0
    const { result, unmount } = renderHook(() => {
      renderCount += 1
      return useReaderProfile('reader-1')
    }, { wrapper: wrapper(queryClient) })

    expect(result.current.isPending).toBe(true)
    expect(mocks.apiGet).toHaveBeenCalledOnce()

    const profile: { data: ReaderProfile } = {
      data: {
        author: { id: 'reader-1', name: 'Reader', avatarKey: null },
        reviews: { entries: [], page: 1, hasMore: false },
      },
    }
    await act(async () => {
      resolveProfile?.(profile)
    })

    await waitFor(() => expect(result.current.data).toEqual(profile))
    expect(result.current.isSuccess).toBe(true)
    expect(renderCount).toBeLessThanOrEqual(4)

    unmount()
    queryClient.clear()
  })

  it('keys viewer-specific profile projections separately and forwards query cancellation', async () => {
    const response = {
      data: {
        author: { id: 'reader-1', name: 'Reader', avatarKey: null },
        reviews: { entries: [], page: 1, hasMore: false },
      },
    }
    mocks.apiGet.mockResolvedValue(response)
    useAuthStore.setState({ user: { id: 'viewer-1', username: 'Viewer 1', role: 'member' } })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result, unmount } = renderHook(() => useReaderProfile('reader-1'), { wrapper: wrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.apiGet).toHaveBeenCalledOnce()
    expect(mocks.apiGet).toHaveBeenCalledWith(expect.stringMatching(/\/reviews\/author\/reader-1\?.*profile=1/), expect.any(AbortSignal))

    act(() => useAuthStore.setState({ user: { id: 'viewer-2', username: 'Viewer 2', role: 'member' } }))
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2))
    expect(queryClient.getQueryCache().findAll({ queryKey: ['reviews', 'author', 'reader-1'] })).toHaveLength(2)

    unmount()
    queryClient.clear()
  })
})
