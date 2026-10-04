import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeLibrarySearch, parseLibrarySearch } from '@bookdock/shared'

import { apiGet } from '@/api/client'

import { booksQueryParts, catalogQueryParts, loadSearchPage, useBooks, useLibraryCatalog, type UseBooksParams } from './hooks'

vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), apiGet: vi.fn() }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'reader' } }) }))

const params: UseBooksParams = { page: 1, pageSize: 24, search: '', sortBy: 'title', sortOrder: 'asc', shelfId: null, tagId: null, format: null, readStatus: null, trash: false }
const source = JSON.stringify(parseLibrarySearch('word format:txt'))
const expression = JSON.stringify(normalizeLibrarySearch(parseLibrarySearch('word format:txt')!))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => { vi.mocked(apiGet).mockReset() })

describe('submitted library search requests', () => {
  it('reuses the validated private page with normalized expression and optional filters', async () => {
    const { client, wrapper } = setup()
    const response = { data: [], total: 0, page: 1, pageSize: 24 }
    vi.mocked(apiGet).mockResolvedValue(response)
    const target = { ...params, expression }
    const request = { ...booksQueryParts(target), path: booksQueryParts({ ...params, expression: source }).path }
    const signal = new AbortController().signal
    expect(await loadSearchPage(client, request, signal)).toBe(true)
    const { result, unmount } = renderHook(() => useBooks({ ...target, author: null, series: null, showHidden: false }), { wrapper })
    expect(result.current.data).toEqual(response)
    expect(result.current.isFetching).toBe(false)
    expect(apiGet).toHaveBeenCalledExactlyOnceWith(request.path, signal)
    expect(client.getQueryData(booksQueryParts({ ...target, trash: true }).queryKey)).toBeUndefined()
    expect(client.getQueryData(booksQueryParts({ ...target, showHidden: true }).queryKey)).toBeUndefined()
    unmount(); client.clear()
  })
  it('reuses the validated shared page with matching sort, scope and trash keys', async () => {
    const { client, wrapper } = setup()
    const response = { data: { items: [], total: 0, page: 1, pageSize: 24 } }
    vi.mocked(apiGet).mockResolvedValue(response)
    const target = { expression, page: 1, pageSize: 24, sortBy: 'title', sortOrder: 'asc', categoryId: 'category', categoryScope: 'subtree' as const, trash: true }
    const request = { ...catalogQueryParts('library', target), path: catalogQueryParts('library', { ...target, expression: source }).path }
    expect(await loadSearchPage(client, request, new AbortController().signal)).toBe(true)
    const { result, unmount } = renderHook(() => useLibraryCatalog('library', target), { wrapper })
    expect(result.current.data).toEqual(response)
    expect(result.current.isFetching).toBe(false)
    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(catalogQueryParts('other-library', target).queryKey)).toBeUndefined()
    expect(client.getQueryData(catalogQueryParts('library', { ...target, trash: false }).queryKey)).toBeUndefined()
    expect(client.getQueryData(catalogQueryParts('library', { ...target, categoryScope: 'direct' }).queryKey)).toBeUndefined()
    unmount(); client.clear()
  })
  it('leaves the previous result intact when validation fails', async () => {
    const { client } = setup()
    const oldRequest = booksQueryParts(params)
    const oldResult = { data: [], total: 0 }
    client.setQueryData(oldRequest.queryKey, oldResult)
    const request = booksQueryParts({ ...params, expression })
    vi.mocked(apiGet).mockRejectedValue(new Error('Unknown tag'))
    await expect(loadSearchPage(client, request, new AbortController().signal)).rejects.toThrow('Unknown tag')
    expect(client.getQueryData(request.queryKey)).toBeUndefined()
    expect(client.getQueryData(oldRequest.queryKey)).toBe(oldResult)
    client.clear()
  })
  it('does not cache a late result after the draft was cancelled', async () => {
    const { client } = setup()
    const controller = new AbortController()
    const request = booksQueryParts({ ...params, expression })
    let resolve!: (value: unknown) => void
    vi.mocked(apiGet).mockImplementation(() => new Promise((done) => { resolve = done }))
    const loading = loadSearchPage(client, request, controller.signal)
    controller.abort()
    resolve({ data: [], total: 0 })
    expect(await loading).toBe(false)
    expect(client.getQueryData(request.queryKey)).toBeUndefined()
    client.clear()
  })
  it('reuses successful cache entries but reloads invalidated results', async () => {
    const { client } = setup()
    const request = booksQueryParts(params)
    const previous = { data: [], total: 0 }
    client.setQueryData(request.queryKey, previous)
    expect(await loadSearchPage(client, request, new AbortController().signal)).toBe(true)
    expect(apiGet).not.toHaveBeenCalled()
    await client.invalidateQueries({ queryKey: request.queryKey, refetchType: 'none' })
    const fresh = { data: [], total: 1 }
    vi.mocked(apiGet).mockResolvedValue(fresh)
    expect(await loadSearchPage(client, request, new AbortController().signal)).toBe(true)
    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(request.queryKey)).toEqual(fresh)
    client.clear()
  })
})
