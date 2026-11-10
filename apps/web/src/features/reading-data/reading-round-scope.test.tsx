import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useReadingRound } from '@/api/hooks/reading-records'
import { useAuthStore } from '@/stores/auth.store'

import { LocalReaderContext, type LocalReaderSession } from './reader-source-context'

let client: QueryClient
beforeEach(() => {
  onlineManager.setOnline(true)
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  useAuthStore.getState().setAuth({ id: 'reader', username: 'reader', role: 'member' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: null }))))
})
afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); useAuthStore.getState().clearAuth(); vi.unstubAllGlobals() })
const changeReadingRound = vi.fn().mockResolvedValue({})
const local = { namespace: 'local:vault:same-id', bookId: 'same-id', ref: { scope: { kind: 'local', vaultId: 'vault' }, bookId: 'same-id' }, changeReadingRound } as LocalReaderSession

describe('reading round command source safety', () => {
  it('dispatches local rounds offline without sending a same-ID Server command', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><LocalReaderContext.Provider value={local}>{children}</LocalReaderContext.Provider></QueryClientProvider>
    const { result } = renderHook(() => useReadingRound('same-id'), { wrapper })
    onlineManager.setOnline(false)
    changeReadingRound.mockClear()
    await act(async () => { await result.current.mutateAsync('finish') })
    expect(changeReadingRound).toHaveBeenCalledWith('finish')
    expect(result.current.isPaused).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves the remote round payload and prevents a paused command from adopting a new account', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useReadingRound('same-id'), { wrapper })
    await act(async () => { await result.current.mutateAsync('continue') })
    expect(fetch).toHaveBeenCalledWith('/api/v1/reading-records/book/same-id/round', expect.objectContaining({ method: 'POST', body: '{"action":"continue"}' }))
    vi.mocked(fetch).mockClear()
    onlineManager.setOnline(false)
    let pending!: Promise<unknown>
    act(() => { pending = result.current.mutateAsync('finish') })
    const rejected = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    await waitFor(() => expect(result.current.isPaused).toBe(true))
    act(() => useAuthStore.getState().setAuth({ id: 'next', username: 'next', role: 'member' }))
    await act(async () => { onlineManager.setOnline(true); await client.resumePausedMutations() })
    await rejected
    expect(fetch).not.toHaveBeenCalled()
  })
})
