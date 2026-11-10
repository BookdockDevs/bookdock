import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook, ClientReadingCapture, ClientReadingSessionCommand } from '@bookdock/shared'

import { localTimerCaptureGroup } from './reading-capture-group'
import { flushLocalReadingOutbox } from './reading-outbox'
import { projectLocalReadingBook } from './reading-projection'
import { LocalLibraryRepository } from './repository'

const ref = { scope: { kind: 'local' as const, vaultId: 'edit-vault' }, bookId: 'book' }
const book: ClientBook = { ref, content: { book: ref, contentId: 'revision' }, title: 'Book', authors: [], format: 'epub', availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
const base = Date.parse('2026-11-07T00:00:37Z')
const manual = (id: string, offset = 0, seconds = 60): ClientReadingCapture => ({ book: ref, source: 'manual', requestId: id, date: '2026-11-07', durationSeconds: seconds, startedAt: base + offset, endedAt: base + offset + seconds * 1000, timezone: 'UTC', fragments: [{ startedAt: base + offset, endedAt: base + offset + seconds * 1000 }], revisionId: 'revision', startFraction: 0.1, endFraction: 0.2, startCfi: 'epubcfi(/6/2)', endCfi: 'epubcfi(/6/4)', coverage: [[0.1, 0.2]], wordCount: 1000 })
let repository: LocalLibraryRepository
const views = async () => projectLocalReadingBook(await repository.readReadingBookSnapshot(ref)).sessions
const command = async (id: string, requestId: string): Promise<ClientReadingSessionCommand> => { const row = (await views()).find((row) => row.id === id)!; return { book: ref, id, requestId, members: row.clientMembers! } }
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local editing must not use HTTP') }))
  repository = new LocalLibraryRepository('reading-edits')
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('source-owned logical reading edits', () => {
  it('preserves unknown clocks, logical identity and original round through later rereads and refuses stale updates', async () => {
    const first = (await repository.writeReadingSession({ book: ref, source: 'retroactive', requestId: 'untimed', date: '2026-10-01', durationSeconds: 1813, startedAt: null, revisionId: 'revision', startFraction: 0.2, endFraction: 0.4 }))!
    const edit = await command(first.id, 'edit')
    const history = await repository.readReadingRounds(ref)
    await repository.changeReadingRound(ref, 'reread', history.version, 'reread')
    await repository.updateReadingLogicalSession(edit, { startFraction: 0.25 })
    const result = (await views())[0]
    expect(result).toMatchObject({ id: first.id, roundId: first.roundId, startedAt: null, endedAt: null, durationSeconds: 1813, startFraction: 0.25, endFraction: 0.4 })
    expect(result.fragments).toEqual([])
    expect(result.clientMembers).not.toEqual(edit.members)
    await expect(repository.updateReadingLogicalSession({ ...edit, requestId: 'stale' }, { durationSeconds: 60 })).rejects.toMatchObject({ category: 'conflict' })
    await repository.updateReadingLogicalSession(edit, { startFraction: 0.25 })
    expect((await views())[0]).toEqual(result)
    expect((await repository.getState(ref))?.readStatus).toBe('reading')
    expect(await repository.writeReadingSession(first.capture)).toBeNull()
  })
  it('edits one grouped session without losing gaps, duplicating coverage or retaining an obsolete exact end anchor', async () => {
    const group = { book: ref, id: 'logical', captures: [manual('logical.0', 0, 40), { ...manual('logical.1', 60_000, 40), coverage: [] }] }
    await repository.enqueueReadingCaptureGroup(group, base + 100_000)
    await flushLocalReadingOutbox('edit-vault', repository)
    await repository.updateReadingLogicalSession(await command('logical', 'edit'), { endFraction: 0.3 })
    const result = (await views())[0]
    expect(result).toMatchObject({ id: 'logical', durationSeconds: 80, startFraction: 0.1, endFraction: 0.3, startCfi: 'epubcfi(/6/2)', endCfi: null })
    expect(result.fragments).toEqual([{ startedAt: base, endedAt: base + 40_000 }, { startedAt: base + 60_000, endedAt: base + 100_000 }])
    expect(result.coverage).toEqual([[0.1, 0.3]])
    await repository.enqueueReadingCaptureGroup(group, base + 100_000)
    await flushLocalReadingOutbox('edit-vault', repository)
    expect(await views()).toHaveLength(1)
  })
  it('rolls back original parts and versions after a later write fails, then preserves an accepted long fractional tail on retry', async () => {
    const capture = manual('long', 0, 86401)
    const record = { ...capture, bookId: ref.bookId, fragments: [{ startedAt: base, endedAt: base + 86400_500 }], endedAt: base + 86400_500 }
    const { book: _book, ...fields } = record
    const group = localTimerCaptureGroup(ref, fields)
    await repository.enqueueReadingCaptureGroup(group, base + 86400_500)
    await flushLocalReadingOutbox('edit-vault', repository)
    const before = await repository.readReadingBookSnapshot(ref)
    const edit = await command('long', 'edit-long')
    const put = IDBObjectStore.prototype.put
    let count = 0
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'reading-sessions' && ++count === 2) throw new DOMException('Full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(repository.updateReadingLogicalSession(edit, { endFraction: 0.3 })).rejects.toMatchObject({ category: 'storage-full' })
    fault.mockRestore()
    expect(await repository.readReadingBookSnapshot(ref)).toEqual(before)
    await repository.updateReadingLogicalSession(edit, { endFraction: 0.3 })
    const result = (await views())[0]
    expect(result.id).toBe('long')
    expect(result.durationSeconds).toBe(86400.5)
    expect(result.clientMembers).toHaveLength(2)
    expect(result.fragments).toEqual([{ startedAt: base, endedAt: base + 86400_500 }])
  })
  it('keeps an explicit removal of clock time untimed instead of manufacturing an interval', async () => {
    const first = (await repository.writeReadingSession(manual('manual')))!
    await repository.updateReadingLogicalSession(await command(first.id, 'remove-clock'), { startedAt: null, continuous: false, durationSeconds: 90 })
    expect((await views())[0]).toMatchObject({ id: first.id, source: 'retroactive', startedAt: null, endedAt: null, durationSeconds: 90, fragments: [] })
  })
  it('retains accepted subsecond time when its clock is explicitly removed', async () => {
    const first = (await repository.writeReadingSession(manual('fractional', 0, 0.25)))!
    await repository.updateReadingLogicalSession(await command(first.id, 'untimed-fractional'), { startedAt: null, continuous: false })
    const result = (await views())[0]
    expect(result).toMatchObject({ source: 'retroactive', startedAt: null, endedAt: null, durationSeconds: 0.25, fragments: [] })
    expect((await repository.readReadingLedger('edit-vault')).sessions[0].capture.durationSeconds).toBe(0.25)
  })

  it('rejects immutable automatic sessions and overlapping corrected time without changing originals', async () => {
    const first = (await repository.writeReadingSession(manual('manual')))!
    await repository.writeReadingSession({ ...manual('automatic', 120_000), source: 'auto' })
    const original = await repository.readReadingBookSnapshot(ref)
    const automatic = (await views()).find((view) => view.source === 'auto')!
    await expect(repository.updateReadingLogicalSession(await command(automatic.id, 'edit-auto'), { durationSeconds: 30 })).rejects.toMatchObject({ category: 'invalid-input' })
    await expect(repository.updateReadingLogicalSession(await command(first.id, 'overlap'), { startedAt: base + 130_000, durationSeconds: 60, continuous: true })).rejects.toMatchObject({ category: 'conflict' })
    expect(await repository.readReadingBookSnapshot(ref)).toEqual(original)
  })
  it('rechecks membership after asynchronous preparation and cannot recreate a concurrently deleted session', async () => {
    const first = (await repository.writeReadingSession(manual('manual')))!
    const edit = await command(first.id, 'edit')
    const read = repository.readReadingBookSnapshot.bind(repository)
    vi.spyOn(repository, 'readReadingBookSnapshot').mockImplementationOnce(async (book) => {
      const snapshot = await read(book)
      await repository.deleteReadingLogicalSession({ ...edit, requestId: 'delete-before-commit' })
      return snapshot
    })
    await expect(repository.updateReadingLogicalSession(edit, { endFraction: 0.3 })).rejects.toMatchObject({ category: 'conflict' })
    expect(await views()).toEqual([])
  })
})
