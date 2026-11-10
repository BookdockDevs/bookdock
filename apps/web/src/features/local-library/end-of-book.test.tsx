import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'

import { apiGet } from '@/api/client'
import EndOfBookView from '@/features/reader/components/EndOfBookView'
import { LocalReaderContext } from '@/features/reading-data/reader-source-context'

import LocalCatalogProvider from './LocalCatalogProvider'
import { openLocalReaderSession } from './reader-session'
import { localLibraryRepository as repository } from './repository'

vi.mock('@/api/client', () => ({ apiGet: vi.fn() }))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
afterEach(async () => { cleanup(); await repository.close(); onlineManager.setOnline(true); vi.unstubAllGlobals() })

it('shows the original end-of-book summary and finish action using local records without a remote review request', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  const ref = { scope: { kind: 'local' as const, vaultId: 'device' }, bookId: 'end-book' }
  await repository.addBook({ ref, content: { book: ref, contentId: 'before' }, format: 'epub', title: 'Book', authors: [], availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }, new Blob(['abc']))
  await repository.saveNote({ id: 'idea', book: ref, kind: 'idea', body: 'Local idea', text: '', locator: null, chapter: null, createdAt: 1, updatedAt: 1, version: 0 }, 0)
  const session = await openLocalReaderSession(ref, true)
  const finished = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  onlineManager.setOnline(false)
  render(<QueryClientProvider client={client}><LocalCatalogProvider><LocalReaderContext.Provider value={session}><EndOfBookView bookId={ref.bookId} bookTitle="Book" onMarkFinished={finished} /></LocalReaderContext.Provider></LocalCatalogProvider></QueryClientProvider>)
  expect(screen.getByTestId('end-of-book-view')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('1', { selector: '.bookdock-eob-num' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'reader.endOfBookMarkFinished' }))
  expect(finished).toHaveBeenCalledOnce()
  expect(apiGet).not.toHaveBeenCalled()
  client.clear()
})
