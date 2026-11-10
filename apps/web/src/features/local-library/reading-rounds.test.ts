import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook, ClientReadingCapture } from '@bookdock/shared'

import { LocalLibraryRepository } from './repository'

const ref = { scope: { kind: 'local' as const, vaultId: 'round-vault' }, bookId: 'book' }
const book: ClientBook = { ref, content: { book: ref, contentId: 'revision' }, title: 'Book', authors: [], format: 'epub', availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
const capture = (requestId: string): ClientReadingCapture => ({ book: ref, requestId, source: 'retroactive', date: '2026-11-01', durationSeconds: 60, startedAt: null })
let repository: LocalLibraryRepository
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local rounds must not use HTTP') }))
  repository = new LocalLibraryRepository('rounds')
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('source-owned local reading rounds', () => {
  it('retains a pre-existing terminal book status without inventing its historical finish time', async () => {
    await repository.setReadStatus(ref, 'finished')
    await repository.writeReadingSession(capture('older-data'))
    const history = await repository.readReadingRounds(ref)
    expect(history.rounds[0]).toMatchObject({ status: 'finished', startedAt: null, endedAt: null })
    expect((await repository.getState(ref))?.readStatus).toBe('finished')
  })

  it('binds new facts to rounds, preserves unknown historical starts and implements finish/continue/reread/abandon', async () => {
    expect(await repository.readReadingRounds(ref)).toEqual({ book: ref, rounds: [], version: 0 })
    const first = (await repository.writeReadingSession(capture('first')))!
    const initial = await repository.readReadingRounds(ref)
    expect(initial.rounds).toEqual([{ id: first.roundId, ordinal: 1, status: 'reading', startedAt: null, endedAt: null }])
    const finished = await repository.changeReadingRound(ref, 'finish', 0, 'finish')
    expect(finished.rounds[0].status).toBe('finished')
    expect((await repository.getState(ref))?.readStatus).toBe('finished')
    const reread = await repository.changeReadingRound(ref, 'reread', 1, 'reread')
    expect(reread.rounds.map((round) => round.status)).toEqual(['finished', 'reading'])
    const second = (await repository.writeReadingSession(capture('second')))!
    expect(second.roundId).toBe(reread.rounds[1].id)
    const continued = await repository.changeReadingRound(ref, 'continue', 2, 'continue')
    expect(continued.rounds).toHaveLength(2)
    const abandoned = await repository.changeReadingRound(ref, 'abandon', 3, 'abandon')
    expect(abandoned.rounds[1].status).toBe('abandoned')
    expect((await repository.getState(ref))?.readStatus).toBe('abandoned')
    const reopened = await repository.changeReadingRound(ref, 'continue', 4, 'reopen')
    expect(reopened.rounds[1]).toMatchObject({ id: second.roundId, status: 'reading', endedAt: null })
    const ledger = await repository.readReadingLedger('round-vault')
    expect(ledger.sessions.map((session) => session.roundId)).toEqual(expect.arrayContaining([first.roundId, second.roundId]))
  })
  it('undoes only an empty reread, rejects stale writes and makes replayed commands idempotent', async () => {
    await repository.changeReadingRound(ref, 'finish', 0, 'finish')
    const second = await repository.changeReadingRound(ref, 'reread', 1, 'reread')
    expect((await repository.changeReadingRound(ref, 'reread', 1, 'reread')).rounds).toHaveLength(2)
    await expect(repository.changeReadingRound(ref, 'abandon', 1, 'stale')).rejects.toMatchObject({ category: 'conflict' })
    await expect(repository.changeReadingRound(ref, 'finish', 1, 'reread')).rejects.toMatchObject({ category: 'conflict' })
    const undo = await repository.changeReadingRound(ref, 'continue', second.version, 'undo')
    expect(undo.rounds).toHaveLength(1)
    expect(undo.rounds[0].status).toBe('finished')
    expect((await repository.getState(ref))?.readStatus).toBe('finished')
    expect((await repository.changeReadingRound(ref, 'reread', 1, 'reread')).rounds).toHaveLength(1)
    await repository.removeBook(ref, false)
    expect(await repository.readReadingRounds(ref)).toEqual(undo)
    await repository.removeBook(ref, true)
    await expect(repository.readReadingRounds(ref)).rejects.toThrow()
  })
  it('rolls back round, status, version and receipt together after a storage failure', async () => {
    const put = IDBObjectStore.prototype.put
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'reading-receipts') throw new DOMException('Full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(repository.changeReadingRound(ref, 'reread', 0, 'reread')).rejects.toMatchObject({ category: 'storage-full' })
    fault.mockRestore()
    expect(await repository.readReadingRounds(ref)).toEqual({ book: ref, version: 0, rounds: [] })
    expect(await repository.getState(ref)).toBeNull()
    expect((await repository.readReadingLedger('round-vault')).version).toBe(0)
    expect((await repository.changeReadingRound(ref, 'reread', 0, 'reread')).rounds).toHaveLength(2)
    const otherRef = { ...ref, scope: { kind: 'local' as const, vaultId: 'other-vault' } }
    await repository.addBook({ ...book, ref: otherRef, content: { book: otherRef, contentId: 'revision' } }, new Blob(['abc']))
    expect(await repository.readReadingRounds(otherRef)).toEqual({ book: otherRef, version: 0, rounds: [] })
  })
})


describe('atomic local entry commands', () => {
  it('saves an untimed entry and finishes atomically without inventing clock time or finishing a later replay round', async () => {
    const entry = { capture: capture('entry'), finished: true }
    const saved = (await repository.addReadingEntry(entry))!
    expect(saved.capture.startedAt).toBeNull()
    expect(saved.capture.endedAt).toBeUndefined()
    expect(saved.acceptedFragments).toEqual([])
    expect((await repository.getState(ref))?.readStatus).toBe('finished')
    const history = await repository.readReadingRounds(ref)
    await repository.changeReadingRound(ref, 'reread', history.version, 'reread-after-entry')
    await repository.addReadingEntry(entry)
    expect((await repository.readReadingRounds(ref)).rounds.at(-1)?.status).toBe('reading')
    expect((await repository.getState(ref))?.readStatus).toBe('reading')
    expect((await repository.readReadingLedger('round-vault')).sessions).toHaveLength(1)
  })
  it('replaces only explicit overlaps within the current book and round and rolls back an incomplete replacement', async () => {
    const timed = (requestId: string, offset = 0): ClientReadingCapture => ({ ...capture(requestId), startedAt: 1794000000000 + offset, endedAt: 1794000060000 + offset, timezone: 'UTC', fragments: [{ startedAt: 1794000000000 + offset, endedAt: 1794000060000 + offset }] })
    const first = (await repository.writeReadingSession(timed('first')))! 
    const second = (await repository.writeReadingSession(timed('second', 60_000)))!
    const replacement = { ...timed('replace'), durationSeconds: 120, endedAt: 1794000120000, fragments: [{ startedAt: 1794000000000, endedAt: 1794000120000 }] }
    await expect(repository.addReadingEntry({ capture: replacement, finished: true })).rejects.toMatchObject({ category: 'conflict', details: { conflictingSessionIds: expect.arrayContaining([first.id, second.id]), hasUnreplaceableConflicts: false } })
    await expect(repository.addReadingEntry({ capture: replacement, finished: true, replaceSessionIds: [first.id] })).rejects.toMatchObject({ category: 'conflict' })
    expect((await repository.readReadingLedger('round-vault')).sessions).toHaveLength(2)
    expect((await repository.readReadingRounds(ref)).rounds[0].status).toBe('reading')
    await repository.addReadingEntry({ capture: replacement, finished: true, replaceSessionIds: [first.id, second.id] })
    expect((await repository.readReadingLedger('round-vault')).sessions.map((value) => value.durationSeconds)).toEqual([120])
    expect(await repository.writeReadingSession(timed('first'))).toBeNull()
    const history = await repository.readReadingRounds(ref)
    await repository.changeReadingRound(ref, 'reread', history.version, 'new-round')
    await expect(repository.addReadingEntry({ capture: timed('late-replace'), finished: false })).rejects.toMatchObject({ details: { hasUnreplaceableConflicts: true } })
  })
})
