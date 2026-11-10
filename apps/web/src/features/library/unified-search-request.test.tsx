import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'

import { booksQueryParts, type UseBooksParams } from './catalog-query'
import { loadUnifiedSearchPage, useUnifiedBooks } from './hooks'

const list = vi.fn()
const vaultPage = { entries: [], organization: { version: 0, items: [] }, total: 0, totalSize: 0 }
vi.mock('@/features/local-library/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/local-library/catalog')>()
  return { ...actual, localCatalogOperations: () => ({ list }) }
})

const remoteRead = vi.fn()
vi.mock('@/features/reading-data/remote-catalog', () => ({ guardedRemoteCatalogRead: (...args: unknown[]) => remoteRead(...args) }))

vi.mock('@/stores/auth.store', () => {
  const state = { user: null }
  const useAuthStore = (selector: (value: typeof state) => unknown) => selector(state)
  return { useAuthStore: Object.assign(useAuthStore, { getState: () => state }), getAuthSessionRevision: () => 0 }
})

const params: UseBooksParams = { page: 1, pageSize: 24, search: '', sortBy: 'title', sortOrder: 'asc', shelfId: null, tagId: null, format: null, readStatus: null, trash: false }
const expression = JSON.stringify({ op: 'and', items: [{ op: 'term', field: 'all', value: 'word' }] })
const unifiedKeyFor = (p: UseBooksParams) => [...booksQueryParts(p).queryKey, 'unified']

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  list.mockReset().mockResolvedValue(vaultPage)
  remoteRead.mockReset().mockResolvedValue({ data: [], total: 0, totalSize: 0, page: 1, pageSize: 24 })
})

describe('unified search validation', () => {
  it('searches the device vault too, so a device-only reader can submit', async () => {
    const { client } = setup()
    expect(await loadUnifiedSearchPage(client, { ...params, expression }, false, new AbortController().signal)).toBe(true)
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ expression }), expect.any(AbortSignal))
    expect(remoteRead).not.toHaveBeenCalled()
    expect(client.getQueryData(unifiedKeyFor({ ...params, expression }))).toEqual({ data: [], total: 0, totalSize: 0, page: 1, pageSize: 24 })
  })

  it('reads the merged list the shelf reads and reuses that entry', async () => {
    const { client } = setup()
    const signal = new AbortController().signal
    expect(await loadUnifiedSearchPage(client, { ...params, expression }, true, signal)).toBe(true)
    expect(remoteRead).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`expression=${encodeURIComponent(expression)}`), signal)
    // The accepted page is already where the shelf looks, so nothing is fetched twice.
    expect(await loadUnifiedSearchPage(client, { ...params, expression }, true, signal)).toBe(true)
    expect(remoteRead).toHaveBeenCalledTimes(1)
  })

  it('fails the submit when the server rejects the expression', async () => {
    const { client } = setup()
    remoteRead.mockRejectedValueOnce(new ApiError('VALIDATION_ERROR', 'unexpected token', undefined, 400))
    await expect(loadUnifiedSearchPage(client, { ...params, expression }, true, new AbortController().signal)).rejects.toBeInstanceOf(ApiError)
    expect(client.getQueryData(unifiedKeyFor({ ...params, expression }))).toBeUndefined()
  })

  it('still renders the device rows when the server cannot be read at all', async () => {
    const { client, wrapper } = setup()
    remoteRead.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useUnifiedBooks(params), { wrapper })
    await waitFor(() => expect(result.current.isFetching).toBe(false))
    // Rendering tolerates an unreadable server; a submit does not, because the
    // expression has to be proven before the URL moves.
    expect(result.current.data).toMatchObject({ data: [], total: 0 })
    await expect(loadUnifiedSearchPage(client, { ...params, expression }, true, new AbortController().signal)).rejects.toThrow('offline')
  })
})
