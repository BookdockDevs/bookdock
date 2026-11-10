import type { ReactNode } from 'react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchSelectionItem } from '@bookdock/shared'

import SelectionBar from '../features/library/components/SelectionBar'
import { useToastStore } from '@/stores/toast.store'

const apiPatch = vi.fn()
const apiPost = vi.fn()
const apiDelete = vi.fn()
const invalidateDeviceMembershipQueries = vi.fn()
const vaultSelection = vi.fn()
const vaultTrash = vi.fn()
const vaultPurge = vi.fn()
let selectionItems: BatchSelectionItem[] = []
let tags: { id: string; name: string; bookCount: number; parentId?: string | null }[] = []
let categories: { id: string; name: string; bookCount: number; parentId?: string | null }[] = []

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
  // Batch permanent delete routes through the shared projection helper so
  // archive, reading records and interaction queries resync as well. The mock
  // factory replaces that module wholesale, so the export has to be
  // re-declared here or the call throws inside the component.
  invalidatePermanentlyDeletedBookQueries: vi.fn(),
  invalidateDeviceMembershipQueries: (...args: unknown[]) => invalidateDeviceMembershipQueries(...args),
  // A server-only selection never reaches the vault; the bar binds it at mount.
  useVaultOperations: () => ({
    selection: (...args: unknown[]) => vaultSelection(...args),
    updateSelection: async () => {},
    trash: (...args: unknown[]) => vaultTrash(...args),
    restore: async () => {},
    purge: (...args: unknown[]) => vaultPurge(...args),
    restoreSelection: async () => {},
    setReadStatus: async () => {},
    emptyTrash: async () => 0,
    readCatalog: async () => ({ books: [] }),
  }),
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
  vaultSelection.mockResolvedValue([])
  vaultTrash.mockResolvedValue({ deletedAt: 1, version: 1 })
  vaultPurge.mockResolvedValue(undefined)
  apiPost.mockImplementation((_url: string, body: { ids: string[] }) => Promise.resolve({
    data: body.ids.map((id) => selectionItems.find((row) => row.id === id)),
  }))
})

describe('SelectionBar', () => {
  it('shows a download label beside the batch download icon', () => {
    selectionItems = [item('a', { bookVersionId: 'version-a', title: 'A', format: 'epub' })]
    render(<SelectionBar selectedKeys={['server:a']} onClear={vi.fn()} />, { wrapper })

    expect(screen.getByText('library.download')).toBeVisible()
  })

  it('organizes works through the shared library in one request', async () => {
    selectionItems = [item('w1', { kind: undefined }), item('w2', { kind: undefined })]
    categories = [{ id: 'c1', name: '科幻', bookCount: 2 }]
    const onComplete = vi.fn()
    render(<SelectionBar selectedKeys={['server:w1', 'server:w2']} libraryId="lib1" onClear={vi.fn()} onComplete={onComplete} />, { wrapper })

    await clickReady('library.batchOrganize')
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/library.batchOrganize/)
    expect(screen.getByRole('button', { name: 'library.close' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('科幻'))
    fireEvent.click(screen.getByRole('button', { name: 'library.save' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(apiPatch).toHaveBeenCalledWith('/libraries/lib1/books/batch/organize', {
      ids: ['w1', 'w2'], categoryId: 'c1', addTagIds: [], removeTagIds: [],
    })
  })

  it('keeps mixed classification unchanged after selecting and resetting a target', async () => {
    selectionItems = [item('a', { categoryId: 'c1' }), item('b', { categoryId: 'c2' })]
    categories = [{ id: 'c1', name: 'Root', bookCount: 1, parentId: null }, { id: 'c2', name: 'Child', bookCount: 1, parentId: 'c1' }]
    tags = [{ id: 'tag', name: 'Topic', bookCount: 0 }]
    render(<SelectionBar selectedKeys={['server:a', 'server:b']} libraryId="lib1" onClear={vi.fn()} />, { wrapper })
    await clickReady('library.batchOrganize')
    expect(screen.getByText('Root / Child')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Root / Child'))
    fireEvent.click(screen.getByText('library.keepCategory'))
    fireEvent.click(screen.getByText('library.tags'))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'library.save' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/libraries/lib1/books/batch/organize', {
      ids: ['a', 'b'], addTagIds: ['tag'], removeTagIds: [],
    }))
  })

  it('adds a partially present tag to all selected entries without changing other tags', async () => {
    selectionItems = [item('a', { shelfId: 's1', categoryId: 'c1', tagIds: ['t1', 'other'] }), item('b', { shelfId: 's2', categoryId: 'c2', tagIds: [] })]
    tags = [{ id: 't1', name: '科幻', bookCount: 1 }]
    render(<SelectionBar selectedKeys={['server:a', 'server:b']} onClear={vi.fn()} />, { wrapper })

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

  it('keeps shelf and category selected by default and only unshelves when explicitly chosen', async () => {
    selectionItems = [item('a', { shelfId: 's1', categoryId: 'c1' })]
    categories = [{ id: 's1', name: 'Reading', bookCount: 1 }]
    render(<SelectionBar selectedKeys={['server:a']} onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchOrganize')
    expect(screen.getByRole('radio', { name: 'library.keepShelf' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'library.notOnShelf' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'library.save' })).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', { name: 'library.notOnShelf' }))
    fireEvent.click(screen.getByRole('button', { name: 'library.save' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/books/batch/organize', {
      ids: ['a'], shelfId: null, addTagIds: [], removeTagIds: [],
    }))
  })

  it('clears a category only after explicitly choosing uncategorized', async () => {
    selectionItems = [item('a', { categoryId: 'c1' })]
    categories = [{ id: 'c1', name: 'Mystery', bookCount: 1 }]
    render(<SelectionBar selectedKeys={['server:a']} onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchOrganize')
    fireEvent.click(screen.getByText('library.categories'))
    expect(screen.getByRole('radio', { name: 'library.keepCategory' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'library.uncategorized' }))
    fireEvent.click(screen.getByRole('button', { name: 'library.save' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/books/batch/organize', {
      ids: ['a'], categoryId: null, addTagIds: [], removeTagIds: [],
    }))
  })

  it('allows private recommendations and resets a recommendation to keep before an unrelated tag edit', async () => {
    selectionItems = [item('a', { categoryId: 'existing' })]
    tags = [{ id: 't1', name: 'Topic', bookCount: 0 }]
    render(<SelectionBar selectedKeys={['server:a']} onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchOrganize')
    fireEvent.click(screen.getByText('library.categories'))
    fireEvent.click(screen.getByText('library.recommendedCategories'))
    fireEvent.click(screen.getByRole('button', { name: /library\.expand.*web-fiction/ }))
    fireEvent.click(screen.getByRole('radio', { name: /library\.categoryTemplate\.web-fiction\.name \/ library\.categoryTemplate\.web-fiction\.mystery/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'library.keepCategory' }))
    fireEvent.click(screen.getByText('library.tags'))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'library.save' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/books/batch/organize', {
      ids: ['a'], addTagIds: ['t1'], removeTagIds: [],
    }))
  })

  it('does not offer private recommended categories in a shared library', async () => {
    selectionItems = [item('a', { kind: undefined })]
    render(<SelectionBar selectedKeys={['server:a']} libraryId="lib1" onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchOrganize')
    expect(screen.getByText('library.categories')).toBeInTheDocument()
    expect(screen.queryByText('library.recommendedCategories')).toBeNull()
  })

  it('closes the organize dialog on Escape', async () => {
    selectionItems = [item('a')]
    render(<SelectionBar selectedKeys={['server:a']} onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchOrganize')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('prevents edits, duplicate saves, and dismissal while a save is pending', async () => {
    selectionItems = [item('a')]
    let resolvePatch: (() => void) | undefined
    apiPatch.mockImplementationOnce(() => new Promise((resolve) => {
      resolvePatch = () => resolve({ data: null })
    }))
    const onComplete = vi.fn()
    render(<SelectionBar selectedKeys={['server:a']} onClear={vi.fn()} onComplete={onComplete} />, { wrapper })

    await clickReady('library.batchOrganize')
    fireEvent.click(screen.getByRole('radio', { name: 'library.notOnShelf' }))
    fireEvent.click(screen.getByRole('button', { name: 'library.save' }))
    expect(screen.getByRole('button', { name: 'library.save' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'library.close' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(apiPatch).toHaveBeenCalledTimes(1)

    resolvePatch?.()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('removes a tag only when every selected entry has it', async () => {
    selectionItems = [item('a', { tagIds: ['t1'] }), item('b', { tagIds: ['t1'] })]
    tags = [{ id: 't1', name: '科幻', bookCount: 2 }]
    render(<SelectionBar selectedKeys={['server:a', 'server:b']} onClear={vi.fn()} />, { wrapper })

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
    render(<SelectionBar selectedKeys={['server:a', 'server:b']} onClear={vi.fn()} onComplete={onComplete} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'library.readStatusLabel' }))
    fireEvent.click(screen.getByRole('button', { name: 'library.markFinished' }))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(apiPatch).toHaveBeenCalledWith('/books/a', { readStatus: 'finished' })
    expect(apiPatch).toHaveBeenCalledWith('/books/b', { readStatus: 'finished' })
  })

  it('pins a shared work instead of a version', async () => {
    selectionItems = [item('w1', { kind: undefined })]
    render(<SelectionBar selectedKeys={['server:w1']} libraryId="lib1" onClear={vi.fn()} />, { wrapper })

    await clickReady('library.pin')
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/libraries/lib1/books/w1', { pinned: true }))
  })

  it('uses one Delete action but explains and applies private A/B effects separately', async () => {
    selectionItems = [item('a'), item('b', { kind: 'shared' })]
    render(<SelectionBar selectedKeys={['server:a', 'server:b']} onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchDelete')
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('library.batchDeleteOwnedTrash')).toBeInTheDocument()
    expect(within(dialog).getByText('library.batchDeleteCollected')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('switch'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'library.batchDelete' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(2))
    expect(apiDelete).toHaveBeenCalledWith('/books/a?deleteUserData=true')
    expect(apiDelete).toHaveBeenCalledWith('/books/b?deleteUserData=true')
  })

  it('sends private trash batches through one undoable request and retains only failures', async () => {
    selectionItems = [item('a'), item('b')]
    apiPost.mockImplementation((url: string, body: { ids: string[] }) => url === '/books/batch/trash'
      ? Promise.resolve({ data: { succeeded: 1, failed: 1, failedIds: ['b'] }, undo: { token: 'receipt', label: 'undo.action' } })
      : Promise.resolve({ data: body.ids.map((id) => selectionItems.find((row) => row.id === id)) }))
    const onRetainSelection = vi.fn()
    render(<SelectionBar selectedKeys={['server:a', 'server:b']} trashEnabled onRetainSelection={onRetainSelection} />, { wrapper })

    await clickReady('library.batchDelete')
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'library.batchDelete' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/books/batch/trash', { ids: ['a', 'b'] }))
    expect(apiDelete).not.toHaveBeenCalled()
    expect(onRetainSelection).toHaveBeenCalledWith(['server:b'])
    expect(useToastStore.getState().toasts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'warning', message: { key: 'library.batchPartial', params: { action: 'library.batchActionDelete', succeeded: 1, failed: 1 } } }),
    ]))
  })

  it('counts all versions in shared-work deletion confirmation', async () => {
    selectionItems = [item('w1', { kind: undefined, versionCount: 3 })]
    render(<SelectionBar selectedKeys={['server:w1']} libraryId="lib1" onClear={vi.fn()} />, { wrapper })

    await clickReady('library.batchDelete')
    expect(screen.getByText('library.batchDeleteSharedTrash')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'library.batchDelete' }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/libraries/lib1/books/w1'))
  })

  it.each([true, false])('offers personal cleanup for owned books with trash enabled: %s', async (trashEnabled) => {
    selectionItems = [item('owned')]
    render(<SelectionBar selectedKeys={['server:owned']} trashEnabled={trashEnabled} onClear={vi.fn()} />, { wrapper })
    await clickReady('library.batchDelete')
    const dialog = screen.getByRole('alertdialog')
    const option = within(dialog).getByRole('switch', { name: 'library.clearUserDataOnRemove' })
    expect(option).toHaveAttribute('aria-checked', 'false')
    expect(within(dialog).getByText(trashEnabled ? 'library.clearUserDataOnRemoveDescription' : 'library.clearUserDataOnRemoveImmediate')).toBeInTheDocument()
    fireEvent.click(option)
    fireEvent.click(within(dialog).getByRole('button', { name: 'library.batchDelete' }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/books/owned?deleteUserData=true'))
  })

  it('keeps only failed identities selected after a partial update', async () => {
    selectionItems = [item('a'), item('b')]
    apiPatch.mockResolvedValue({ data: { succeeded: 1, failed: 1, failedIds: ['b'] } })
    const onRetainSelection = vi.fn()
    render(<SelectionBar selectedKeys={['server:a', 'server:b']} onClear={vi.fn()} onRetainSelection={onRetainSelection} />, { wrapper })

    await clickReady('library.pin')
    expect(apiPatch).toHaveBeenCalledWith('/books/batch/update', { ids: ['a', 'b'], pinned: true })
    await waitFor(() => expect(onRetainSelection).toHaveBeenCalledWith(['server:b']))
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'warning', message: { key: 'library.batchPartial', params: { succeeded: 1, failed: 1 } } })
  })

  it('reports complete batch failure as an error and retains all failed items', async () => {
    selectionItems = [item('a'), item('b')]
    apiPatch.mockRejectedValue(new Error('failed'))
    const onRetainSelection = vi.fn()
    render(<SelectionBar selectedKeys={['server:a', 'server:b']} onClear={vi.fn()} onRetainSelection={onRetainSelection} />, { wrapper })
    await clickReady('library.pin')
    await waitFor(() => expect(onRetainSelection).toHaveBeenCalledWith(['server:a', 'server:b']))
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: { key: 'library.batchFailed', params: { failed: 2 } } })
  })

  it('keeps trash actions separate from ordinary selection actions', () => {
    render(<SelectionBar selectedKeys={['server:a']} onClear={vi.fn()} trash />, { wrapper })
    expect(screen.getByRole('button', { name: 'library.restore' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'library.permanentDelete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'library.batchOrganize' })).toBeNull()
  })

  it('permanently deletes a server-only trash selection without a selection query', async () => {
    // Trash mode skips the batch-selection query, so the dialog cannot depend on
    // its rows; the scope-qualified key already names the owner.
    apiDelete.mockResolvedValue({ data: null })
    render(<SelectionBar selectedKeys={['server:a', 'server:b']} onClear={vi.fn()} trash />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'library.permanentDelete' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'library.permanentDelete' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/books/a/permanent'))
    expect(apiDelete).toHaveBeenCalledWith('/books/b/permanent')
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'success',
      message: { key: 'library.batchPermanentDeleteSucceeded', params: { count: 2 } },
    })
  })

  it('retains scope-qualified selection keys after a partial permanent delete failure', async () => {
    selectionItems = [item('a', { title: 'Server A' })]
    vaultSelection.mockResolvedValue([
      {
        ...item('b', {
          title: 'Local B',
          ref: { scope: { kind: 'local', vaultId: 'device' }, bookId: 'b' },
          clientVersion: 1,
        }),
      },
    ])
    apiDelete.mockRejectedValueOnce(new Error('server error'))
    const onRetainSelection = vi.fn()
    render(
      <SelectionBar
        selectedKeys={['server:a', 'local:b']}
        onClear={vi.fn()}
        onRetainSelection={onRetainSelection}
        trash
      />,
      { wrapper },
    )

    await clickReady('library.permanentDelete')
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'library.permanentDelete' }))

    await waitFor(() => expect(onRetainSelection).toHaveBeenCalledWith(['server:a']))
    expect(invalidateDeviceMembershipQueries).toHaveBeenCalled()
  })

  it('omits partial undo and invalidates device membership on mixed-authority batch hide', async () => {
    selectionItems = [item('a', { title: 'Server A', hidden: false })]
    vaultSelection.mockResolvedValue([
      item('b', {
        title: 'Local B',
        ref: { scope: { kind: 'local', vaultId: 'device' }, bookId: 'b' },
        hidden: false,
        clientVersion: 1,
      }),
    ])
    apiPost.mockResolvedValue({ data: selectionItems })
    apiPatch.mockResolvedValue({ data: { succeeded: 1, failed: 0, failedIds: [] }, undo: { kind: 'books-batch', token: 'u1' } })

    render(<SelectionBar selectedKeys={['server:a', 'local:b']} onClear={vi.fn()} onComplete={vi.fn()} />, { wrapper })

    await clickReady('library.hide')
    await waitFor(() => expect(invalidateDeviceMembershipQueries).toHaveBeenCalled())
    const successToast = useToastStore.getState().toasts.find((toast) => toast.type === 'success')
    expect(successToast).toBeDefined()
    expect(successToast?.action).toBeUndefined()
  })
})
