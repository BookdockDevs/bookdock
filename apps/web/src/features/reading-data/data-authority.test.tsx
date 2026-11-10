import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiDelete, apiGet } from '@/api/client'

import { DEVICE_VAULT_SCOPE } from '../local-library/catalog'
import { CatalogSourceContext, type LocalCatalogSource } from './catalog-source-context'
import { useDataAuthority } from './data-authority'
import { useDeleteLibraryCategory, useLibraryCategories, useTrashAutoCleanDays } from '../library/hooks'

const authState: { user: { id: string; privateLibraryId: string } | null } = { user: null }
vi.mock('@/stores/auth.store', () => {
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState)
  return { useAuthStore: Object.assign(useAuthStore, { getState: () => authState }), getAuthSessionRevision: () => 0 }
})

const readCatalog = vi.fn()
const deleteOrganization = vi.fn()
const mirrorOrganization = vi.fn()
vi.mock('@/features/local-library/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/local-library/catalog')>()
  return { ...actual, localCatalogOperations: () => ({ readCatalog, deleteOrganization, mirrorOrganization }) }
})

// The projection itself is covered elsewhere; these cases are about which side
// answers, so the vault hands back a readable row and nothing more.
vi.mock('@/features/local-library/catalog-view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/local-library/catalog-view')>()
  return {
    ...actual,
    localTaxonomyViews: () => ({
      shelves: [],
      tags: [],
      categories: [{ id: 'c1', name: 'Device category', bookCount: 0, subtreeBookCount: 0, pinned: false, hidden: false, parentId: null }],
    }),
  }
})

vi.mock('@/lib/settings-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/settings-cache')>(),
  fetchSettings: vi.fn(async () => ({ data: { trash: { autoCleanDays: 7 } } })),
}))

vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  apiGet: vi.fn(),
  apiDelete: vi.fn(),
  apiPut: vi.fn(),
  apiPost: vi.fn(),
}))

function wrapper(client: QueryClient, source?: LocalCatalogSource) {
  const tree = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{source
    ? <CatalogSourceContext.Provider value={source}>{children}</CatalogSourceContext.Provider>
    : children}</QueryClientProvider>
  return tree
}

function setup(source?: LocalCatalogSource) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: wrapper(client, source) }
}

beforeEach(() => {
  authState.user = null
  readCatalog.mockReset().mockResolvedValue({ books: [], items: [], version: 1 })
  deleteOrganization.mockReset().mockResolvedValue(undefined)
  mirrorOrganization.mockReset().mockResolvedValue(undefined)
  vi.mocked(apiGet).mockReset().mockResolvedValue({ data: [] })
  vi.mocked(apiDelete).mockReset().mockResolvedValue({ data: null })
})

describe('data authority', () => {
  it('keeps non-book data in the vault for a guest', () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useDataAuthority(), { wrapper })
    expect(result.current?.scope).toEqual(DEVICE_VAULT_SCOPE)
  })

  it('keeps it in the account when there is an account', () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    const { wrapper } = setup()
    const { result } = renderHook(() => useDataAuthority(), { wrapper })
    expect(result.current).toBeNull()
  })

  it('follows a surface pinned to one device book even when signed in', () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    const source: LocalCatalogSource = { scope: DEVICE_VAULT_SCOPE, operations: { readCatalog } as unknown as LocalCatalogSource['operations'] }
    const { wrapper } = setup(source)
    const { result } = renderHook(() => useDataAuthority(), { wrapper })
    expect(result.current).toBe(source)
  })
})

describe('categories follow the same authority', () => {
  it('reads and writes the vault tree for a guest', async () => {
    const { wrapper } = setup()
    const list = renderHook(() => useLibraryCategories(null), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
    expect(readCatalog).toHaveBeenCalled()
    expect(apiGet).not.toHaveBeenCalled()
    expect(list.result.current.data?.data.map((row) => row.name)).toEqual(['Device category'])

    const remove = renderHook(() => useDeleteLibraryCategory(), { wrapper })
    remove.result.current.mutate({ libraryId: null, categoryId: 'c1' })
    await waitFor(() => expect(deleteOrganization).toHaveBeenCalledWith('category', 'c1'))
    expect(apiDelete).not.toHaveBeenCalled()
  })

  it('reads and writes the account tree once signed in', async () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    const { wrapper } = setup()
    const list = renderHook(() => useLibraryCategories('lib-1'), { wrapper })
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true))
    expect(apiGet).toHaveBeenCalledWith('/libraries/lib-1/categories', expect.any(AbortSignal))
    expect(readCatalog).not.toHaveBeenCalled()

    const remove = renderHook(() => useDeleteLibraryCategory(), { wrapper })
    remove.result.current.mutate({ libraryId: 'lib-1', categoryId: 'c1' })
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/libraries/lib-1/categories/c1'))
    expect(deleteOrganization).not.toHaveBeenCalled()
  })
})

describe('trash retention is one policy', () => {
  it('judges a device row by the account window once signed in', async () => {
    authState.user = { id: 'reader', privateLibraryId: 'lib-1' }
    const { wrapper } = setup()
    const { result } = renderHook(() => useTrashAutoCleanDays(), { wrapper })
    await waitFor(() => expect(result.current).toBe(7))
    // No second window from the vault: the row's storage never decides this.
    expect(deleteOrganization).not.toHaveBeenCalled()
    expect(readCatalog).not.toHaveBeenCalled()
  })
})
