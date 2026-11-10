import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import BookNotesView from '../archive/BookNotesView'
import { LocalReaderContext } from '../reading-data/reader-source-context'
import { useAuthStore } from '@/stores/auth.store'
import LocalCatalogProvider from './LocalCatalogProvider'
import { openLocalReaderSession } from './reader-session'
import { projectLocalArchive } from './archive-projection'
import { localLibraryRepository as repository } from './repository'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))
vi.mock('@tanstack/react-router', async () => ({
  ...await import('@/__tests__/mocks/router-link'), useNavigate: () => vi.fn(),
}))
const ref = { scope: { kind: 'local' as const, vaultId: 'device' }, bookId: 'book' }
const book: ClientBook = { ref, content: { book: ref, contentId: 'revision' }, title: 'Device book', authors: ['Device author'], format: 'epub', availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
let client: QueryClient
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local archives must not request server books') }))
  onlineManager.setOnline(false)
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  await repository.addBook(book, new Blob(['abc']))
  const local = await openLocalReaderSession(ref)
  await local.createNote({ type: 'note', cfiRange: 'epubcfi(/6/4!/4/2:0)', revisionId: 'revision', note: 'Private idea', text: 'Device quotation' })
})
afterEach(async () => { cleanup(); client.clear(); useAuthStore.getState().clearAuth(); await repository.close(); expect(fetch).not.toHaveBeenCalled(); onlineManager.setOnline(true); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function mount(removed = false, bookView: 'notes' | 'data' = 'notes', bookType: 'all' | 'review' = 'all') {
  if (removed) await repository.removeBook(ref)
  const local = await openLocalReaderSession(ref, true)
  // Exercise source dispatch without loading the browser-only EPUB engine.
  vi.spyOn(local, 'getStructure').mockResolvedValue({ content: book.content!, sections: [], navigation: [] })
  render(<QueryClientProvider client={client}><LocalCatalogProvider><LocalReaderContext.Provider value={local}>
    <BookNotesView bookVersionId="book" bookView={bookView} bookType={bookType} bookSort="time-desc" onChange={vi.fn()} onBack={vi.fn()} />
  </LocalReaderContext.Provider></LocalCatalogProvider></QueryClientProvider>)
  await screen.findByRole('heading', { name: 'Device book' })
  return local
}

describe('existing single-book archive with local authority', () => {
  it.each([false, true])('opens private idea detail anonymously and gates source navigation on actual publication presence: %s', async (removed) => {
    await mount(removed)
    await screen.findByText('Private idea')
    expect(screen.getByText(/Device author/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /archive.typeReview/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'archive.viewIdeaDetail' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Private idea')).toBeInTheDocument()
    expect(within(dialog).getByText('annotation.myNote')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'annotation.jumpToSource' }) !== null).toBe(!removed)
    expect(within(dialog).getByText('annotation.savedAt')).toBeInTheDocument()
    expect(within(dialog).queryByText('comment.comments')).not.toBeInTheDocument()
  })

  it('retains a stale batch selection and rolls back the entire deletion while offline', async () => {
    const local = await mount(true)
    await screen.findByText('Private idea')
    fireEvent.click(screen.getByRole('button', { name: 'annotation.select' }))
    const note = (await local.listNotes()).data[0]
    await act(async () => {
      await local.updateNote(note.id, { note: 'Newer idea' }, note.clientVersion)
      await client.invalidateQueries({ queryKey: ['archive', local.namespace] })
    })
    await screen.findByText('Newer idea')
    fireEvent.click(screen.getByRole('button', { name: 'annotation.batchDelete' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'annotation.batchDelete' }))
    await waitFor(() => expect((client.getMutationCache().getAll().at(-1)?.state.status)).toBe('error'))
    expect((await local.listNotes()).data[0]).toMatchObject({ note: 'Newer idea', clientVersion: 2 })
    expect(screen.getByText('Newer idea')).toBeInTheDocument()
  })

  it('keeps the opened edit version after a background refresh and preserves the unsaved draft on conflict', async () => {
    const local = await mount(true)
    await screen.findByText('Private idea')
    fireEvent.click(screen.getByRole('button', { name: 'archive.viewIdeaDetail' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(await within(dialog).findByTitle('annotation.editNote'))
    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: 'My unsaved draft' } })
    const note = (await local.listNotes()).data[0]
    await act(async () => {
      await local.updateNote(note.id, { note: 'Newer idea' }, note.clientVersion)
      await client.invalidateQueries({ queryKey: ['archive', local.namespace] })
    })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await screen.findByText('localLibrary.recordConflict')
    expect(screen.getByRole('textbox')).toHaveValue('My unsaved draft')
    expect((await local.listNotes()).data[0].note).toBe('Newer idea')
  })

  it('writes a private review on a device book and reopens it from the same archive', async () => {
    await mount(false, 'notes', 'review')
    fireEvent.click(screen.getByRole('button', { name: 'review.writeReview' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('review.titleLabel'), { target: { value: 'Device verdict' } })
    const stars = within(dialog).getAllByRole('radio')
    fireEvent.click(stars[stars.length - 1]!)
    fireEvent.click(within(dialog).getByRole('button', { name: 'review.publish' }))
    await waitFor(async () => expect((await repository.getReview(ref))?.title).toBe('Device verdict'), { timeout: 20000 })
    expect(await repository.getReview(ref)).toMatchObject({ ratingHalves: 10, bodyFormat: 'markdown', version: 0, body: '' })
    await act(async () => { await client.invalidateQueries({ queryKey: ['archive'] }) })
    expect(await screen.findByText('Device verdict')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'review.writeReview' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'review.editReview' })).toBeInTheDocument()
  }, 30000)

  it('counts a review-only device book in the archive overview', async () => {
    await repository.saveReview(ref, { ratingHalves: 8, title: 'Only a review', body: '', bodyFormat: 'markdown' })
    const snapshot = await repository.readVaultReadingSnapshot('device')
    // A review alone is enough to participate: no reading time and no note.
    expect(projectLocalArchive({ ...snapshot, notes: [] }).overview).toMatchObject({ totalBooks: 1, counts: { reviews: 1, total: 1 } })
    await repository.deleteReview(ref)
    expect(await repository.getReview(ref)).toBeNull()
    expect(projectLocalArchive({ ...await repository.readVaultReadingSnapshot('device'), notes: [] }).overview).toMatchObject({ totalBooks: 0, counts: { reviews: 0, total: 0 } })
  })

  it('deletes a current selection through the existing archive confirmation while offline', async () => {
    const local = await mount(true)
    await screen.findByText('Private idea')
    fireEvent.click(screen.getByRole('button', { name: 'annotation.select' }))
    fireEvent.click(screen.getByRole('button', { name: 'annotation.batchDelete' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'annotation.batchDelete' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(), { timeout: 20000 })
    expect((await local.listNotes()).data).toEqual([])
    await screen.findByText('archive.noBookNotes')
  })
})
