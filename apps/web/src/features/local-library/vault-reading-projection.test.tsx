import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook, ClientBookRef } from '@bookdock/shared'

import { useReadingSummary } from '@/api/hooks/reading-records'
import { useArchiveBooksInfinite, useArchiveOverview } from '../archive/hooks'
import ReadingDataManagerButton from '../archive/components/ReadingDataManagerButton'
import { VaultAvailabilityContext } from '../reading-data/vault-availability'
import { projectLocalArchive, projectLocalArchivePage } from './archive-projection'
import { LocalLibraryRepository } from './repository'
import { projectLocalVaultReading } from './vault-reading-projection'

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

// The unified surfaces bind the device vault directly; these cases hand them a
// repository of their own instead of the app-wide one.
vi.mock('./catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./catalog')>()
  return { ...actual, deviceCatalogOperations: () => actual.localCatalogOperations({ kind: 'local', vaultId: 'vault' }, repository) }
})

const scope = { kind: 'local' as const, vaultId: 'vault' }
const ref = (id: string): ClientBookRef => ({ scope, bookId: id })
const book = (id: string): ClientBook => ({ ref: ref(id), content: { book: ref(id), contentId: 'revision' }, title: id, authors: [], format: 'epub', availability: 'available', size: 1, version: 0, createdAt: 1, updatedAt: 1 })
let repository: LocalLibraryRepository
let client: QueryClient
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local aggregate queries must not use HTTP') }))
  onlineManager.setOnline(false)
  repository = new LocalLibraryRepository('vault-projection')
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  for (const [id, seconds] of [['First', 40], ['Second', 30]] as const) {
    await repository.addBook(book(id), new Blob(['x']))
    await repository.addReadingEntry({ capture: { book: ref(id), source: 'retroactive', requestId: id, date: '2026-11-07', startedAt: null, durationSeconds: seconds }, finished: false })
  }
})
afterEach(async () => { cleanup(); client.clear(); await repository.close(); expect(fetch).not.toHaveBeenCalled(); onlineManager.setOnline(true); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}><VaultAvailabilityContext.Provider value={true}>{children}</VaultAvailabilityContext.Provider></QueryClientProvider>
}

describe('vault archive and reading projections', () => {
  it('clears committed time/rounds atomically while retaining notes, publication, preferences and restore position', async () => {
    const first = ref('First')
    const position = { content: { book: first, contentId: 'revision' }, schemaVersion: 1 as const, kind: 'epub-cfi' as const, value: 'epubcfi(/6/4!/4/2:0)' }
    await repository.saveState({ book: first, readStatus: 'reading', position, fraction: 0.2, coverage: { content: position.content, fraction: 0.2, available: true }, lastReadAt: 1, updatedAt: 1, version: 0 }, 0, [[0, 0.2]])
    await repository.patchPreferences(first, { viewSettings: { fontSize: 26 } })
    await repository.saveNote({ id: 'retained', book: first, kind: 'idea', body: 'Keep', text: '', chapter: null, locator: null, createdAt: 1, updatedAt: 1, version: 0 }, 0)
    const before = await repository.readReadingBookSnapshot(first)
    const command = { book: first, requestId: 'clear', expectedVersion: before.ledger.version }
    await repository.clearReadingLedger(command)
    const after = await repository.readReadingBookSnapshot(first)
    expect(after.ledger.sessions).toEqual([])
    expect(after.rounds.rounds).toEqual([])
    expect(after.state).toMatchObject({ position, fraction: 0.2, coverage: null })
    expect(await repository.listNotes(first)).toHaveLength(1)
    expect((await repository.getFile(first)).size).toBe(1)
    expect(await repository.getPreferences(first)).toMatchObject({ viewSettings: { fontSize: 26 }, coverageIntervals: [] })
    expect((await repository.readReadingBookSnapshot(ref('Second'))).ledger.sessions).toHaveLength(1)
    await expect(repository.addReadingEntry({ capture: before.ledger.sessions[0]!.capture, finished: false })).resolves.toBeNull()
    await repository.addReadingEntry({ capture: { ...before.ledger.sessions[0]!.capture, requestId: 'new-time' }, finished: false })
    await repository.clearReadingLedger(command)
    expect((await repository.readReadingBookSnapshot(first)).ledger.sessions).toHaveLength(1)
    await expect(repository.clearReadingLedger({ ...command, requestId: 'stale-clear' })).rejects.toMatchObject({ category: 'conflict' })
  })

  it('refuses to clear pending captures or an active timer before changing saved history', async () => {
    const first = ref('First')
    const snapshot = await repository.readReadingBookSnapshot(first)
    const capture = { ...snapshot.ledger.sessions[0]!.capture, requestId: 'pending' }
    await repository.enqueueReadingCapture(capture)
    const command = { book: first, requestId: 'clear', expectedVersion: snapshot.ledger.version }
    await expect(repository.clearReadingLedger(command)).rejects.toMatchObject({ category: 'pending-reading' })
    await repository.acknowledgeReadingCapture(first, 'pending')
    await repository.claimReadingTimer('vault', { deviceId: 'reader', mode: 'auto', activityAt: Date.now() })
    await expect(repository.clearReadingLedger(command)).rejects.toMatchObject({ category: 'pending-reading' })
    expect((await repository.readReadingBookSnapshot(first)).ledger.sessions).toHaveLength(1)
  })

  it('exposes supported local history clearing through the existing manager without remote transfer or association', async () => {
    render(<ReadingDataManagerButton bookId="First" bookTitle="First" />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))
    // The manager opens on the tab the selected book supports, and the vault
    // answers that asynchronously: a device book offers clearing only.
    const clear = await screen.findByRole('button', { name: 'readingData.deleteArchive' })
    expect(screen.queryByRole('tab', { name: 'readingData.tabImport' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'readingData.tabExport' })).not.toBeInTheDocument()
    expect(screen.queryByText('readingImport.locatorTitle')).not.toBeInTheDocument()
    await waitFor(() => expect(clear).toBeEnabled())
    fireEvent.click(clear)
    const confirmation = await screen.findByRole('alertdialog')
    expect(within(confirmation).getByText('readingData.deleteArchiveConfirm')).toBeInTheDocument()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'readingData.deleteArchive' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect((await repository.readReadingBookSnapshot(ref('First'))).ledger.sessions).toEqual([])
    expect((await repository.readReadingBookSnapshot(ref('Second'))).ledger.sessions).toHaveLength(1)
  })

  it('keeps the confirmation version when another view changes reading facts', async () => {
    render(<ReadingDataManagerButton bookId="First" bookTitle="First" />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'readingData.archiveManagement' }))
    // The manager opens on the tab the selected book supports, and the vault
    // answers that asynchronously.
    const clear = await screen.findByRole('button', { name: 'readingData.deleteArchive' })
    await waitFor(() => expect(clear).toBeEnabled())
    fireEvent.click(clear)
    const confirmation = await screen.findByRole('alertdialog')
    await act(async () => {
      await repository.addReadingEntry({ capture: { book: ref('First'), requestId: 'newer', source: 'retroactive', date: '2026-11-07', startedAt: null, durationSeconds: 90 }, finished: false })
      await client.invalidateQueries({ queryKey: ['reading-records'] })
    })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'readingData.deleteArchive' }))
    await within(confirmation).findByText('localLibrary.recordConflict')
    expect((await repository.readReadingBookSnapshot(ref('First'))).ledger.sessions).toHaveLength(2)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
  it('counts sixty seconds across books as one reading day without inventing unknown hours or word counts', async () => {
    const result = projectLocalVaultReading(await repository.readVaultReadingSnapshot('vault'), { timezone: 'UTC' }, '2026-11-07')
    expect(result.summary).toMatchObject({ totalSeconds: 70, todaySeconds: 70, totalBooks: 2, totalDays: 1, currentStreak: 1, longestStreak: 1, wordState: 'unknown', scope: { totalDays: 1, totalSeconds: 70, wordsPartial: true, wordState: 'unknown' } })
    expect(result.daily).toEqual([{ date: '2026-11-07', durationSeconds: 70 }])
    expect(result.hourly.every((hour) => hour.durationSeconds === 0 && hour.days === 0)).toBe(true)
    expect(result.byBook.every((book) => book.days === 0 && book.progress === null)).toBe(true)
    expect(result.byCategory).toEqual([{ categoryId: null, name: null, parentId: null, parentName: null, bookCount: 2, durationSeconds: 70 }])
  })

  it('uses source-owned taxonomy and treats tag time as non-exclusive', async () => {
    const item = (id: string, kind: 'tag' | 'category', parentId: string | null = null) => ({ id, kind, name: id, parentId, pinned: false, hidden: false, sortOrder: 0, createdAt: 1, updatedAt: 1 })
    await repository.saveOrganization('vault', { version: 0, items: [item('tag-one', 'tag'), item('tag-two', 'tag'), item('parent', 'category'), item('child', 'category', 'parent')] }, 0)
    await repository.updateMetadata(ref('First'), { catalog: { tagIds: ['tag-one', 'tag-two'], categoryId: 'child' } }, 0)
    await repository.updateMetadata(ref('Second'), { catalog: { tagIds: ['tag-one'] } }, 0)
    const result = projectLocalVaultReading(await repository.readVaultReadingSnapshot('vault'))
    expect(result.byTag).toEqual([{ tagId: 'tag-one', name: 'tag-one', bookCount: 2, durationSeconds: 70 }, { tagId: 'tag-two', name: 'tag-two', bookCount: 1, durationSeconds: 40 }])
    expect(result.byCategory).toContainEqual({ categoryId: 'child', name: 'child', parentId: 'parent', parentName: 'parent', bookCount: 1, durationSeconds: 40 })
  })

  it('unions hourly calendar days across books and keeps their recorded timezone and date', async () => {
    const start = Date.parse('2026-11-08T00:00:00Z')
    for (const [id, offset] of [['First', 0], ['Second', 100_000]] as const) {
      const startedAt = start + offset
      await repository.writeReadingSession({ book: ref(id), source: 'manual', requestId: `clock-${id}`, date: '2026-11-07', startedAt, endedAt: startedAt + 90_000, fragments: [{ startedAt, endedAt: startedAt + 90_000 }], timezone: 'America/New_York', durationSeconds: 90 })
    }
    const result = projectLocalVaultReading(await repository.readVaultReadingSnapshot('vault'), { from: '2026-11-07', to: '2026-11-07', timezone: 'Asia/Shanghai' }, '2026-11-08')
    expect(result.summary.scope).toMatchObject({ totalSeconds: 250, totalDays: 1 })
    expect(result.hourly[19]).toEqual({ hour: 19, durationSeconds: 180, days: 1 })
  })

  it('retains removed-book facts, excludes a different vault and removes completely deleted facts', async () => {
    const other = book('First'); other.ref = { scope: { kind: 'local', vaultId: 'other' }, bookId: 'First' }; other.content = { book: other.ref, contentId: 'other' }
    await repository.addBook(other, new Blob(['y']))
    await repository.addReadingEntry({ capture: { book: other.ref, source: 'retroactive', requestId: 'other', date: '2026-11-07', startedAt: null, durationSeconds: 1000 }, finished: false })
    await repository.removeBook(ref('First'))
    expect(projectLocalVaultReading(await repository.readVaultReadingSnapshot('vault')).summary.totalSeconds).toBe(70)
    await repository.removeBook(ref('Second'), true)
    expect(projectLocalVaultReading(await repository.readVaultReadingSnapshot('vault')).summary.totalSeconds).toBe(40)
  })

  it('filters note creation by viewing timezone and supports actual local archive identities, filters and pagination', async () => {
    const createdAt = Date.parse('2026-11-08T00:15:00Z')
    await repository.saveNote({ id: 'note', book: ref('First'), kind: 'idea', chapter: null, body: 'Private', text: 'Quote', locator: null, version: 0, createdAt, updatedAt: createdAt }, 0)
    const snapshot = await repository.readVaultReadingSnapshot('vault')
    const range = { from: '2026-11-07', to: '2026-11-07', timezone: 'America/New_York' }
    expect(projectLocalArchive(snapshot, range).overview).toEqual({ counts: { highlights: 0, bookmarks: 0, ideas: 1, reviews: 0, total: 1 }, totalBooks: 2 })
    const page = projectLocalArchivePage(snapshot, { ...range, type: 'idea', page: 1, pageSize: 1, sort: 'recent' })
    expect(page).toMatchObject({ hasMore: false, entries: [{ id: 'First', ref: ref('First'), ideas: 1 }] })
    expect(page.entries[0]).not.toHaveProperty('bookVersionId')
    expect(projectLocalArchivePage(snapshot, { ...range, page: 1, pageSize: 1, sort: 'reading-time' })).toMatchObject({ hasMore: true, entries: [{ id: 'First' }] })
    expect(projectLocalArchive(snapshot, { ...range, timezone: 'UTC' }).overview.counts.ideas).toBe(0)
  })

  it('uses existing summary/archive hooks offline and leaves same-ID remote caches untouched', async () => {
    const remote = { data: { private: 'Remote facts' } }
    client.setQueryData(['reading-records', 'summary', 'remote'], remote)
    const summary = renderHook(() => useReadingSummary('2026-11-07', '2026-11-07', 'UTC'), { wrapper })
    const overview = renderHook(() => useArchiveOverview(), { wrapper })
    const list = renderHook(() => useArchiveBooksInfinite({ sort: 'reading-time', pageSize: 1 }), { wrapper })
    await waitFor(() => expect(summary.result.current.isSuccess && overview.result.current.isSuccess && list.result.current.isSuccess).toBe(true))
    expect(summary.result.current.data?.data.totalSeconds).toBe(70)
    expect(overview.result.current.data?.data.totalBooks).toBe(2)
    expect(list.result.current.data?.pages[0].data.entries[0]).toMatchObject({ id: 'First', ref: ref('First') })
    expect(client.getQueryData(['reading-records', 'summary', 'remote'])).toEqual(remote)
  })
})
