import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth.store'

import { apiGet, apiPatch, apiPut } from '@/api/client'
import { useReorderShelves, useUpdateCatalogBook, useUpdateLibraryCategory } from '@/features/library/hooks'

vi.mock('@/api/client', async (original) => ({
  ...await original<typeof import('@/api/client')>(), apiGet: vi.fn(), apiPatch: vi.fn(), apiPut: vi.fn(),
}))
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn() } }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })

  vi.clearAllMocks()
  vi.mocked(apiPatch).mockResolvedValue({ data: {} })
  vi.mocked(apiPut).mockResolvedValue({ data: null })
})

describe('taxonomy write consistency', () => {
  it.each(['category', 'work'])('refreshes taxonomy, catalog, details, reader and batch previews after %s writes', async (kind) => {
    const { client, wrapper } = setup()
    const keys = [['libraries', 'lib', 'catalog', {}], ['libraries', 'lib', 'catalog', 'detail', 'work'], ['libraries', 'lib', 'categories'], ['libraries', 'lib', 'tags'], ['books', 'detail', 'book'], ['book', 'book'], ['batch-selection']]
    keys.forEach((key) => client.setQueryData(key, { data: {} }))
    const { result } = renderHook(() => ({ category: useUpdateLibraryCategory(), work: useUpdateCatalogBook() }), { wrapper })
    await act(async () => {
      if (kind === 'category') await result.current.category.mutateAsync({ libraryId: 'lib', path: ['child'], source: 'server', patch: { name: 'Renamed', parentPath: ['root'] } })
      else await result.current.work.mutateAsync({ libraryId: 'lib', libraryBookId: 'work', patch: { categoryPath: ['child'] } })
    })
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    if (kind === 'work') expect(apiPatch).toHaveBeenCalledWith('/libraries/lib/books/work', { categoryPath: ['child'] })
  })

  it('keeps hidden ids in the complete shelves order and rolls back on rejection', async () => {
    const { client, wrapper } = setup()
    const rows = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    client.setQueryData(['shelves'], { data: rows })
    vi.mocked(apiGet).mockResolvedValue({ data: [rows[0], { id: 'hidden' }, rows[1]] })
    vi.mocked(apiPut).mockRejectedValue(new Error('Rejected'))
    const { result } = renderHook(() => ({ shelves: useReorderShelves() }), { wrapper })
    await act(async () => { await expect(result.current.shelves.mutateAsync(['b', 'a'])).rejects.toThrow('Rejected') })
    expect(apiGet).toHaveBeenCalledWith('/shelves?showHidden=1')
    expect(apiPut).toHaveBeenCalledWith('/shelves/order', { shelfIds: ['b', 'hidden', 'a'] })
    expect(client.getQueryData(['shelves'])).toEqual({ data: rows })
  })
})
