import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiPost } from '@/api/client'
import { notify } from '@/lib/notifications'
import {
  usePauseStorageMigration,
  usePauseStorageRestore,
  useStartStorageMigration,
  useStartStorageRestore,
} from '@/api/hooks/useStorageBackend'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, apiPost: vi.fn() }
})

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('Storage backend migration and restore mutation error feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports error toast when starting storage migration fails', async () => {
    const { wrapper } = setup()
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('Migration start failed'))
    const { result } = renderHook(() => useStartStorageMigration(), { wrapper })

    await act(async () => {
      result.current.mutate()
    })

    expect(notify.error).toHaveBeenCalled()
  })

  it('reports error toast when pausing storage migration fails', async () => {
    const { wrapper } = setup()
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('Migration pause failed'))
    const { result } = renderHook(() => usePauseStorageMigration(), { wrapper })

    await act(async () => {
      result.current.mutate()
    })

    expect(notify.error).toHaveBeenCalled()
  })

  it('reports error toast when starting storage restore fails', async () => {
    const { wrapper } = setup()
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('Restore start failed'))
    const { result } = renderHook(() => useStartStorageRestore(), { wrapper })

    await act(async () => {
      result.current.mutate()
    })

    expect(notify.error).toHaveBeenCalled()
  })

  it('reports error toast when pausing storage restore fails', async () => {
    const { wrapper } = setup()
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('Restore pause failed'))
    const { result } = renderHook(() => usePauseStorageRestore(), { wrapper })

    await act(async () => {
      result.current.mutate()
    })

    expect(notify.error).toHaveBeenCalled()
  })
})
