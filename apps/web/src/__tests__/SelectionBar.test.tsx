import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchSelectionItem } from '@bookdock/shared'

import SelectionBar from '../features/library/components/SelectionBar'
import { useToastStore } from '@/stores/toast.store'

const apiPatch = vi.fn()
const apiPost = vi.fn()
const apiDelete = vi.fn()
let selectionItems: BatchSelectionItem[] = []
let tags: { id: string; name: string; bookCount: number }[] = []
let categories: { id: string; name: string; bookCount: number }[] = []

vi.mock('@/api/client', () => ({
  apiPatch: (...args: unknown[]) => apiPatch(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiDelete: (...args: unknown[]) => apiDelete(...args),
}))

vi.mock('../features/library/hooks', () => ({
  useShelves: () => ({ data: { data: categories } }),
  useTags: () => ({ data: { data: tags } }),
  useLibraryCategories: () => ({ data: { data: categories } }),
  useLibraryTags: () => ({ data: { data: tags } }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

function item(id: string, overrides: Partial<BatchSelectionItem> = {}): BatchSelectionItem {
  return { id, categoryId: null, tagIds: [], hidden: false, pinnedAt: null, versionCount: 1, kind: 'personal', ...overrides }
}

async function clickReady(name: string) {
  const button = screen.getByRole('button', { name })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

beforeEach(() => {
  vi.clearAllMocks()
  useToastStore.getState().clearToasts()
  selectionItems = []
  tags = []
  categories = []
  apiPatch.mockResolvedValue({ data: null })
  apiDelete.mockResolvedValue({ data: null })
  apiPost.mockImplementation((_url: string, body: { ids: string[] }) => Promise.resolve({
    data: body.ids.map((id) => selectionItems.find((row) => row.id === id)),
  }))
})

describe('SelectionBar', () => {
  it('organizes works through the shared library in one request', async () => {
    selectionItems = [item('w1', { kind: undefined }), item('w2', { kind: undefined })]
    categories = [{ id: 'c1', name: '科幻', bookCount: 2 }]
    const onComplete = vi.fn()
    render(<SelectionBar selectedIds={['w1', 'w2']} libraryId="lib1" onClear={vi.fn()} onComplete={onComplete} />, { wrapper })

    await clickReady('library.batchOrganize')
    fireEvent.click(screen.getByText('科幻'))
    fireEvent.click(screen.getByRole('button', { name: 'library.save' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(apiPatch).toHaveBeenCalledWith('/libraries/lib1/books/batch/organize', {
      ids: ['w1', 'w2'], categoryId: 'c1', addTagIds: [], removeTagIds: [],
    })
  })

  it('adds a partially present tag to all selected entries without changing other tags', async () => {
    selectionItems = [item('a', { tagIds: ['t1', 'other'] }), item('b', { tagIds: [] })]
    tags = [{ id: 't1', name: '科幻', bookCount: 1 }]
    render(<SelectionBar selectedIds={['a', 'b']} onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchOrganize')
    fireEvent.click(screen.getByText('library.tags'))
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.indeterminate).toBe(true)
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: 'library.save' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/books/batch/organize', {
      ids: ['a', 'b'], addTagIds: ['t1'], removeTagIds: [],
    }))
  })

  it('removes a tag only when every selected entry has it', async () => {
    selectionItems = [item('a', { tagIds: ['t1'] }), item('b', { tagIds: ['t1'] })]
    tags = [{ id: 't1', name: '科幻', bookCount: 2 }]
    render(<SelectionBar selectedIds={['a', 'b']} onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchOrganize')
    fireEvent.click(screen.getByText('library.tags'))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'library.save' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/books/batch/organize', {
      ids: ['a', 'b'], addTagIds: [], removeTagIds: ['t1'],
    }))
  })

  it('keeps reading status in a private-library menu', async () => {
    selectionItems = [item('a'), item('b')]
    const onComplete = vi.fn()
    render(<SelectionBar selectedIds={['a', 'b']} onClear={vi.fn()} onComplete={onComplete} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'library.readStatusLabel' }))
    fireEvent.click(screen.getByRole('button', { name: 'library.markFinished' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(apiPatch).toHaveBeenCalledWith('/books/a', { readStatus: 'finished' })
    expect(apiPatch).toHaveBeenCalledWith('/books/b', { readStatus: 'finished' })
  })

  it('pins a shared work instead of a version', async () => {
    selectionItems = [item('w1', { kind: undefined })]
    render(<SelectionBar selectedIds={['w1']} libraryId="lib1" onClear={vi.fn()} />, { wrapper })

    await clickReady('library.pin')
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/libraries/lib1/books/w1', { pinned: true }))
  })

  it('uses one Delete action but explains and applies private A/B effects separately', async () => {
    selectionItems = [item('a'), item('b', { kind: 'shared' })]
    render(<SelectionBar selectedIds={['a', 'b']} onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchDelete')
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('library.batchDeleteOwnedTrash')).toBeInTheDocument()
    expect(within(dialog).getByText('library.batchDeleteCollected')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'library.batchDelete' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(2))
    expect(apiDelete).toHaveBeenCalledWith('/books/a')
    expect(apiDelete).toHaveBeenCalledWith('/books/b?deleteUserData=true')
  })

  it('counts all versions in shared-work deletion confirmation', async () => {
    selectionItems = [item('w1', { kind: undefined, versionCount: 3 })]
    render(<SelectionBar selectedIds={['w1']} libraryId="lib1" onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchDelete')
    expect(screen.getByText('library.batchDeleteSharedTrash')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'library.batchDelete' }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/libraries/lib1/books/w1'))
  })

  it('keeps only failed identities selected after a partial update', async () => {
    selectionItems = [item('a'), item('b')]
    apiPatch.mockImplementation((url: string) => url === '/books/b' ? Promise.reject(new Error('failed')) : Promise.resolve({ data: null }))
    const onRetainSelection = vi.fn()
    render(<SelectionBar selectedIds={['a', 'b']} onClear={vi.fn()} onRetainSelection={onRetainSelection} />, { wrapper })

    await clickReady('library.pin')
    await waitFor(() => expect(onRetainSelection).toHaveBeenCalledWith(['b']))
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'warning', message: { key: 'library.batchPartial', params: { succeeded: 1, failed: 1 } } })
  })

  it('reports complete batch failure as an error and retains all failed items', async () => {
    selectionItems = [item('a'), item('b')]
    apiPatch.mockRejectedValue(new Error('failed'))
    const onRetainSelection = vi.fn()
    render(<SelectionBar selectedIds={['a', 'b']} onClear={vi.fn()} onRetainSelection={onRetainSelection} />, { wrapper })
    await clickReady('library.pin')
    await waitFor(() => expect(onRetainSelection).toHaveBeenCalledWith(['a', 'b']))
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: { key: 'library.batchFailed', params: { failed: 2 } } })
  })

  it('keeps trash actions separate from ordinary selection actions', () => {
    render(<SelectionBar selectedIds={['a']} onClear={vi.fn()} trash />, { wrapper })
    expect(screen.getByRole('button', { name: 'library.restore' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'library.permanentDelete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'library.batchOrganize' })).toBeNull()
  })
})
