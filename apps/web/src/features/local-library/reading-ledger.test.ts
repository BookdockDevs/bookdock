import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clientReadingCaptureSchema, splitReadingTime, type ClientBook, type ClientNote, type ClientReadingCapture, type ClientReadingState, type ClientReadingTimerDraft } from '@bookdock/shared'

import { LocalLibraryRepository } from './repository'
import { flushLocalReadingOutbox } from './reading-outbox'

const ref = { scope: { kind: 'local' as const, vaultId: 'vault' }, bookId: 'book' }
const book: ClientBook = { ref, content: { book: ref, contentId: 'revision' }, title: 'Book', authors: [], format: 'epub', availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
const start = Date.parse('2026-11-06T15:59:30Z')
const capture = (requestId: string, offset = 0, seconds = 90): ClientReadingCapture => ({ book: ref, requestId, source: 'manual', date: '2026-11-06', startedAt: start + offset, endedAt: start + offset + seconds * 1000, durationSeconds: seconds, timezone: 'Asia/Shanghai', fragments: [{ startedAt: start + offset, endedAt: start + offset + seconds * 1000 }] })
let repository: LocalLibraryRepository
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local reading must not send HTTP requests') }))
  repository = new LocalLibraryRepository('reading-test')
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('local timed reading ledger transactions', () => {
  it('preserves a newer grace snapshot and refuses to resume or extend finalized queued capture', async () => {
    const first: ClientReadingTimerDraft = { capture: capture('draft'), phase: 'suspended', suspendedAt: start + 90_000, expiresAt: start + 150_000, updatedAt: start + 90_000 }
    expect(await repository.saveReadingTimerDraft(first)).toBe(true)
    const next = { ...first, updatedAt: first.updatedAt + 1000, expiresAt: first.expiresAt + 1000 }
    expect(await repository.saveReadingTimerDraft(next)).toBe(true)
    expect(await repository.saveReadingTimerDraft(first)).toBe(false)
    await repository.acknowledgeReadingTimerDraft(first)
    expect(await repository.listReadingTimerDrafts('vault')).toEqual([next])
    const queued = { ...next, phase: 'queued' as const }
    await repository.saveReadingTimerDraft(queued)
    await expect(repository.saveReadingTimerDraft({ ...queued, phase: 'suspended' })).rejects.toMatchObject({ category: 'conflict' })
    await expect(repository.saveReadingTimerDraft({ ...queued, capture: capture('draft', 0, 100) })).rejects.toMatchObject({ category: 'conflict' })
    expect(await repository.saveReadingTimerDraft({ ...queued, capture: capture('new-request'), updatedAt: queued.updatedAt + 1000 })).toBe(false)
  })

  it('recovers only queued or expired drafts and never backfills time away', async () => {
    const draft: ClientReadingTimerDraft = { capture: capture('queued'), phase: 'queued', suspendedAt: start + 90_000, expiresAt: Date.now() + 60_000, updatedAt: start + 90_000 }
    await repository.saveReadingTimerDraft(draft)
    await flushLocalReadingOutbox('vault', repository)
    expect(await repository.listReadingTimerDrafts('vault')).toEqual([])
    expect((await repository.readReadingLedger('vault')).sessions[0]?.durationSeconds).toBe(90)
    const fresh = { ...draft, phase: 'suspended' as const, capture: capture('fresh', 180_000) }
    await repository.saveReadingTimerDraft(fresh)
    await flushLocalReadingOutbox('vault', repository)
    expect(await repository.listReadingTimerDrafts('vault')).toEqual([fresh])
    await repository.saveReadingTimerDraft({ ...fresh, expiresAt: start + 150_000, updatedAt: fresh.updatedAt + 1000 })
    await flushLocalReadingOutbox('vault', repository)
    expect(await repository.listReadingTimerDrafts('vault')).toEqual([])
    expect((await repository.readReadingLedger('vault')).sessions.map((session) => session.durationSeconds)).toEqual([90, 90])
  })

  it('deletes plaintext grace drafts with their book and rejects a late checkpoint', async () => {
    const draft: ClientReadingTimerDraft = { capture: capture('draft'), phase: 'suspended', suspendedAt: start + 90_000, expiresAt: start + 150_000, updatedAt: start + 90_000 }
    await repository.saveReadingTimerDraft(draft)
    await repository.removeBook(ref, true)
    expect(await repository.listReadingTimerDrafts('vault')).toEqual([])
    await expect(repository.saveReadingTimerDraft(draft)).rejects.toBeDefined()
  })

  it('durably queues captures and replays a committed fact before acknowledging the outbox', async () => {
    const input = capture('outbox')
    await repository.enqueueReadingCapture(input)
    await repository.close()
    repository = new LocalLibraryRepository('reading-test')
    expect(await repository.listPendingReadingCaptures('vault')).toEqual([input])
    expect(await repository.listPendingReadingCaptures('other')).toEqual([])
    await expect(repository.enqueueReadingCapture({ ...input, durationSeconds: 10 })).rejects.toMatchObject({ category: 'conflict' })
    const saved = await repository.writeReadingSession(input)
    expect(await repository.listPendingReadingCaptures('vault')).toHaveLength(1)
    expect(await repository.writeReadingSession(input)).toEqual(saved)
    await repository.acknowledgeReadingCapture(ref, input.requestId)
    expect(await repository.listPendingReadingCaptures('vault')).toEqual([])
    expect((await repository.readReadingLedger('vault')).sessions).toHaveLength(1)
  })

  it('recovers after acknowledgement failure without counting the committed capture twice', async () => {
    await repository.enqueueReadingCapture(capture('outbox'))
    const acknowledge = vi.spyOn(repository, 'acknowledgeReadingCapture').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'))
    await expect(flushLocalReadingOutbox('vault', repository)).rejects.toHaveProperty('name', 'QuotaExceededError')
    expect((await repository.readReadingLedger('vault')).sessions).toHaveLength(1)
    expect(await repository.listPendingReadingCaptures('vault')).toHaveLength(1)
    acknowledge.mockRestore()
    await flushLocalReadingOutbox('vault', repository)
    expect((await repository.readReadingLedger('vault')).sessions).toHaveLength(1)
    expect(await repository.listPendingReadingCaptures('vault')).toEqual([])
  })

  it('serializes concurrent flushes and drains a capture added during an active run', async () => {
    await repository.enqueueReadingCapture(capture('first'))
    const write = repository.writeReadingSession.bind(repository)
    let resume!: () => void
    vi.spyOn(repository, 'writeReadingSession').mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => { resume = resolve })
      return write(input)
    })
    const first = flushLocalReadingOutbox('vault', repository)
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'))
    await repository.enqueueReadingCapture(capture('second', 180_000))
    const second = flushLocalReadingOutbox('vault', repository)
    expect(second).toBe(first)
    resume()
    await Promise.all([first, second])
    expect((await repository.readReadingLedger('vault')).sessions).toHaveLength(2)
    expect(await repository.listPendingReadingCaptures('vault')).toEqual([])
  })

  it('removes pending plaintext captures with complete deletion and refuses late enqueue', async () => {
    await repository.enqueueReadingCapture(capture('pending'))
    await repository.removeBook(ref)
    expect(await repository.listPendingReadingCaptures('vault')).toHaveLength(1)
    await repository.removeBook(ref, true)
    expect(await repository.listPendingReadingCaptures('vault')).toEqual([])
    await expect(repository.enqueueReadingCapture(capture('late'))).rejects.toBeDefined()
  })

  it('arbitrates source-owned leases atomically without claiming another vault', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const claim = (deviceId: string, mode: 'auto' | 'manual', activityAt: number, explicit = false) => ({ deviceId, mode, activityAt, explicit })
    const results = await Promise.all([
      repository.claimReadingTimer('vault', claim('one', 'auto', 999_999)),
      repository.claimReadingTimer('vault', claim('two', 'auto', 999_999)),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await repository.claimReadingTimer('other', claim('two', 'auto', 999_999))).toBe(true)
    expect(await repository.claimReadingTimer('vault', claim('manual', 'manual', 1_000_000, true))).toBe(true)
    expect(await repository.claimReadingTimer('vault', claim('manual', 'auto', 1_000_000))).toBe(false)
    await repository.releaseReadingTimer('vault', 'one', 1_000_000)
    await repository.releaseReadingTimer('vault', 'manual', 999_999)
    expect(await repository.claimReadingTimer('vault', claim('next', 'auto', 1_000_000))).toBe(false)
    await repository.releaseReadingTimer('vault', 'manual', 1_000_000)
    expect(await repository.claimReadingTimer('vault', claim('next', 'auto', 1_000_000))).toBe(true)
    now.mockReturnValue(1_031_000)
    expect(await repository.claimReadingTimer('vault', claim('expired', 'auto', 1_030_000))).toBe(true)
  })

  it('reopens exact facts and shared midnight buckets without inventing positions or word counts', async () => {
    const saved = await repository.writeReadingSession(capture('first'))
    expect(saved?.durationSeconds).toBe(90)
    expect(saved?.capture.revisionId).toBeUndefined()
    expect(saved?.capture.wordCount).toBeUndefined()
    expect(splitReadingTime(saved!.acceptedFragments, saved!.capture.timezone!)).toEqual([
      { date: '2026-11-06', hour: 23, durationSeconds: 30 }, { date: '2026-11-07', hour: 0, durationSeconds: 60 },
    ])
    await repository.close()
    repository = new LocalLibraryRepository('reading-test')
    expect(await repository.readReadingLedger('vault', ref)).toEqual({ version: 1, sessions: [saved] })
    expect(await repository.writeReadingSession(capture('first'))).toEqual(saved)
    expect((await repository.readReadingLedger('vault')).version).toBe(1)
    await expect(repository.writeReadingSession({ ...capture('first'), durationSeconds: 10 })).rejects.toMatchObject({ category: 'conflict' })
  })

  it('subtracts vault-wide overlaps while keeping remote ownership fields out of capture', async () => {
    await repository.writeReadingSession(capture('first', 0, 60))
    const secondRef = { ...ref, bookId: 'another-book' }
    await repository.addBook({ ...book, ref: secondRef, content: { book: secondRef, contentId: 'revision' } }, new Blob(['abc']))
    const saved = await repository.writeReadingSession({ ...capture('second', 30_000, 120), book: secondRef })
    expect(saved?.durationSeconds).toBe(90)
    expect(saved?.acceptedFragments).toEqual([{ startedAt: start + 60_000, endedAt: start + 150_000 }])
    const anotherVault = { scope: { kind: 'local' as const, vaultId: 'other' }, bookId: 'book' }
    await repository.addBook({ ...book, ref: anotherVault, content: { book: anotherVault, contentId: 'revision' } }, new Blob(['abc']))
    expect((await repository.writeReadingSession({ ...capture('first'), book: anotherVault }))?.durationSeconds).toBe(90)
    expect((await repository.readReadingLedger('vault')).sessions).toHaveLength(2)
    expect((await repository.readReadingLedger('other')).sessions).toHaveLength(1)
    for (const field of ['bookId', 'expectedUserId', 'replaceSessionIds', 'finished']) expect(clientReadingCaptureSchema.safeParse({ ...capture('bad'), [field]: 'server-command' }).success).toBe(false)
  })

  it('records automatic below-threshold skips durably so a retry cannot count newly freed time', async () => {
    const first = await repository.writeReadingSession(capture('first', 0, 100))
    const automatic: ClientReadingCapture = { ...capture('auto', 60_000, 90), source: 'auto', revisionId: 'revision', startFraction: 0.1, endFraction: 0.2 }
    expect(await repository.writeReadingSession(automatic)).toBeNull()
    await repository.deleteReadingSession(ref, first!.id, first!.version, 'delete')
    expect(await repository.writeReadingSession(automatic)).toBeNull()
    expect((await repository.readReadingLedger('vault')).sessions).toEqual([])
  })

  it('keeps untimed retroactive dates unknown and rejects overlap or fabricated capture times', async () => {
    const untimed: ClientReadingCapture = { book: ref, requestId: 'date-only', source: 'retroactive', date: '2026-01-02', startedAt: null, durationSeconds: 600 }
    const saved = await repository.writeReadingSession(untimed)
    expect(saved?.capture.startedAt).toBeNull()
    expect(saved?.capture.endedAt).toBeUndefined()
    expect(saved?.acceptedFragments).toEqual([])
    await repository.writeReadingSession(capture('known'))
    await expect(repository.writeReadingSession({ ...capture('overlap'), source: 'retroactive' })).rejects.toMatchObject({ category: 'conflict' })
    const { startedAt: _startedAt, ...unknown } = capture('unknown')
    expect(clientReadingCaptureSchema.safeParse(unknown).success).toBe(false)
    await expect(repository.writeReadingSession({ ...capture('wrong-revision'), revisionId: 'foreign' })).rejects.toMatchObject({ category: 'invalid-input' })
    expect(clientReadingCaptureSchema.safeParse({ ...capture('unbound'), startFraction: 0.2 }).success).toBe(false)
  })

  it('uses CAS for edits/deletes and never resurrects a deleted fact on a delayed replay', async () => {
    const saved = (await repository.writeReadingSession(capture('first')))!
    const writes = await Promise.allSettled([
      repository.writeReadingSession(capture('edit-a'), { id: saved.id, version: 0 }),
      repository.writeReadingSession(capture('edit-b'), { id: saved.id, version: 0 }),
    ])
    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(writes.filter((result) => result.status === 'rejected')).toHaveLength(1)
    await expect(repository.deleteReadingSession(ref, saved.id, 0, 'stale-delete')).rejects.toMatchObject({ category: 'conflict' })
    await repository.deleteReadingSession(ref, saved.id, 1, 'delete')
    await repository.deleteReadingSession(ref, saved.id, 1, 'delete')
    expect(await repository.writeReadingSession(capture('first'))).toBeNull()
    expect(await repository.readReadingLedger('vault')).toEqual({ version: 3, sessions: [] })
  })

  it('rolls back fact and receipt together if receipt storage runs out of space', async () => {
    const put = IDBObjectStore.prototype.put
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'reading-receipts') throw new DOMException('Full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(repository.writeReadingSession(capture('retry'))).rejects.toMatchObject({ category: 'storage-full' })
    fault.mockRestore()
    expect(await repository.readReadingLedger('vault')).toEqual({ version: 0, sessions: [] })
    expect(await repository.writeReadingSession(capture('retry'))).not.toBeNull()
    expect((await repository.readReadingLedger('vault')).sessions).toHaveLength(1)
  })

  it('retains facts on content removal and deletes them only with complete personal-data deletion', async () => {
    const input = capture('retained')
    await repository.writeReadingSession(input)
    await repository.removeBook(ref)
    expect((await repository.readReadingLedger('vault')).sessions).toHaveLength(1)
    await repository.removeBook(ref, true)
    expect((await repository.readReadingLedger('vault')).sessions).toEqual([])
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('reading-test')
      open.onsuccess = () => {
        const read = open.result.transaction('reading-receipts').objectStore('reading-receipts').getAll()
        read.onsuccess = () => {
          expect(read.result).toHaveLength(1)
          expect(Object.keys(read.result[0]).sort()).toEqual(['fingerprint', 'sessionId'])
          expect(read.result[0].fingerprint).toMatch(/^[a-f0-9]{64}$/)
          open.result.close()
          resolve()
        }
        read.onerror = () => reject(read.error)
      }
      open.onerror = () => reject(open.error)
    })
    await expect(repository.writeReadingSession(input)).rejects.toBeDefined()
    await expect(repository.addBook(book, new Blob(['abc']))).rejects.toMatchObject({ category: 'conflict' })
  })
})

it('adds version-3 ledger stores without replacing version-2 content or personal records', async () => {
  await repository.close()
  const state: ClientReadingState = { book: ref, readStatus: 'reading', position: null, fraction: 0.3, coverage: null, lastReadAt: 100, updatedAt: 100, version: 2 }
  const note: ClientNote = { id: 'existing-note', book: ref, kind: 'highlight', locator: null, text: 'Retained quotation', color: 'yellow', style: 'underline', chapter: null, createdAt: 1, updatedAt: 1, version: 1 }
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('old-vault', 2)
    open.onupgradeneeded = () => { for (const store of ['books', 'files', 'states', 'notes', 'deleted', 'settings']) open.result.createObjectStore(store) }
    open.onsuccess = () => {
      const tx = open.result.transaction(['books', 'files', 'states', 'notes', 'settings'], 'readwrite')
      const key = JSON.stringify(['local', 'vault', 'book'])
      tx.objectStore('books').put(book, key)
      tx.objectStore('files').put(new Blob(['abc']), key)
      tx.objectStore('states').put(state, key)
      tx.objectStore('notes').put(note, JSON.stringify([['local', 'vault', 'book'], note.id]))
      tx.objectStore('settings').put({ viewSettings: { fontSize: 23 } }, key)
      tx.oncomplete = () => { open.result.close(); resolve() }
      tx.onabort = () => reject(tx.error)
    }
    open.onerror = () => reject(open.error)
  })
  repository = new LocalLibraryRepository('old-vault')
  expect(await repository.getBook(ref)).toEqual(book)
  expect(await (await repository.getFile(ref)).text()).toBe('abc')
  expect(await repository.getPreferences(ref)).toEqual({ viewSettings: { fontSize: 23 } })
  expect(await repository.getState(ref)).toEqual(state)
  expect(await repository.listNotes(ref)).toEqual([note])
  expect(await repository.readReadingLedger('vault')).toEqual({ version: 0, sessions: [] })
  expect(await repository.writeReadingSession(capture('first'))).not.toBeNull()
})
