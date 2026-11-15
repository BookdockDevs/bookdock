import type { ComponentProps } from 'react'
import type { DndContext, DragEndEvent } from '@dnd-kit/core'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientCategoryView } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/api/client'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'
import TaxonomyDirectory from '@/features/library/components/TaxonomyDirectory'

const drag = vi.hoisted(() => ({ end: undefined as ComponentProps<typeof DndContext>['onDragEnd'] }))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dnd-kit/core')>()
  return { ...original, DndContext: (props: ComponentProps<typeof DndContext>) => { drag.end = props.onDragEnd; return <original.DndContext {...props} /> } }
})

function drop(id: string, targetId: string) {
  act(() => drag.end?.({
    active: { id: `directory:${id}`, data: { current: { entryId: id } } },
    over: { id: targetId === 'directory:promote-to-root' ? targetId : `directory:${targetId}`, data: { current: { entryId: targetId } } },
  } as DragEndEvent))
}

vi.mock('@/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/client')>(), apiGet: vi.fn().mockResolvedValue({ data: [] }), apiPatch: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string, params?: { name?: string }) => params?.name ? `${key} ${params.name}` : key }))
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

function category(id: string, parentId: string | null): ClientCategoryView {
  const path = parentId ? [parentId, id] : [id]
  const key = JSON.stringify(path)
  return {
    id: key,
    libraryId: 'lib',
    name: id,
    path,
    parentId: parentId ? JSON.stringify([parentId]) : null,
    sortOrder: 0,
    pinned: false,
    hidden: false,
    bookCount: 1,
    subtreeBookCount: 2,
    createdAt: 1,
    updatedAt: 1,
  }
}

function setup(canManage = true) {
  useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } })
  client.setQueryData(['libraries', 'lib', 'categories', false], { data: [category('Root', null), category('Child', 'Root'), category('Other', null)] })
  client.setQueryData(['libraries', 'lib', 'tags'], { data: [{ id: 'Topic', name: 'Topic', libraryId: 'lib', sortOrder: 0, pinned: false, hidden: false, bookCount: 1, createdAt: 1, updatedAt: 1 }] })
  client.setQueryData(['shelves', 'account', false], { data: [] })
  client.setQueryData(['tags', 'account', false], { data: [] })
  const navigate = vi.fn()
  const props = {
    libraryId: 'lib',
    privateLibraryId: 'private-lib',
    sessionKey: `test-${Math.random()}`,
    panel: 'categories' as const,
    source: 'server' as const,
    canManage,
    navSearch: navigate,
    onOpenNavigation: vi.fn(),
  }
  const result = render(<QueryClientProvider client={client}><TaxonomyDirectory {...props} /></QueryClientProvider>)
  return { ...result, navigate, client, props }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiGet).mockReset().mockResolvedValue({ data: [] })
  vi.mocked(apiDelete).mockReset().mockResolvedValue({ data: null })
  vi.mocked(apiPatch).mockReset().mockResolvedValue({ data: {} })
  vi.mocked(apiPost).mockResolvedValue({ data: {} })
  vi.mocked(apiPut).mockResolvedValue({ data: null })
})

describe('taxonomy directory', () => {
  it.each([
    ['shelves', 'library.noShelves'],
    ['categories', 'library.noCategories'],
    ['tags', 'library.noTags'],
  ] as const)('shows the matching empty state for an empty %s collection', async (panel, emptyLabel) => {
    const { rerender, props, client } = setup()
    if (panel === 'categories') act(() => client.setQueryData(['libraries', 'lib', 'categories', false], { data: [] }))
    if (panel === 'tags') act(() => client.setQueryData(['libraries', 'lib', 'tags'], { data: [] }))
    rerender(<QueryClientProvider client={client}><TaxonomyDirectory {...props} panel={panel} /></QueryClientProvider>)

    expect(await screen.findByText(emptyLabel)).toBeInTheDocument()
    if (panel === 'tags') expect(screen.queryByText('library.noCategories')).toBeNull()
  })

  it('keeps the empty-collection state out of search results with no matches', () => {
    setup()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } })

    expect(screen.queryByText('library.noCategories')).toBeNull()
    expect(screen.queryByText('Root')).toBeNull()
  })

  it('opens a category directly from its menu header and closes the menu', () => {
    const { navigate } = setup()
    fireEvent.contextMenu(screen.getByText('Root'))
    fireEvent.click(screen.getByRole('button', { name: /Root library.bookCount/ }))
    expect(navigate).toHaveBeenCalledWith({ category: JSON.stringify(['Root']), shelf: undefined, categoryScope: 'subtree', directory: undefined })
    expect(screen.queryByRole('button', { name: 'library.edit' })).toBeNull()
  })

  it('opens a tag directly from its menu header', () => {
    const { navigate, rerender, props, client } = setup()
    rerender(<QueryClientProvider client={client}><TaxonomyDirectory {...props} panel="tags" /></QueryClientProvider>)
    fireEvent.contextMenu(screen.getByText('Topic'))
    fireEvent.click(screen.getByRole('button', { name: /Topic library.bookCount/ }))
    expect(navigate).toHaveBeenCalledWith({ tag: 'Topic', directory: undefined })
  })

  it('finds child categories without losing their group and navigates without clearing other conditions', () => {
    const { navigate } = setup()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Child' } })
    expect(screen.getByText('Root')).toBeInTheDocument()
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(screen.queryByText('Other')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Child'))
    expect(navigate).toHaveBeenCalledWith({ category: JSON.stringify(['Root', 'Child']), shelf: undefined, categoryScope: 'subtree', directory: undefined })
  })

  it('exposes browse-only entries to ordinary readers', () => {
    const { navigate } = setup(false)
    expect(screen.queryByText('library.manageDirectory')).toBeNull()
    expect(screen.queryByText('library.newCategory')).toBeNull()
    fireEvent.click(screen.getByText('Child'))
    expect(navigate).toHaveBeenCalledWith({ category: JSON.stringify(['Root', 'Child']), shelf: undefined, categoryScope: 'subtree', directory: undefined })
  })

  it('submits the complete keys set when the browsing list is filtered', async () => {
    const { client } = setup()
    act(() => client.setQueryData(['libraries', 'lib', 'categories', false], {
      data: [category('Root', null), category('Child', 'Root'), category('RootOther', null), category('Else', null)],
    }))
    await screen.findByText('RootOther')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Root' } })
    expect(screen.queryByText('Else')).toBeNull()
    drop(JSON.stringify(['Root']), JSON.stringify(['RootOther']))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/libraries/lib/categories/order', {
      keys: [JSON.stringify(['RootOther']), JSON.stringify(['Root', 'Child']), JSON.stringify(['Root']), JSON.stringify(['Else'])],
    }))
  })

  it('supports dragging a subcategory into another root category', async () => {
    setup()
    drop(JSON.stringify(['Root', 'Child']), JSON.stringify(['Other']))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/libraries/lib/categories', {
      path: ['Root', 'Child'],
      parentPath: ['Other'],
    }))
  })

  it('supports dragging a subcategory out to promote to root category', async () => {
    setup()
    drop(JSON.stringify(['Root', 'Child']), 'directory:promote-to-root')
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/libraries/lib/categories', {
      path: ['Root', 'Child'],
      parentPath: null,
    }))
  })

  it('selects instead of navigating and prevents sorting in selection mode', async () => {
    const { navigate } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'library.selectMode' }))
    fireEvent.click(screen.getByText('Root'))
    expect(screen.getByRole('button', { name: /Root/ })).toHaveAttribute('aria-pressed', 'true')
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('library.moreActions')).toBeNull()
    drop(JSON.stringify(['Root']), JSON.stringify(['Other']))
    expect(apiPut).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'library.selectMode' }))
    fireEvent.click(screen.getByText('Root'))
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('rejects reorder operations for read-only readers', () => {
    setup(false)
    drop(JSON.stringify(['Root']), JSON.stringify(['Other']))
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('reuses the hidden icon and the direct menu-button entry point', async () => {
    const { client } = setup()
    act(() => client.setQueryData(['libraries', 'lib', 'categories', false], { data: [{ ...category('Root', null), hidden: true }, category('Child', 'Root')] }))
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'library.hiddenWorkStatus' })).toHaveLength(2))
    expect(screen.getByTitle('library.hiddenByParent')).toBeInTheDocument()
    expect(screen.queryByText('library.catalogUnlisted')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'library.moreActions' })[0]!)
    expect(screen.getByText('library.edit')).toBeInTheDocument()
    expect(screen.getByText('library.show')).toBeInTheDocument()
  })
})

describe('directory batch selection', () => {
  function select(name: string) { fireEvent.click(screen.getByText(name)) }
  function start() { fireEvent.click(screen.getByRole('button', { name: 'library.selectMode' })) }
  function toolbar() { return within(screen.getByRole('toolbar')) }

  it('selects only matching entries and does not implicitly select their parents or children', () => {
    setup()
    start()
    select('Root')
    expect(screen.getByText('Child').closest('button')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'library.clearSelection' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Child' } })
    start()
    fireEvent.click(toolbar().getByRole('button', { name: 'library.taxonomySelectAll' }))
    expect(screen.getByText('Child').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Root').closest('button')).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers explicit target actions for mixed states', () => {
    const { client } = setup()
    act(() => client.setQueryData(['libraries', 'lib', 'categories', false], { data: [{ ...category('Root', null), pinned: true, hidden: true }, category('Other', null)] }))
    start()
    select('Root'); select('Other')
    for (const action of ['pin', 'unpin', 'hide', 'show']) expect(toolbar().getByRole('button', { name: `library.${action}` })).toBeInTheDocument()
  })

  it('retains failed items and clears successful ones while applying one target value', async () => {
    setup()
    vi.mocked(apiGet).mockImplementation(async (url) => ({ data: String(url).endsWith('/categories') ? [category('Root', null), category('Child', 'Root'), category('Other', null)] : [] }) as never)
    vi.mocked(apiPatch).mockImplementation(async (_url, body) => {
      if (body && typeof body === 'object' && 'path' in body && JSON.stringify((body as { path: string[] }).path) === JSON.stringify(['Other'])) throw new Error('Rejected')
      return { data: {} } as never
    })
    start(); select('Root'); select('Other')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.pin' }))
    await waitFor(() => expect(toolbar().getByRole('button', { name: 'library.taxonomySelectAll' })).not.toBeDisabled())
    expect(apiPatch).toHaveBeenCalledWith('/libraries/lib/categories', { path: ['Root'], pinned: true })
    expect(apiPatch).toHaveBeenCalledWith('/libraries/lib/categories', { path: ['Other'], pinned: true })
    expect(screen.getByText('Root').closest('button')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Other').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(notify.warning).toHaveBeenCalledWith({ key: 'library.taxonomyBatchPartial', params: { succeeded: 1, failed: 1 } })
  })

  it('confirms category deletion and deletes selected children before selected parents', async () => {
    setup(); start(); select('Root'); select('Child')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.clear' }))
    expect(apiDelete).not.toHaveBeenCalled()
    expect(screen.getByText('library.taxonomyBatchClearCategories')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'library.clear' }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2))
    expect(vi.mocked(apiPost).mock.calls.map(([url, body]) => [url, (body as { path: string[] }).path])).toEqual([
      ['/libraries/lib/categories/clear', ['Root', 'Child']],
      ['/libraries/lib/categories/clear', ['Root']],
    ])
  })

  it('locks selection and duplicate requests while a batch is pending', async () => {
    setup()
    let resolve: (value: unknown) => void = () => {}
    vi.mocked(apiPatch).mockReturnValueOnce(new Promise((done) => { resolve = done }) as never)
    start(); select('Root')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.pin' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'library.selectMode' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'library.clearSelection' })).toBeDisabled()
    select('Child')
    expect(screen.getByText('Child').closest('button')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.pin' }))
    expect(apiPatch).toHaveBeenCalledTimes(1)
    await act(async () => resolve({ data: {} }))
  })

  it('offers no batch management to read-only readers', () => {
    setup(false); start(); select('Root')
    expect(toolbar().queryByRole('button', { name: 'library.delete' })).toBeNull()
    expect(toolbar().queryByRole('button', { name: 'library.pin' })).toBeNull()
    expect(apiPatch).not.toHaveBeenCalled()
    expect(apiDelete).not.toHaveBeenCalled()
  })

  it('updates private shelves and tags through their own endpoints', async () => {
    const { client, props, rerender } = setup()
    client.setQueryData(['shelves', 'account', false], { data: [{ id: 'shelf-1', name: 'Shelf', bookCount: 1, hidden: false, pinned: false, sortOrder: 0, createdAt: 1, updatedAt: 1 }] })
    client.setQueryData(['tags', 'account', false], { data: [{ id: 'Tag', name: 'Tag', bookCount: 1, hidden: false, pinned: false, sortOrder: 0, createdAt: 1, updatedAt: 1 }] })
    rerender(<QueryClientProvider client={client}><TaxonomyDirectory {...props} libraryId={null} panel="shelves" /></QueryClientProvider>)
    start(); select('Shelf')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.hide' }))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shelves/shelf-1', { hidden: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'library.selectMode' })).not.toBeDisabled())
    rerender(<QueryClientProvider client={client}><TaxonomyDirectory {...props} key="tags" libraryId={null} panel="tags" /></QueryClientProvider>)
    client.setQueryData(['tags', 'account', false], { data: [{ id: 'Tag', name: 'Tag', libraryId: null, sortOrder: 0, pinned: false, hidden: false, bookCount: 1, createdAt: 1, updatedAt: 1 }] })
    await screen.findByText('Tag')
    start(); select('Tag')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.pin' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/tags', { name: 'Tag', pinned: true }))
  })
})
