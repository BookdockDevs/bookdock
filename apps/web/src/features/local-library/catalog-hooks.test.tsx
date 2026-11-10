import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import { apiGet, apiPost, apiPut } from '@/api/client'
import { hasUndoOpportunity, runUndo } from '@/lib/undo'
import { useUiStore } from '@/stores/ui.store'
import i18n from '@/i18n/i18n'

import { useBook, useBooks, useCreateLibraryCategory, useCreateShelf, useDeleteBook, useLibraries, useLibraryCategories, useLibraryPrefsState, useShelves, useTrashEnabled, useUpdateBook, useUpdateLibraryPrefs, useUploadCover } from '../library/hooks'
import { useToastStore } from '@/stores/toast.store'
import { CatalogSourceContext } from '../reading-data/catalog-source-context'
import { useCatalogRevealHidden } from '../reading-data/useCatalogRevealHidden'
import BookCardShell from '../library/components/BookCardShell'
import SelectionBar from '../library/components/SelectionBar'
import { privateBookRow } from '../library/book-row'
import { localCatalogOperations } from './catalog'
import { localCatalogBookView } from './catalog-view'
import { LocalLibraryRepository } from './repository'

vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/stores/auth.store', () => {
  const authState = { user: null }
  const useAuthStoreMock = (selector: (state: unknown) => unknown) => selector(authState)
  useAuthStoreMock.getState = () => authState
  useAuthStoreMock.subscribe = () => () => {}
  return { useAuthStore: useAuthStoreMock, getAuthSessionRevision: () => 0 }
})

const scope = { kind: 'local' as const, vaultId: 'device' }
const ref = { scope, bookId: 'local-book' }
const book: ClientBook = { ref, title: 'Device book', authors: ['Author'], format: 'epub', content: { book: ref, contentId: 'content' }, availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0 }
let repository: LocalLibraryRepository
let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}><CatalogSourceContext.Provider value={{ scope, operations: localCatalogOperations(scope, repository) }}>{children}</CatalogSourceContext.Provider></QueryClientProvider>
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile)
  vi.mocked(apiGet).mockReset(); vi.mocked(apiPost).mockReset(); vi.mocked(apiPut).mockReset()
  useUiStore.setState({ revealHidden: false })
  repository = new LocalLibraryRepository('catalog-hooks')
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { cleanup(); client.clear(); await repository.close(); vi.unstubAllGlobals() })

describe('common catalog hooks with local authority', () => {
  it('offers the original undo notification with a vault-owned versioned restore', async () => {
    useToastStore.getState().clearToasts()
    const { result } = renderHook(() => useDeleteBook(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ id: ref.bookId, title: book.title, ref }) })
    const toast = useToastStore.getState().toasts.find((item) => item.action?.icon === 'undo')!
    expect(toast).toBeDefined()
    act(() => toast.action!.onClick())
    await waitFor(async () => expect((await repository.getBook(ref)).deletedAt).toBeNull())
    expect(await (await repository.getFile(ref)).text()).toBe('abc')
    expect(apiPost).not.toHaveBeenCalled()
    useToastStore.getState().clearToasts()
  })

  it('maps a stale local restore version to the shared undo conflict message', async () => {
    useToastStore.getState().clearToasts()
    const { result } = renderHook(() => useDeleteBook(), { wrapper })
    const { localRestore } = await act(async () => await result.current.mutateAsync({ id: ref.bookId, title: book.title, ref }))
    await repository.updateMetadata(ref, { catalog: { hidden: true } }, localRestore!.version)
    await act(async () => { await runUndo() })
    expect((await repository.getBook(ref)).deletedAt).toBeTypeOf('number')
    expect(useToastStore.getState().toasts.map((toast) => (toast.message as { key?: string }).key)).toContain('undo.conflict')
    useToastStore.getState().clearToasts()
  })

  it.each(['restore', 'permanent'] as const)('routes local batch trash %s through the original selection controls', async (action) => {
    await repository.trashBook(ref)
    const complete = vi.fn()
    render(<SelectionBar selectedKeys={['local:' + ref.bookId]} onClear={complete} trash={true} trashEnabled={true} />, { wrapper })
    const label = action === 'restore' ? 'library.restore' : 'library.permanentDelete'
    const button = screen.getByRole('button', { name: i18n.t(label) })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    if (action === 'permanent') fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: i18n.t('library.permanentDelete') }))
    await waitFor(() => expect(complete).toHaveBeenCalled())
    if (action === 'restore') expect(await (await repository.getFile(ref)).text()).toBe('abc')
    else expect(await repository.getBook(ref)).toMatchObject({ availability: 'removed', catalogRemoved: true })
    expect(apiPost).not.toHaveBeenCalled(); expect(apiGet).not.toHaveBeenCalled(); expect(apiPut).not.toHaveBeenCalled()
  })

  it.each(['pin', 'organize', 'delete'] as const)('keeps local batch %s and its invalidations separate from remote caches', async (action) => {
    const source = localCatalogOperations(scope, repository)
    const shelf = await source.createOrganization('shelf', 'Device shelf')
    for (const key of [['books'], ['shelves'], ['tags'], ['batch-selection'], ['reading-records']]) client.setQueryData(key, { remote: true })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const complete = vi.fn()
    render(<SelectionBar selectedKeys={['local:' + ref.bookId]} onClear={complete} trashEnabled={true} />, { wrapper })
    const label = action === 'pin' ? 'library.pin' : action === 'organize' ? 'library.batchOrganize' : 'library.batchDelete'
    const button = screen.getByRole('button', { name: i18n.t(label) })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    if (action === 'organize') {
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(await within(dialog).findByText('Device shelf'))
      fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('library.save') }))
    } else if (action === 'delete') {
      fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: i18n.t('library.batchDelete') }))
    }
    await waitFor(() => expect(complete).toHaveBeenCalled())
    if (action === 'pin') expect((await repository.getBook(ref)).catalog?.pinnedAt).toBeTypeOf('number')
    if (action === 'organize') expect((await repository.getBook(ref)).catalog?.shelfId).toBe(shelf.id)
    if (action === 'delete') {
      expect((await repository.getBook(ref)).deletedAt).toBeTypeOf('number')
      expect(hasUndoOpportunity()).toBe(true)
      await act(async () => { await runUndo() })
      expect((await repository.getBook(ref)).deletedAt).toBeNull()
      useToastStore.getState().clearToasts()
    }
    expect(invalidate).toHaveBeenCalled()
    expect(invalidate.mock.calls.every(([filters]) => filters?.queryKey?.[0] === 'client-catalog')).toBe(true)
    for (const key of [['books'], ['shelves'], ['tags'], ['batch-selection'], ['reading-records']]) {
      expect(client.getQueryData(key)).toEqual({ remote: true })
      expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    }
    expect(apiGet).not.toHaveBeenCalled(); expect(apiPost).not.toHaveBeenCalled(); expect(apiPut).not.toHaveBeenCalled()
    invalidate.mockRestore()
  })

  it('keeps hidden-content visibility source-owned and serializes rapid toggles', async () => {
    await repository.updateMetadata(ref, { catalog: { hidden: true } }, 0)
    const { result } = renderHook(() => {
      const reveal = useCatalogRevealHidden()
      const books = useBooks({ page: 1, pageSize: 24, search: '', sortBy: 'title', sortOrder: 'asc', shelfId: null, tagId: null, format: null, readStatus: null, trash: false, showHidden: reveal.revealHidden })
      return { reveal, books }
    }, { wrapper })
    await waitFor(() => expect(result.current.books.data?.total).toBe(0))
    await act(async () => { await result.current.reveal.toggle() })
    await waitFor(() => expect(result.current.books.data?.total).toBe(1))
    expect(useUiStore.getState().revealHidden).toBe(false)
    await act(async () => { await Promise.all([result.current.reveal.toggle(), result.current.reveal.toggle()]) })
    expect((await repository.getCatalogPreferences(scope.vaultId)).showHidden).toBe(true)
    expect((await repository.getCatalogPreferences('another-vault')).showHidden).toBeUndefined()
    expect(apiGet).not.toHaveBeenCalled(); expect(apiPut).not.toHaveBeenCalled()
  })

  it('loads the common list and real detail without an account or remote file fields', async () => {
    const { result } = renderHook(() => ({
      books: useBooks({ page: 1, pageSize: 24, search: '', sortBy: 'title', sortOrder: 'asc', shelfId: null, tagId: null, format: null, readStatus: null, trash: false }),
      detail: useBook(ref.bookId), libraries: useLibraries(), trash: useTrashEnabled(),
    }), { wrapper })
    await waitFor(() => expect(result.current.books.isSuccess && result.current.detail.isSuccess).toBe(true))
    expect(result.current.books.data?.data[0]).toMatchObject({ ref, title: 'Device book', size: 3, progress: null })
    expect(result.current.detail.data?.data).not.toHaveProperty('filePath')
    expect(result.current.detail.data?.data.revisionId).toBe('content')
    expect(result.current.trash).toBe(true)
    expect(apiGet).not.toHaveBeenCalled()
  })

  it('creates source-owned shelves and categories through the existing mutation hooks', async () => {
    client.setQueryData(['shelves'], { data: [{ id: 'remote-shelf' }] })
    const { result } = renderHook(() => ({ shelves: useShelves(), categories: useLibraryCategories(null), createShelf: useCreateShelf(), createCategory: useCreateLibraryCategory() }), { wrapper })
    await waitFor(() => expect(result.current.shelves.isSuccess).toBe(true))
    await act(async () => { await result.current.createShelf.mutateAsync('Local shelf'); await result.current.createCategory.mutateAsync({ libraryId: null, name: 'Local category' }) })
    await waitFor(() => expect(result.current.shelves.data?.data).toHaveLength(1))
    await waitFor(() => expect(result.current.categories.data?.data).toHaveLength(1))
    expect(result.current.shelves.data?.data[0]).not.toHaveProperty('userId')
    expect(result.current.categories.data?.data[0]).not.toHaveProperty('libraryId')
    expect(client.getQueryData(['shelves'])).toEqual({ data: [{ id: 'remote-shelf' }] })
    expect(client.getQueryState(['shelves'])?.isInvalidated).toBe(false)
    expect(apiGet).not.toHaveBeenCalled(); expect(apiPost).not.toHaveBeenCalled()
  })

  it('stores local library preferences without changing the connected account settings cache', async () => {
    const remoteSettings = { data: { library: { view: 'grid' } } }
    client.setQueryData(['settings'], remoteSettings)
    const { result } = renderHook(() => ({ prefs: useLibraryPrefsState(), update: useUpdateLibraryPrefs() }), { wrapper })
    await waitFor(() => expect(result.current.prefs.isReady).toBe(true))
    await act(async () => { await result.current.update.mutateAsync({ view: 'list', gridCardFields: ['title'] }) })
    await waitFor(() => expect(result.current.prefs.prefs?.view).toBe('list'))
    await repository.close()
    expect(await repository.getCatalogPreferences(scope.vaultId)).toEqual({ view: 'list', gridCardFields: ['title'] })
    expect(client.getQueryData(['settings'])).toEqual(remoteSettings)
    expect(apiGet).not.toHaveBeenCalled(); expect(apiPut).not.toHaveBeenCalled()
  })

  it('keeps metadata and cover writes local and refuses stale displayed versions', async () => {
    const { result } = renderHook(() => ({ detail: useBook(ref.bookId), update: useUpdateBook(), upload: useUploadCover() }), { wrapper })
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true))
    await act(async () => { await result.current.update.mutateAsync({ bookId: ref.bookId, ref, expectedVersion: 0, title: 'Edited locally', bookmeta: { publisher: 'Local publisher' } }) })
    await waitFor(() => expect(result.current.detail.data?.data.title).toBe('Edited locally'))
    expect(result.current.detail.data?.data.meta.bookmeta?.publisher).toBe('Local publisher')
    await act(async () => { await expect(result.current.update.mutateAsync({ bookId: ref.bookId, ref, expectedVersion: 0, title: 'Stale overwrite' })).rejects.toMatchObject({ category: 'conflict' }) })
    expect((await repository.getBook(ref)).title).toBe('Edited locally')
    const file = new File(['image'], 'cover.png', { type: 'image/png' })
    await act(async () => { await result.current.upload.mutateAsync({ bookId: ref.bookId, file, expectedVersion: 1 }) })
    expect((await repository.getCover(ref))?.size).toBe(5)
    expect((await repository.getBook(ref)).version).toBe(2)
    expect(apiGet).not.toHaveBeenCalled(); expect(apiPost).not.toHaveBeenCalled(); expect(apiPut).not.toHaveBeenCalled()
  })

  it('uses the common cover placeholder and releases source-owned image URLs', async () => {
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    const create = vi.fn(() => 'blob:local-cover')
    const revoke = vi.fn()
    URL.createObjectURL = create; URL.revokeObjectURL = revoke
    try {
      const view = localCatalogBookView(book, null, { version: 0, items: [] })
      const card = render(<BookCardShell row={privateBookRow(view)} />, { wrapper })
      await waitFor(() => expect(client.isFetching()).toBe(0))
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(apiGet).not.toHaveBeenCalled()
      await act(async () => {
        await repository.updateMetadata(ref, {}, 0, new Blob(['cover'], { type: 'image/png' }))
        await client.invalidateQueries({ queryKey: ['client-catalog'] })
      })
      await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:local-cover'))
      card.unmount()
      expect(revoke).toHaveBeenCalledWith('blob:local-cover')
      expect(apiGet).not.toHaveBeenCalled()
    } finally {
      URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke
    }
  })
})
