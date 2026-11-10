import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import { LocalReaderContext } from '../reading-data/reader-source-context'
import StatsPanel from '../reader/components/StatsPanel'
import { useAuthStore } from '@/stores/auth.store'
import LocalCatalogProvider from './LocalCatalogProvider'
import { openLocalReaderSession } from './reader-session'
import { localLibraryRepository as repository } from './repository'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
const ref = { scope: { kind: 'local' as const, vaultId: 'device' }, bookId: 'book' }
const book: ClientBook = { ref, content: { book: ref, contentId: 'revision' }, title: 'Book', authors: [], format: 'epub', availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
const base = Date.parse('2026-11-07T00:00:37Z')
let client: QueryClient
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local statistics controls must not use HTTP') }))
  onlineManager.setOnline(false)
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  await repository.addBook(book, new Blob(['abc']))
  await repository.writeReadingSession({ book: ref, source: 'manual', requestId: 'manual', date: '2026-11-07', startedAt: base, endedAt: base + 61_000, durationSeconds: 61, fragments: [{ startedAt: base, endedAt: base + 61_000 }], timezone: 'UTC', coverage: [[0.1, 0.2]], startFraction: 0.1, endFraction: 0.2, revisionId: 'revision' })
})
afterEach(async () => { cleanup(); useAuthStore.getState().clearAuth(); client.clear(); await repository.close(); expect(fetch).not.toHaveBeenCalled(); onlineManager.setOnline(true); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function mount() {
  const local = await openLocalReaderSession(ref)
  render(<QueryClientProvider client={client}><LocalCatalogProvider><LocalReaderContext.Provider value={local}><StatsPanel bookId={ref.bookId} /></LocalReaderContext.Provider></LocalCatalogProvider></QueryClientProvider>)
  await screen.findByText('reader.detailRecords')
  await waitFor(() => expect(document.querySelector('article')).not.toBeNull())
  return local
}
function menu() { fireEvent.contextMenu(document.querySelector('article')!, { clientX: 100, clientY: 100 }) }

describe('existing Reader statistics panel with actual local source adapters', () => {
  it('edits and deletes the displayed session through existing dialogs while offline', async () => {
    const local = await mount()
    menu(); fireEvent.click(await screen.findByText('reader.sessionEdit'))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(screen.getByLabelText('reader.addRecordMinutes'), { target: { value: '2' } })
    fireEvent.submit(dialog.querySelector('form')!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(async () => expect((await local.getReadingSessions()).data.items[0].durationSeconds).toBe(120))
    await waitFor(() => expect(document.querySelector('article')).not.toBeNull())
    menu(); fireEvent.click(await screen.findByText('reader.sessionDelete'))
    fireEvent.click(screen.getByRole('button', { name: 'reader.sessionDelete' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(async () => expect((await local.getReadingSessions()).data.items).toEqual([]))
    await screen.findByText('reader.statsEmptyTitle')
  })
  it('closes the old draft when switching to another actual local book', async () => {
    const first = await openLocalReaderSession(ref)
    const otherRef = { ...ref, bookId: 'other-book' }
    await repository.addBook({ ...book, ref: otherRef, content: { book: otherRef, contentId: 'other-revision' } }, new Blob(['abc']))
    const second = await openLocalReaderSession(otherRef)
    const ui = (local: Awaited<ReturnType<typeof openLocalReaderSession>>) => <QueryClientProvider client={client}><LocalCatalogProvider><LocalReaderContext.Provider value={local}><StatsPanel bookId={local.bookId} /></LocalReaderContext.Provider></LocalCatalogProvider></QueryClientProvider>
    const view = render(ui(first))
    await screen.findByText('reader.detailRecords')
    menu(); fireEvent.click(await screen.findByText('reader.sessionEdit'))
    fireEvent.change(screen.getByLabelText('reader.addRecordMinutes'), { target: { value: '3' } })
    view.rerender(ui(second))
    await screen.findByText('reader.statsEmptyTitle')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect((await first.getReadingSessions()).data.items[0].durationSeconds).toBe(61)
    expect((await second.getReadingSessions()).data.items).toEqual([])
  })

  it('keeps a stale edit open and leaves the newer accepted record unchanged', async () => {
    const local = await mount()
    const displayed = (await local.getReadingSessions()).data.items[0]
    menu(); fireEvent.click(await screen.findByText('reader.sessionEdit'))
    await act(async () => {
      await local.updateReadingSession(displayed.id, displayed.clientMembers!, { durationSeconds: 90, startedAt: base, continuous: true })
      await client.invalidateQueries({ queryKey: ['reading-records', local.namespace] })
    })
    fireEvent.change(screen.getByLabelText('reader.addRecordMinutes'), { target: { value: '2' } })
    act(() => useAuthStore.getState().setAuth({ id: 'service-account', username: 'service', role: 'member' }))
    expect(screen.getByLabelText('reader.addRecordMinutes')).toHaveValue(2)
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    await screen.findByText('localLibrary.recordConflict')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect((await local.getReadingSessions()).data.items[0].durationSeconds).toBe(90)
  })
})
