import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DictionaryList } from '@bookdock/shared'

import { dictionaryListKey, useDictionaries, useDictionaryLookup, useDictionaryMutation } from '@/api/hooks/useDictionaries'
import { useAuthStore } from '@/stores/auth.store'

const account = (id: string) => ({ id, username: id, role: 'member' })
const dictionaryList = (owner: string): DictionaryList => ({ items: [{ id: 'same-dictionary', name: `${owner} dictionary`, enabled: true, size: 10, fileNames: ['fixture.mdx'], createdAt: 1 }], lastUsedId: null })
let client: QueryClient
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider> }
beforeEach(() => {
  localStorage.clear()
  onlineManager.setOnline(true)
  useAuthStore.getState().setAuth(account('first'))
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: dictionaryList(useAuthStore.getState().user!.id) }), { headers: { 'Content-Type': 'application/json' } })))
})
afterEach(() => { cleanup(); client.clear(); onlineManager.setOnline(true); useAuthStore.getState().clearAuth(); vi.unstubAllGlobals(); localStorage.clear() })

describe('dictionary connected-account scope', () => {
  it('refuses anonymous reads even when explicitly refetched with a previous dictionary id', async () => {
    useAuthStore.getState().clearAuth()
    const { result } = renderHook(() => ({ list: useDictionaries(), lookup: useDictionaryLookup('same-dictionary', 'hello') }), { wrapper })
    await act(async () => { await result.current.list.refetch(); await result.current.lookup.refetch() })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not cache an old lookup or update either account selection after the actor changes', async () => {
    let settle!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes('/lookup?')) return await new Promise<Response>((resolve) => { settle = resolve })
      return new Response(JSON.stringify({ data: dictionaryList(useAuthStore.getState().user!.id) }), { headers: { 'Content-Type': 'application/json' } })
    })
    const { result } = renderHook(() => {
      const owner = useAuthStore((state) => state.user?.id)
      return { list: useDictionaries(), lookup: useDictionaryLookup(owner === 'first' ? 'same-dictionary' : null, 'hello') }
    }, { wrapper })
    await waitFor(() => expect(result.current.list.isSuccess && settle).toBeTruthy())
    act(() => useAuthStore.getState().setAuth(account('next')))
    await waitFor(() => expect(result.current.list.data?.data.items[0]?.name).toBe('next dictionary'))
    await act(async () => { settle(new Response(JSON.stringify({ data: { query: 'hello', headword: 'hello', html: 'Old private definition' } }), { headers: { 'Content-Type': 'application/json' } })) })
    expect(client.getQueryData<{ data: DictionaryList }>(dictionaryListKey('next'))?.data.lastUsedId).toBeNull()
    expect(client.getQueryData<{ data: DictionaryList }>(dictionaryListKey('first'))?.data.lastUsedId).toBeNull()
    expect(client.getQueriesData({ queryKey: dictionaryListKey('next') }).some(([, value]) => JSON.stringify(value)?.includes('Old private definition'))).toBe(false)
  })

  it('rejects an offline queued mutation after account switching instead of sending it under the next cookie', async () => {
    client.setQueryData(dictionaryListKey('first'), { data: dictionaryList('first') })
    client.setQueryData(dictionaryListKey('next'), { data: dictionaryList('next') })
    const { result } = renderHook(() => useDictionaryMutation(), { wrapper })
    onlineManager.setOnline(false)
    let pending!: Promise<unknown>
    act(() => { pending = result.current.mutateAsync({ kind: 'order', ids: ['same-dictionary'] }) })
    const rejection = expect(pending).rejects.toHaveProperty('name', 'AbortError')
    await waitFor(() => expect(result.current.isPaused).toBe(true))
    act(() => useAuthStore.getState().setAuth(account('next')))
    await act(async () => { onlineManager.setOnline(true); await client.resumePausedMutations() })
    await rejection
    expect(fetch).not.toHaveBeenCalled()
    expect(client.getQueryData(dictionaryListKey('next'))).toEqual({ data: dictionaryList('next') })
    expect(client.getQueryState(dictionaryListKey('next'))?.isInvalidated).toBe(false)
  })

  it('keeps the new account signed in when an unabortable old lookup expires', async () => {
    let settle!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).includes('/lookup?')) return await new Promise<Response>((resolve) => { settle = resolve })
      return new Response(JSON.stringify({ data: dictionaryList(useAuthStore.getState().user!.id) }))
    })
    const { result } = renderHook(() => {
      const owner = useAuthStore((state) => state.user?.id)
      return { list: useDictionaries(), lookup: useDictionaryLookup(owner === 'first' ? 'same-dictionary' : null, 'hello') }
    }, { wrapper })
    await waitFor(() => expect(settle).toBeTypeOf('function'))
    act(() => useAuthStore.getState().setAuth(account('next')))
    await waitFor(() => expect(result.current.list.data?.data.items[0]?.name).toBe('next dictionary'))
    await act(async () => { settle(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'expired' } }), { status: 401 })) })
    expect(useAuthStore.getState().user?.id).toBe('next')
    expect(result.current.list.data?.data.items[0]?.name).toBe('next dictionary')
  })
})
