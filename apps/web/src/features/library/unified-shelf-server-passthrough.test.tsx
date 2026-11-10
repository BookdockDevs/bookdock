import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UseBooksParams } from './catalog-query'
import { useUnifiedBooks } from './hooks'

const list = vi.fn()
const vaultPage = { entries: [], organization: { version: 0, items: [] }, total: 0, totalSize: 0 }
vi.mock('@/features/local-library/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/local-library/catalog')>()
  return { ...actual, localCatalogOperations: () => ({ list }) }
})

const remoteRead = vi.fn()
vi.mock('@/features/reading-data/remote-catalog', () => ({ guardedRemoteCatalogRead: (...args: unknown[]) => remoteRead(...args) }))

const auth: { user: { id: string } | null } = { user: null }
vi.mock('@/stores/auth.store', () => {
  const useAuthStore = (selector: (value: typeof auth) => unknown) => selector(auth)
  return { useAuthStore: Object.assign(useAuthStore, { getState: () => auth }), getAuthSessionRevision: () => 0 }
})

const params: UseBooksParams = { page: 1, pageSize: 24, search: '', sortBy: 'title', sortOrder: 'asc', shelfId: null, tagId: null, format: null, readStatus: null, trash: false }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  auth.user = null
  list.mockReset().mockResolvedValue(vaultPage)
  remoteRead.mockReset()
})

/**
 * A reader who never saved anything on this device sees the server's own shelf.
 * Merging an empty half would still page 1..N, re-sort with the client
 * comparator, and swallow a server failure into an "empty library" - three
 * differences a server-book reader would notice against the old build.
 */
describe('unified shelf with no device book', () => {
  it('reads the requested server page once and keeps the server order', async () => {
    auth.user = { id: 'u1' }
    const serverPage = { data: [{ id: 'b2' }, { id: 'b1' }], total: 40, totalSize: 1024, page: 2, pageSize: 24 }
    remoteRead.mockResolvedValue(serverPage)
    const { wrapper } = setup()
    const { result } = renderHook(() => useUnifiedBooks({ ...params, page: 2 }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // One request for page 2, not pages 1..2 merged and re-sliced.
    expect(remoteRead).toHaveBeenCalledTimes(1)
    expect(remoteRead.mock.calls[0]![0]).toContain('page=2')
    // Rows, totals and order are the server's, untouched.
    expect(result.current.data).toBe(serverPage)
  })

  it('surfaces a server failure instead of rendering an empty shelf', async () => {
    auth.user = { id: 'u1' }
    remoteRead.mockRejectedValue(new Error('server exploded'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useUnifiedBooks(params), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('still keeps device rows when the server fails on a mixed shelf', async () => {
    auth.user = { id: 'u1' }
    list.mockResolvedValue({
      entries: [{
        book: {
          ref: { scope: { kind: 'local', vaultId: 'v' }, bookId: 'local-1' },
          title: 'Local', authors: [], format: 'epub', size: 10, createdAt: 1, updatedAt: 1,
          availability: 'available', catalog: null,
        },
        state: null,
      }],
      organization: { version: 1, items: [] },
      total: 1,
      totalSize: 10,
    })
    remoteRead.mockRejectedValue(new Error('offline'))
    const { wrapper } = setup()
    const { result } = renderHook(() => useUnifiedBooks(params), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isError).toBe(false)
    expect(result.current.data?.data).toHaveLength(1)
  })
})
