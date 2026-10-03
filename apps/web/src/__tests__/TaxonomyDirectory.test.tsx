import type { ComponentProps } from 'react'
import type { DndContext, DragEndEvent } from '@dnd-kit/core'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Category } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/api/client'
import { notify } from '@/lib/notifications'
import TaxonomyDirectory from '@/features/library/components/TaxonomyDirectory'

const drag = vi.hoisted(() => ({ end: undefined as ComponentProps<typeof DndContext>['onDragEnd'] }))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@dnd-kit/core')>()
  return { ...original, DndContext: (props: ComponentProps<typeof DndContext>) => { drag.end = props.onDragEnd; return <original.DndContext {...props} /> } }
})

function drop(id: string, targetId: string) {
  act(() => drag.end?.({ active: { id: `directory:${id}`, data: { current: { entryId: id } } }, over: { id: `directory:${targetId}`, data: { current: { entryId: targetId } } } } as DragEndEvent))
}

vi.mock('@/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/client')>(), apiGet: vi.fn().mockResolvedValue({ data: [] }), apiPatch: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string, params?: { name?: string }) => params?.name ? `${key} ${params.name}` : key }))
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

function category(id: string, parentId: string | null): Category {
  return { id, libraryId: 'lib', userId: 'owner', name: id, parentId, sortOrder: 0, pinned: false, hidden: false, bookCount: 1, subtreeBookCount: 2, createdAt: 1, updatedAt: 1 }
}

function setup(canManage = true) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } })
  client.setQueryData(['libraries', 'lib', 'categories'], { data: [category('Root', null), category('Child', 'Root'), category('Other', null)] })
  client.setQueryData(['libraries', 'lib', 'tags'], { data: [{ ...category('Topic', null), bookCount: 1 }] })
  client.setQueryData(['shelves'], { data: [] })
  client.setQueryData(['tags'], { data: [] })
  const navigate = vi.fn()
  const props = { libraryId: 'lib', sessionKey: `test-${Math.random()}`, panel: 'categories' as const, canManage, navSearch: navigate, onOpenNavigation: vi.fn() }
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
  it('opens a category directly from its menu header and closes the menu', () => {
    const { navigate } = setup()
    fireEvent.contextMenu(screen.getByText('Root'))
    fireEvent.click(screen.getByRole('button', { name: /Root library.bookCount/ }))
    expect(navigate).toHaveBeenCalledWith({ shelf: 'Root', categoryScope: 'subtree', directory: undefined })
    expect(screen.queryByRole('button', { name: 'library.edit' })).toBeNull()
  })

  it('opens a tag directly from its menu header', () => {
    const { navigate, rerender, props, client } = setup()
    rerender(<QueryClientProvider client={client}><TaxonomyDirectory {...props} panel="tags" /></QueryClientProvider>)
    fireEvent.contextMenu(screen.getByText('Topic'))
    fireEvent.click(screen.getByRole('button', { name: /Topic library.bookCount/ }))
    expect(navigate).toHaveBeenCalledWith({ tag: 'Topic', directory: undefined })
  })

  it('combines renaming and parent changes in one edit entry with matching icons', () => {
    setup()
    fireEvent.contextMenu(screen.getByText('Root'))
    expect(screen.queryByText('library.moveCategory')).toBeNull()
    expect(screen.getByRole('button', { name: 'library.newSubcategory' }).querySelector('svg')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.contextMenu(screen.getByText('Other'))
    expect(screen.queryByText('library.moveCategory')).toBeNull()
    expect(screen.getByRole('button', { name: 'library.edit' }).querySelector('svg')).not.toBeNull()
  })
  it('finds child categories without losing their group and navigates without clearing other conditions', () => {
    const { navigate } = setup()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Child' } })
    expect(screen.getByText('Root')).toBeInTheDocument()
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(screen.queryByText('Other')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Child'))
    expect(navigate).toHaveBeenCalledWith({ shelf: 'Child', categoryScope: 'subtree', directory: undefined })
  })

  it('exposes browse-only entries to ordinary readers', () => {
    const { navigate } = setup(false)
    expect(screen.queryByText('library.manageDirectory')).toBeNull()
    expect(screen.queryByText('library.newCategory')).toBeNull()
    fireEvent.click(screen.getByText('Child'))
    expect(navigate).toHaveBeenCalledWith({ shelf: 'Child', categoryScope: 'subtree', directory: undefined })
  })

  it('creates a child only under a root and submits the selected parent', async () => {
    setup()
    fireEvent.contextMenu(screen.getByText('Root'))
    fireEvent.click(screen.getByText('library.newSubcategory'))
    const dialog = screen.getByRole('dialog')
    const parent = dialog.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
    expect(parent).toHaveTextContent('Root')
    fireEvent.click(parent)
    expect(within(dialog).queryByRole('button', { name: /Child/ })).toBeNull()
    fireEvent.click(parent)
    fireEvent.change(screen.getByPlaceholderText('library.categoryName'), { target: { value: 'New child' } })
    fireEvent.click(screen.getByText('library.create'))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/libraries/lib/categories', { name: 'New child', parentId: 'Root' }))
  })

  it('keeps rename and move drafts after a rejected save', async () => {
    vi.mocked(apiPatch).mockRejectedValueOnce(new Error('Rejected'))
    setup()
    fireEvent.contextMenu(screen.getByText('Child'))
    fireEvent.click(screen.getByText('library.edit'))
    expect(screen.getByText('library.editCategory')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('library.categoryName'), { target: { value: 'Renamed child' } })
    const dialog = screen.getByRole('dialog')
    const parent = dialog.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
    fireEvent.click(parent)
    fireEvent.click(within(document.querySelector<HTMLElement>('[data-smart-menu="true"]')!).getByRole('button', { name: /Other/ }))
    fireEvent.click(screen.getByText('library.save'))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/libraries/lib/categories/Child', { name: 'Renamed child', parentId: 'Other' }))
    expect(screen.getByPlaceholderText('library.categoryName')).toHaveValue('Renamed child')
    expect(parent).toHaveTextContent('Other')
  })

  it('submits the complete id set when the browsing list is filtered', async () => {
    const { client } = setup()
    act(() => client.setQueryData(['libraries', 'lib', 'categories'], { data: [category('Root', null), category('Child', 'Root'), category('RootOther', null), category('Else', null)] }))
    await screen.findByText('RootOther')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Root' } })
    expect(screen.queryByText('Else')).toBeNull()
    drop('Root', 'RootOther')
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/libraries/lib/categories/order', { categoryIds: ['RootOther', 'Child', 'Root', 'Else'] }))
  })
  it('selects instead of navigating and prevents sorting in selection mode', async () => {
    const { navigate } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'library.selectMode' }))
    fireEvent.click(screen.getByText('Root'))
    expect(screen.getByRole('button', { name: /Root/ })).toHaveAttribute('aria-pressed', 'true')
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('library.moreActions')).toBeNull()
    drop('Root', 'Other')
    expect(apiPut).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'library.selectMode' }))
    fireEvent.click(screen.getByText('Root'))
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('rejects cross-parent and read-only reorder operations', () => {
    setup(false)
    drop('Root', 'Other')
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('does not use sorting to move a child into another parent', () => {
    setup()
    drop('Child', 'Other')
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('reuses the hidden icon and the direct menu-button entry point', async () => {
    const { client } = setup()
    act(() => client.setQueryData(['libraries', 'lib', 'categories'], { data: [{ ...category('Root', null), hidden: true }, category('Child', 'Root')] }))
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
    act(() => client.setQueryData(['libraries', 'lib', 'categories'], { data: [{ ...category('Root', null), pinned: true, hidden: true }, category('Other', null)] }))
    start()
    select('Root'); select('Other')
    for (const action of ['pin', 'unpin', 'hide', 'show']) expect(toolbar().getByRole('button', { name: `library.${action}` })).toBeInTheDocument()
  })

  it('retains failed items and clears successful ones while applying one target value', async () => {
    setup()
    vi.mocked(apiGet).mockImplementation(async (url) => ({ data: String(url).endsWith('/categories') ? [category('Root', null), category('Child', 'Root'), category('Other', null)] : [] }) as never)
    vi.mocked(apiPatch).mockImplementation(async (url) => { if (String(url).endsWith('/Other')) throw new Error('Rejected'); return { data: {} } as never })
    start(); select('Root'); select('Other')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.pin' }))
    await waitFor(() => expect(toolbar().getByRole('button', { name: 'library.taxonomySelectAll' })).not.toBeDisabled())
    expect(apiPatch).toHaveBeenCalledWith('/libraries/lib/categories/Root', { pinned: true })
    expect(apiPatch).toHaveBeenCalledWith('/libraries/lib/categories/Other', { pinned: true })
    expect(screen.getByText('Root').closest('button')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Other').closest('button')).toHaveAttribute('aria-pressed', 'true')
    expect(notify.warning).toHaveBeenCalledWith({ key: 'library.taxonomyBatchPartial', params: { succeeded: 1, failed: 1 } })
  })

  it('confirms category deletion and deletes selected children before selected parents', async () => {
    setup(); start(); select('Root'); select('Child')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.delete' }))
    expect(apiDelete).not.toHaveBeenCalled()
    expect(screen.getByText('library.taxonomyBatchDeleteCategories')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'library.delete' }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(2))
    expect(vi.mocked(apiDelete).mock.calls.map(([url]) => url)).toEqual(['/libraries/lib/categories/Child', '/libraries/lib/categories/Root'])
  })

  it('locks selection and duplicate requests while a batch is pending', async () => {
    setup()
    let resolve: (value: unknown) => void = () => {}
    vi.mocked(apiPatch).mockReturnValueOnce(new Promise((done) => { resolve = done }) as never)
    start(); select('Root')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.pin' }))
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
    client.setQueryData(['shelves'], { data: [category('Shelf', null)] })
    client.setQueryData(['tags'], { data: [category('Tag', null)] })
    rerender(<QueryClientProvider client={client}><TaxonomyDirectory {...props} libraryId={null} /></QueryClientProvider>)
    start(); select('Shelf')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.hide' }))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/shelves/Shelf', { hidden: true }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'library.selectMode' })).not.toBeDisabled())
    rerender(<QueryClientProvider client={client}><TaxonomyDirectory {...props} key="tags" libraryId={null} panel="tags" /></QueryClientProvider>)
    client.setQueryData(['tags'], { data: [category('Tag', null)] })
    await screen.findByText('Tag')
    start(); select('Tag')
    fireEvent.click(toolbar().getByRole('button', { name: 'library.pin' }))
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/tags/Tag', { pinned: true }))
  })
})
