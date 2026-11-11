import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload } from '@/api/client'
import { INSTANCE_QUERY_KEY, ME_QUERY_KEY } from '@/features/auth/hooks'

// The unified routes run the app-level session probe (/auth/me); zero-traffic
// assertions exempt /auth/* while still forbidding any book/record/library traffic.
function expectNoBookTraffic() {
  expect(apiGet.mock.calls.filter(([path]) => !String(path).startsWith('/auth')).length).toBe(0)
  expect(apiPost.mock.calls.length).toBe(0)
  expect(apiPut.mock.calls.length).toBe(0)
  expect(apiDelete.mock.calls.length).toBe(0)
  expect(apiUpload.mock.calls.length).toBe(0)
}

import i18n from '@/i18n/i18n'
import { useLibrarySearchAuthors } from '@/features/library/hooks'
import { VaultAvailabilityContext } from '@/features/reading-data/vault-availability'
import { queryClient } from '@/lib/query-client'
import { router } from '@/router'
import { useAuthStore } from '@/stores/auth.store'

import { localLibraryRepository as repository } from './repository'
import { processLocalEpub } from './epub-editor'
import { processEpubInWorker } from './epub-editor-worker'
import { prepareEditedLocalTxt, prepareLocalTxt } from './prepare-txt'
import { prepareEditedTxtInWorker, prepareTxtInWorker } from './prepare-txt-worker'

vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn(), apiUpload: vi.fn() }))
vi.mock('./epub-editor-worker', () => ({ processEpubInWorker: vi.fn() }))
vi.mock('./prepare-txt-worker', () => ({ prepareTxtInWorker: vi.fn(), prepareEditedTxtInWorker: vi.fn() }))

const ref = { scope: { kind: 'local' as const, vaultId: 'device' }, bookId: 'same-id' }
const book: ClientBook = { ref, title: 'Device-owned book', authors: ['Author'], format: 'epub', content: { book: ref, contentId: 'content' }, availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0 }

beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('File', NativeFile)
  vi.stubGlobal('XMLHttpRequest', vi.fn(() => { throw new Error('Local book data must not be uploaded') }))
  vi.mocked(prepareTxtInWorker).mockImplementation(async (file, title, contentId, signal) => { signal.throwIfAborted(); return prepareLocalTxt(file, file.name, title, contentId) })
  vi.mocked(prepareTxtInWorker).mockClear()
  vi.mocked(prepareEditedTxtInWorker).mockReset().mockImplementation(async (draft, fileName, title, contentId, signal) => { signal.throwIfAborted(); return prepareEditedLocalTxt(draft, fileName, title, contentId) })
  vi.mocked(processEpubInWorker).mockReset().mockImplementation((input, signal) => processLocalEpub(input.file, signal, input.draft))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  localStorage.clear()
  useAuthStore.setState({ user: null })
  queryClient.clear()
  for (const method of [apiGet, apiPost, apiPut, apiPatch, apiDelete, apiUpload]) vi.mocked(method).mockReset()
  // The vault gate reads instance guest policy; seeding keeps the offline
  // assertions (zero API traffic) meaningful while the gate stays satisfied.
  queryClient.setQueryData(INSTANCE_QUERY_KEY, { data: { initialized: true, registrationMode: 'closed', allowRegistration: false, allowGuestAccess: true, uploadMaxBytes: 104857600 } })
  // The unified routes run the session probe; seed a guest /auth/me so the
  // zero-traffic offline assertions stay meaningful.
  queryClient.setQueryData(ME_QUERY_KEY, { data: { user: null, guest: true } })
  await i18n.changeLanguage('zh-CN')
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { cleanup(); queryClient.clear(); await repository.close(); onlineManager.setOnline(true); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function openLibrary() {
  router.update({ history: createMemoryHistory({ initialEntries: ['/'] }) })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
  return screen.findByRole('heading', { name: book.title })
}

describe('the existing library screen with local authority', () => {
  it('restores a local book through the original trash grid while offline without a Server request', async () => {
    await repository.trashBook(ref)
    onlineManager.setOnline(false)
    router.update({ history: createMemoryHistory({ initialEntries: ['/?trash=true'] }) })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    const restore = await screen.findByRole('button', { name: i18n.t('library.restore'), exact: true }, { timeout: 10000 })
    expect(router.state.location.search.trash).toBe(true)
    expect(await screen.findByRole('heading', { name: book.title })).toBeInTheDocument()
    fireEvent.click(restore)
    await waitFor(async () => expect((await repository.getBook(ref)).deletedAt).toBeNull())
    expect(await (await repository.getFile(ref)).text()).toBe('abc')
    await waitFor(() => expect(screen.queryByRole('heading', { name: book.title })).toBeNull())
    for (const method of [apiGet, apiPost, apiPut, apiPatch, apiDelete, apiUpload]) expect(method).not.toHaveBeenCalled()
  }, 15000)

  it('opens actual EPUB in the same content workbench without a Server content request', async () => {
    const epubRef = { ...ref, bookId: 'editable-epub' }
    const prepared = await prepareLocalTxt(new Blob(['Chapter 1\n\nLocal EPUB body.']), 'source.txt', 'EPUB book', 'before')
    await repository.addBook({ ...book, ref: epubRef, title: 'EPUB book', content: { book: epubRef, contentId: 'before' } }, prepared.publication)
    onlineManager.setOnline(false)
    router.update({ history: createMemoryHistory({ initialEntries: ['/books/editable-epub/editor'] }) })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    await waitFor(() => expect(processEpubInWorker).toHaveBeenCalled(), { timeout: 10000 })
    expect(await screen.findByRole('button', { name: i18n.t('editor.save') })).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('localLibrary.contentEditingUnavailable'))).toBeNull()
    for (const method of [apiGet, apiPost, apiPut, apiPatch, apiDelete, apiUpload]) expect(method).not.toHaveBeenCalled()
  }, 15000)

  it('keeps anonymous local settings and library preferences on the common surface without probing account resources', async () => {
    onlineManager.setOnline(false)
    router.update({ history: createMemoryHistory({ initialEntries: ['/settings'] }) })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    // The pending skeleton shares the page heading; wait for the real section
    // content so the lazy route component has settled before asserting.
    expect(await screen.findByRole('switch', { name: i18n.t('settings.prefReadingStats') }, { timeout: 10000 })).toBeInTheDocument()
    onlineManager.setOnline(true)
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('settings.reading'), exact: true }))
    expect(await screen.findByRole('button', { name: i18n.t('settings.replacementsNew') })).toBeInTheDocument()

    expectNoBookTraffic()
  }, 15000)

  it('edits local TXT in the existing content workbench anonymously and offline without uploading its body', async () => {
    const txtRef = { ...ref, bookId: 'editable-txt' }
    const original = new Blob(['Chapter 1\n\nOriginal body.'])
    const prepared = await prepareLocalTxt(original, 'Original.txt', 'Text book', 'before-edit')
    await repository.addBook({ ...book, ref: txtRef, title: 'Text book', format: 'txt', content: { book: txtRef, contentId: 'before-edit' }, textSource: prepared.source }, original, undefined, prepared)
    onlineManager.setOnline(false)
    router.update({ history: createMemoryHistory({ initialEntries: ['/books/editable-txt/editor'] }) })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    const body = await screen.findByRole('textbox', { name: '章节正文' }, { timeout: 10000 })
    await waitFor(() => expect(body).toHaveValue('Original body.'))
    fireEvent.change(body, { target: { value: 'Edited on this device.' } })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('editor.save') }))
    await waitFor(async () => expect((await repository.getBook(txtRef)).content?.contentId).not.toBe('before-edit'))
    const saved = await repository.getBook(txtRef)
    expect(await repository.getNormalizedTxt(txtRef, saved.content!.contentId)).toContain('Edited on this device.')
    expect(await (await repository.getFile(txtRef)).text()).toContain('Edited on this device.')
    expect(prepareEditedTxtInWorker).toHaveBeenCalledOnce()
    for (const method of [apiGet, apiPost, apiPut, apiPatch, apiDelete, apiUpload]) expect(method).not.toHaveBeenCalled()
  }, 15000)
  it('opens local reading data through the existing view without entering a same-ID server page', async () => {
    await openLibrary()
    const article = screen.getByRole('heading', { name: book.title }).closest('article')!
    fireEvent.click(within(article).getByRole('button', { name: i18n.t('library.moreActions') }))
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('library.details') }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: i18n.t('readingData.data') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/archive'))
    expect(await screen.findByRole('tab', { name: i18n.t('readingData.viewData') }, { timeout: 10000 })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('tab', { name: i18n.t('readingData.viewNotes') })).toBeInTheDocument()
    expectNoBookTraffic()
  }, 15000)

  it('opens the existing global archive and single-book data anonymously while offline', async () => {
    onlineManager.setOnline(false)
    await repository.addReadingEntry({ capture: { book: ref, requestId: 'entry', source: 'retroactive', date: '2026-11-07', startedAt: null, durationSeconds: 90 }, finished: false })
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    router.update({ history: createMemoryHistory({ initialEntries: ['/archive?period=all&view=overview'] }) })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    expect(await screen.findByRole('heading', { name: i18n.t('archive.title') }, { timeout: 10000 })).toBeInTheDocument()
    const bookLink = await screen.findAllByRole('link', { name: new RegExp(book.title) }, { timeout: 10000 })
    fireEvent.click(bookLink[0]!)
    await waitFor(() => expect(router.state.location.pathname).toBe('/archive'))
    await waitFor(() => expect(router.state.location.search.bookId).toBe(ref.bookId))
    expect(await screen.findByRole('tab', { name: i18n.t('readingData.viewData') }, { timeout: 10000 })).toHaveAttribute('aria-selected', 'true')
    for (const method of [apiGet, apiPost, apiPut, apiPatch, apiDelete, apiUpload]) expect(method).not.toHaveBeenCalled()
  }, 15000)

  it('adds a TXT file through the existing queue and offers local reading without HTTP upload', async () => {
    await openLibrary()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('localLibrary.add') }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(dialog.querySelector('input[type="file"]')!, { target: { files: [new File(['Chapter 1\n\nDevice text.'], 'New local.txt')] } })
    fireEvent.click(await within(dialog).findByRole('button', { name: i18n.t('localLibrary.addAction') }))
    await waitFor(async () => expect((await repository.listBooks('device')).some((row) => row.title === 'New local' && row.format === 'txt')).toBe(true))
    expect(await within(dialog).findByRole('button', { name: i18n.t('library.startReading') })).toBeEnabled()
    expect(prepareTxtInWorker).toHaveBeenCalledOnce()
    expect(XMLHttpRequest).not.toHaveBeenCalled()
    expectNoBookTraffic()
  })

  it('renders the main navigation, cards and add dialog without server setup or an account', async () => {
    await openLibrary()
    // Where a book lives is not a filter, a mode or a switch: the shelf
    // carries no source control at all.
    expect(screen.queryByRole('combobox', { name: '切换书库来源' })).toBeNull()
    expect(screen.queryByRole('button', { name: '本地' })).toBeNull()
    expect(screen.queryByRole('button', { name: '服务器' })).toBeNull()
    const cardLink = screen.getByRole('heading', { name: book.title }).closest('a')
    expect(cardLink).toHaveAttribute('href', '/books/same-id')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('localLibrary.add') }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('input[type="file"]')).not.toBeNull()
    expect(within(dialog).queryByText(i18n.t('settings.storageBackendConnectionAddNew'))).not.toBeInTheDocument()
    expectNoBookTraffic()
  })

  it('keeps the destructive actions reachable on a guest device card', async () => {
    await openLibrary()
    const article = screen.getByRole('heading', { name: book.title }).closest('article')!
    fireEvent.click(within(article).getByRole('button', { name: i18n.t('library.moreActions') }))
    // A device row belongs to whoever holds the browser: no account is needed
    // to pin, hide or delete it. Gating these on the session made the card
    // read-only for guests, which is why the menu is asserted entry by entry.
    expect(await screen.findByRole('button', { name: i18n.t('library.pin') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('library.delete') })).toBeInTheDocument()
    expectNoBookTraffic()
  })

  it('reads the trash retention from the vault instead of the account settings', async () => {
    await repository.trashBook(ref)
    router.update({ history: createMemoryHistory({ initialEntries: ['/?trash=true'] }) })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    expect(await screen.findByRole('button', { name: i18n.t('library.restore'), exact: true }, { timeout: 10000 })).toBeInTheDocument()
    // /settings answers 401 to a guest and the unauthorized handler bounces the
    // page to /login, so the badge must resolve its window from the vault.
    expect(screen.getByTitle(i18n.t('library.trashDeletedDays', { days: 0 }))).toBeInTheDocument()
    expectNoBookTraffic()
  }, 15000)

  it('edits a device book through the existing detail form and preserves it on reopen', async () => {
    const remote = { data: { title: 'Remote cached book' } }
    queryClient.setQueryData(['books', 'detail', book.ref.bookId], remote)
    await openLibrary()
    const article = screen.getByRole('heading', { name: book.title }).closest('article')!
    fireEvent.click(within(article).getByRole('button', { name: i18n.t('library.moreActions') }))
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('library.details') }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: i18n.t('library.edit') }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: i18n.t('library.sortBy.title') }), { target: { value: 'Edited device book' } })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('library.save') })) })
    await waitFor(async () => expect((await repository.getBook(ref)).title).toBe('Edited device book'))
    expect(queryClient.getQueryData(['books', 'detail', book.ref.bookId])).toEqual(remote)
    cleanup(); queryClient.clear()
    queryClient.setQueryData(INSTANCE_QUERY_KEY, { data: { initialized: true, registrationMode: 'closed', allowRegistration: false, allowGuestAccess: true, uploadMaxBytes: 104857600 } })
  // The unified routes run the session probe; seed a guest /auth/me so the
  // zero-traffic offline assertions stay meaningful.
  queryClient.setQueryData(ME_QUERY_KEY, { data: { user: null, guest: true } })
    await repository.close()
    router.update({ history: createMemoryHistory({ initialEntries: ['/'] }) })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)
    expect(await screen.findByRole('heading', { name: 'Edited device book' })).toBeVisible()
    expect((await repository.getFile(ref)).size).toBe(3)
    expectNoBookTraffic()
  }, 15000)

  it('toggles visibility on a guest device book via vault without PATCHing the server', async () => {
    await openLibrary()
    const article = screen.getByRole('heading', { name: book.title }).closest('article')!
    fireEvent.click(within(article).getByRole('button', { name: i18n.t('library.moreActions') }))
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('library.details') }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByRole('button', { name: i18n.t('library.privateVisibleAction') }))
    await waitFor(async () => expect((await repository.getBook(ref)).catalog?.hidden).toBe(true))
    expect(apiPatch).not.toHaveBeenCalled()
    expectNoBookTraffic()
  }, 15000)

  it('includes local device authors in search suggestions for vault-capable guests', async () => {
    const { result } = renderHook(() => useLibrarySearchAuthors(null, false, false, { enabled: true }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>
          <VaultAvailabilityContext.Provider value={true}>{children}</VaultAvailabilityContext.Provider>
        </QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current.data?.data).toEqual(['Author']))
    expectNoBookTraffic()
  })

  it('shows read-only device storage status and guest vault upload/trash settings without probing /settings', async () => {
    router.update({ history: createMemoryHistory({ initialEntries: ['/settings'] }) })
    render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)

    expect(await screen.findByText(i18n.t('settings.deviceStorageTitle'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.library') }))
    expect(await screen.findByText(i18n.t('settings.bookTitleNormalize'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.trash'))).toBeInTheDocument()
    expect(apiGet.mock.calls.filter(([path]) => String(path) === '/settings')).toHaveLength(0)
  }, 15000)

  it('excludes read-only server books from guest multi-select', async () => {
    const serverBook = {
      id: 'srv-1',
      title: 'Server guest book',
      author: 'Remote Author',
      authors: ['Remote Author'],
      format: 'epub',
      coverKey: null,
      size: 100,
      readStatus: 'unread',
      categoryId: null,
      progress: 0,
      createdAt: 1,
      updatedAt: 1,
      guestReadable: true,
    }

    await openLibrary()
    act(() => {
      const unifiedQuery = queryClient.getQueryCache().findAll({ queryKey: ['books'] }).find((q) => q.queryKey.at(-1) === 'unified')
      expect(unifiedQuery).toBeDefined()
      queryClient.setQueryData(unifiedQuery!.queryKey, (old: { data: unknown[]; total: number } | undefined) => ({
        ...old,
        data: [serverBook, ...(old?.data ?? [])],
        total: (old?.total ?? 0) + 1,
      }))
    })
    expect(await screen.findByRole('heading', { name: 'Server guest book' })).toBeInTheDocument()
    const deviceCard = screen.getByRole('heading', { name: book.title }).closest('article')!
    const serverCard = screen.getByRole('heading', { name: 'Server guest book' }).closest('article')!
    expect(within(deviceCard).getByRole('img', { name: i18n.t('library.bookSourceLocal') })).toBeInTheDocument()
    expect(within(serverCard).queryByRole('img', { name: i18n.t('library.bookSourceLocal') })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('library.selectMode') }))
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })

    await waitFor(() => expect(screen.getByText(i18n.t('library.selectionCount', { count: 1 }))).toBeInTheDocument())
    // Clicking the read-only server card while selection is active must not select it.
    fireEvent.click(screen.getByRole('heading', { name: 'Server guest book' }))
    expect(screen.getByText(i18n.t('library.selectionCount', { count: 1 }))).toBeInTheDocument()
  }, 15000)
})
