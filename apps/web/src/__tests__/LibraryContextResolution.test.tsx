import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  search: { libraryId: 'requested-library', shelf: 'none', tag: undefined, trash: true, page: 4 },
  libraries: vi.fn(),
  books: vi.fn(),
  catalog: vi.fn(),
  searchAuthors: vi.fn(),
  navigate: vi.fn(),
  listTotal: null as number | null,
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useSearch: () => mocks.search,
    useNavigate: () => mocks.navigate,
    useLocation: () => ({ pathname: '/', href: '/', state: { __TSR_key: 'test-entry' } }),
    useRouter: () => ({ history: { canGoBack: () => false } }),
  }
})

vi.mock('@/features/library/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/library/hooks')>()
  const query = (data?: unknown) => ({ data, isLoading: false, isPending: false, isError: false, isFetching: false, refetch: vi.fn() })
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    ...actual,
    useLibraries: mocks.libraries,
    useBooks: (...args: unknown[]) => { mocks.books(...args); return query({ data: [], total: mocks.listTotal ?? 0 }) },
    useLibraryCatalog: (...args: unknown[]) => { mocks.catalog(...args); return query(mocks.listTotal === null ? undefined : { data: { items: [], total: mocks.listTotal } }) },
    useLibraryRelation: () => query(),
    useLibraryCategories: () => query({ data: [] }),
    useLibraryTags: () => query({ data: [] }),
    useLibrarySearchAuthors: (...args: unknown[]) => { mocks.searchAuthors(...args); return query({ data: [] }) },
    useShelves: () => query({ data: [] }),
    useTags: () => query({ data: [] }),
    useTrashEnabled: () => true,
    useTrashCapBytes: () => undefined,
    useLibraryPrefsState: () => ({ prefs: undefined, isReady: true, isError: false, isFetching: false, refetch: vi.fn() }),
    useHiddenLibraries: () => ({ isHidden: () => false, isReady: true }),
    useDeleteBook: mutation,
    useForkBook: mutation,
    useRestoreBook: mutation,
    usePermanentDeleteBook: mutation,
    useEmptyTrash: mutation,
    useRestoreLibraryBook: mutation,
    usePermanentDeleteLibraryBook: mutation,
    useEmptyLibraryTrash: mutation,
    useMoveBooksToShelf: mutation,
    useSetWorkCategory: mutation,
    useReorderShelves: mutation,
    useReorderTags: mutation,
    useReorderLibraryCategories: mutation,
    useReorderLibraryTags: mutation,
    useUpdateLibraryPrefs: mutation,
  }
})

vi.mock('@/features/auth/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth/hooks')>()
  return { ...actual, useInstanceInfo: () => ({ data: { data: { allowUserUpload: true } } }) }
})

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))

import Library from '@/features/library/Library'
import { saveLibrariesSnapshot } from '@/lib/library-name-cache'
import { useAuthStore } from '@/stores/auth.store'

function renderLibrary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { ...render(<QueryClientProvider client={client}><Library /></QueryClientProvider>), client }
}

describe('Library requested context resolution', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    })
    localStorage.clear()
    mocks.search = { libraryId: 'requested-library', shelf: 'none', tag: undefined, trash: true, page: 4 }
    mocks.libraries.mockReturnValue({ data: undefined, isPending: true, isError: false, isFetching: true, refetch: vi.fn() })
    mocks.books.mockClear()
    mocks.catalog.mockClear()
    mocks.searchAuthors.mockClear()
    mocks.navigate.mockClear()
    mocks.listTotal = null
    useAuthStore.setState({ user: { id: 'user-1', username: 'reader', role: 'member' } })
  })

  afterEach(() => {
    useAuthStore.setState({ user: null })
    localStorage.clear()
  })

  it('keeps a requested shared URL pending without running private queries or correcting the URL', () => {
    const { container } = renderLibrary()

    expect(container.querySelector('[data-library-context="pending"]')).toBeInTheDocument()
    expect(mocks.books).toHaveBeenCalled()
    expect(mocks.books.mock.calls.every(([, options]) => (options as { enabled?: boolean })?.enabled === false)).toBe(true)
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Switch library' })).toBeNull()
  })

  it('shows a retryable library-list failure and keeps the requested URL without private fallback', () => {
    mocks.libraries.mockReturnValue({ data: undefined, isPending: false, isError: true, isFetching: false, refetch: vi.fn() })
    const { container } = renderLibrary()

    expect(container.querySelector('[data-library-context="error"]')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(mocks.books).toHaveBeenCalled()
    expect(mocks.books.mock.calls.every(([, options]) => (options as { enabled?: boolean })?.enabled === false)).toBe(true)
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Switch library' })).toBeNull()
    expect(screen.queryByTestId('library-title-skeleton')).toBeNull()
  })

  it('does not show the personal-library fallback when its name request fails cold', () => {
    mocks.search = { libraryId: undefined, shelf: undefined, tag: undefined, trash: false, page: 1 }
    mocks.libraries.mockReturnValue({ data: undefined, isPending: false, isError: true, isFetching: false, refetch: vi.fn() })
    renderLibrary()

    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    expect(screen.queryByText('My library')).toBeNull()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('keeps a cached private library name and offers retry after the library request fails', () => {
    mocks.search = { libraryId: undefined, shelf: undefined, tag: undefined, trash: false, page: 1 }
    saveLibrariesSnapshot('user-1', [{ id: 'private-1', type: 'private', name: 'Saved library name' } as never])
    const refetch = vi.fn()
    mocks.libraries.mockReturnValue({ data: undefined, isPending: false, isError: true, isFetching: false, refetch })
    renderLibrary()

    expect(screen.getAllByText('Saved library name').length).toBeGreaterThan(0)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it('waits to apply shelf URL corrections until the requested library is resolved', () => {
    const view = renderLibrary()
    expect(view.container.querySelector('[data-library-context="pending"]')).toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()

    mocks.libraries.mockReturnValue({
      data: { data: [{ id: 'requested-library', type: 'shared', name: 'Shared', relation: 'owner' }] },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })
    act(() => view.rerender(<QueryClientProvider client={view.client}><Library /></QueryClientProvider>))

    expect(view.container.querySelector('[data-library-context="resolved"]')).toBeInTheDocument()
    expect(mocks.navigate.mock.calls.every(([options]) => (options as { search?: { shelf?: string } }).search?.shelf === 'none')).toBe(true)
  })

  it.each(['shelves', 'private categories', 'shared categories'])('keeps the selected %s view when its last book leaves', (context) => {
    const shared = context === 'shared categories'
    mocks.search = {
      libraryId: shared ? 'requested-library' : undefined,
      shelf: context === 'shelves' ? 'none' : undefined,
      category: context !== 'shelves' ? 'none' : undefined,
      tag: undefined, trash: false, page: 1,
    }
    mocks.libraries.mockReturnValue({
      data: { data: [{ id: shared ? 'requested-library' : 'private-1', type: shared ? 'shared' : 'private', name: 'Library', relation: 'owner' }] },
      isPending: false, isError: false, isFetching: false, refetch: vi.fn(),
    })
    mocks.listTotal = 1
    const view = renderLibrary()
    mocks.navigate.mockClear()

    mocks.listTotal = 0
    act(() => view.rerender(<QueryClientProvider client={view.client}><Library /></QueryClientProvider>))

    expect(view.container.querySelector('[data-library-context="resolved"]')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: context === 'shelves' ? 'Not on a shelf' : 'Uncategorized' })).toBeInTheDocument()
    expect(screen.getByText(/^(No books yet|Library is empty)$/)).toBeInTheDocument()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('disables catalog and author-search requests in library activity and restores them in the books view', () => {
    mocks.search = { libraryId: 'requested-library', shelf: undefined, tag: undefined, trash: false, page: 1, section: 'activity' }
    mocks.libraries.mockReturnValue({
      data: { data: [{ id: 'requested-library', type: 'shared', name: 'Shared', relation: 'owner' }] },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })
    const view = renderLibrary()

    expect(mocks.catalog.mock.calls.some(([id, , options]) => id === 'requested-library' && (options as { enabled?: boolean } | undefined)?.enabled === false)).toBe(true)
    expect(mocks.searchAuthors.mock.calls.some(([id, , , options]) => id === 'requested-library' && (options as { enabled?: boolean } | undefined)?.enabled === false)).toBe(true)

    mocks.search = { ...mocks.search, section: undefined }
    act(() => view.rerender(<QueryClientProvider client={view.client}><Library /></QueryClientProvider>))

    expect(mocks.catalog.mock.calls.some(([id, , options]) => id === 'requested-library' && (options as { enabled?: boolean } | undefined)?.enabled === true)).toBe(true)
    expect(mocks.searchAuthors.mock.calls.some(([id, , , options]) => id === 'requested-library' && (options as { enabled?: boolean } | undefined)?.enabled === true)).toBe(true)
  })
})
