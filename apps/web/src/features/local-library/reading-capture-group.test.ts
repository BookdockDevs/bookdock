import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook, ClientManualTimerSnapshot, ClientReadingCapture, ClientReadingCaptureGroup, ClientReadingTimerDraft } from '@bookdock/shared'

import { localAutomaticTimerDestination } from './automatic-timer'
import { flushLocalReadingOutbox } from './reading-outbox'
import { LocalLibraryRepository } from './repository'

const base = Date.parse('2026-11-07T00:00:00Z')
const ref = { scope: { kind: 'local' as const, vaultId: 'group-vault' }, bookId: 'book' }
const book: ClientBook = { ref, content: { book: ref, contentId: 'revision' }, title: 'Book', authors: [], format: 'epub', availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
const capture = (requestId: string, offset: number, seconds: number): ClientReadingCapture => ({ book: ref, requestId, source: 'auto', date: '2026-11-07', durationSeconds: seconds, startedAt: base + offset, endedAt: base + offset + seconds * 1000, timezone: 'UTC', fragments: [{ startedAt: base + offset, endedAt: base + offset + seconds * 1000 }], revisionId: 'revision', startFraction: 0.1, endFraction: 0.2 })
const group = (): ClientReadingCaptureGroup => ({ id: 'logical', book: ref, captures: [capture('logical.0', 0, 30), capture('logical.1', 30_000, 40)] })
let repository: LocalLibraryRepository
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local capture must not use HTTP') }))
  repository = new LocalLibraryRepository('capture-groups')
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('bounded logical timer captures', () => {
  it('applies the automatic minimum to the accepted group and retains sub-minute chunks', async () => {
    await repository.enqueueReadingCaptureGroup(group(), base + 70_000)
    await flushLocalReadingOutbox('group-vault', repository)
    const ledger = await repository.readReadingLedger('group-vault')
    expect(ledger.sessions.map((session) => session.durationSeconds)).toEqual(expect.arrayContaining([30, 40]))
    expect(ledger.sessions).toHaveLength(2)
    expect(ledger.sessions.map((session) => session.groupId)).toEqual(['logical', 'logical'])
    await repository.enqueueReadingCaptureGroup(group(), base + 70_000)
    await flushLocalReadingOutbox('group-vault', repository)
    expect((await repository.readReadingLedger('group-vault')).sessions).toHaveLength(2)
    await expect(repository.enqueueReadingCaptureGroup({ ...group(), captures: [capture('logical.0', 0, 31), capture('logical.1', 31_000, 40)] }, base + 71_000)).rejects.toMatchObject({ category: 'conflict' })
  })

  it('atomically saves an explicit manual group with finish, retaining the paused snapshot after a later-part failure', async () => {
    const paused: ClientManualTimerSnapshot = { book: ref, requestId: 'logical', deviceId: 'device', date: '2026-11-07', timezone: 'UTC', phase: 'paused', startedAt: base, elapsedMs: 70_000, lastResumeAt: null, suspendedAt: null, expiresAt: null, updatedAt: base + 70_000, fragments: [{ startedAt: base, endedAt: base + 70_000 }], coverage: [], startCfi: null, lastCfi: null, startFraction: null, lastFraction: null, startChapterIndex: null, lastChapterIndex: null }
    await repository.saveManualTimerSnapshot(paused)
    const entry = { group: { ...group(), captures: group().captures.map((capture) => ({ ...capture, source: 'manual' as const, deviceId: 'device' })) }, finished: true, expectedManualUpdatedAt: paused.updatedAt }
    const put = IDBObjectStore.prototype.put
    let count = 0
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'reading-sessions' && ++count === 2) throw new DOMException('Full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(repository.addReadingGroupEntry(entry)).rejects.toMatchObject({ category: 'storage-full' })
    fault.mockRestore()
    expect(await repository.readReadingLedger('group-vault')).toEqual({ sessions: [], version: 0 })
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([paused])
    expect(await repository.getState(ref)).toBeNull()
    await repository.addReadingGroupEntry(entry)
    expect((await repository.readReadingLedger('group-vault')).sessions).toHaveLength(2)
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([])
    expect((await repository.getState(ref))?.readStatus).toBe('finished')
    const rounds = await repository.readReadingRounds(ref)
    await repository.changeReadingRound(ref, 'reread', rounds.version, 'reread-after-group')
    await repository.addReadingGroupEntry(entry)
    expect((await repository.getState(ref))?.readStatus).toBe('reading')
    expect((await repository.readReadingLedger('group-vault')).sessions).toHaveLength(2)
    await expect(repository.addReadingGroupEntry({ ...entry, finished: false })).rejects.toMatchObject({ category: 'conflict' })
    await expect(repository.saveManualTimerSnapshot(paused)).rejects.toMatchObject({ category: 'conflict' })
  })

  it('subtracts overlap before group eligibility and never resurrects a skipped group', async () => {
    const prior = (await repository.writeReadingSession({ ...capture('prior', 0, 20), source: 'manual' }))!
    await repository.enqueueReadingCaptureGroup(group(), base + 70_000)
    await flushLocalReadingOutbox('group-vault', repository)
    expect((await repository.readReadingLedger('group-vault')).sessions.map((session) => session.durationSeconds)).toEqual([20])
    await repository.deleteReadingSession(ref, prior.id, prior.version, 'delete-prior')
    await repository.enqueueReadingCaptureGroup(group(), base + 70_000)
    await flushLocalReadingOutbox('group-vault', repository)
    expect((await repository.readReadingLedger('group-vault')).sessions).toEqual([])
  })

  it('rolls back every group fact and receipt if storage fails on a later chunk', async () => {
    await repository.enqueueReadingCaptureGroup(group(), base + 70_000)
    const put = IDBObjectStore.prototype.put
    let count = 0
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'reading-sessions' && ++count === 2) throw new DOMException('Full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(flushLocalReadingOutbox('group-vault', repository)).rejects.toMatchObject({ category: 'storage-full' })
    fault.mockRestore()
    expect(await repository.readReadingLedger('group-vault')).toEqual({ version: 0, sessions: [] })
    expect(await repository.listPendingReadingCaptureGroups('group-vault')).toHaveLength(1)
    await flushLocalReadingOutbox('group-vault', repository)
    expect((await repository.readReadingLedger('group-vault')).sessions).toHaveLength(2)
  })

  it('preserves the grace draft when promotion fails and refuses late resumed writes after promotion', async () => {
    const draft: ClientReadingTimerDraft = { capture: capture('logical', 0, 20), phase: 'suspended', suspendedAt: base + 20_000, updatedAt: base + 20_000, expiresAt: base + 86400_000 }
    await repository.saveReadingTimerDraft(draft)
    const put = IDBObjectStore.prototype.put
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'settings' && String(args[1]).includes('reading-pending-group')) throw new DOMException('Full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(repository.enqueueReadingCaptureGroup(group(), base + 70_000)).rejects.toMatchObject({ category: 'storage-full' })
    fault.mockRestore()
    expect(await repository.listReadingTimerDrafts('group-vault')).toEqual([draft])
    expect(await repository.listPendingReadingCaptureGroups('group-vault')).toEqual([])
    await repository.enqueueReadingCaptureGroup(group(), base + 70_000)
    expect(await repository.listReadingTimerDrafts('group-vault')).toEqual([])
    await expect(repository.saveReadingTimerDraft({ ...draft, updatedAt: base + 80_000 })).rejects.toMatchObject({ category: 'conflict' })
    await repository.removeBook(ref, true)
    expect(await repository.listPendingReadingCaptureGroups('group-vault')).toEqual([])
  })

  it('splits an oversized fractional capture without losing its measured tail or fabricating the next date', async () => {
    const destination = localAutomaticTimerDestination(ref, vi.fn(), repository)
    const original = capture('long', 0, 86400)
    const { book: _book, ...record } = original
    record.endedAt = base + 86400_000 + 500
    record.fragments = [{ startedAt: base, endedAt: record.endedAt }]
    await destination.enqueue({ pendingRecord: { ...record, bookId: ref.bookId }, phase: 'queued', suspendedAt: record.endedAt, expiresAt: record.endedAt, updatedAt: record.endedAt })
    await destination.retry()
    const sessions = (await repository.readReadingLedger('group-vault')).sessions
    expect(sessions.find((session) => session.capture.requestId === 'long.0')).toMatchObject({ durationSeconds: 86400, capture: { date: '2026-11-07' } })
    expect(sessions.find((session) => session.capture.requestId === 'long.1')).toMatchObject({ durationSeconds: 0.5, capture: { date: '2026-11-08' } })
    expect(sessions.map((session) => session.groupId)).toEqual(['long', 'long'])
  })

  it.each([{ count: 5001, activeMs: 20, seconds: 100, durations: [100, 0.02] }, { count: 6000, activeMs: 10, seconds: 60, durations: [50, 10] }])('retains fragment-bound tails at $seconds measured seconds', async ({ count, activeMs, seconds, durations }) => {
    const destination = localAutomaticTimerDestination(ref, vi.fn(), repository)
    const input = capture('fragmented', 0, seconds)
    const { book: _book, ...record } = input
    record.fragments = Array.from({ length: count }, (_, index) => ({ startedAt: base + index * 40, endedAt: base + index * 40 + activeMs }))
    record.endedAt = record.fragments.at(-1)!.endedAt
    await destination.enqueue({ pendingRecord: { ...record, bookId: ref.bookId }, phase: 'queued', suspendedAt: record.endedAt, expiresAt: record.endedAt, updatedAt: record.endedAt })
    await destination.retry()
    const sessions = (await repository.readReadingLedger('group-vault')).sessions
    expect(sessions).toHaveLength(2)
    expect(sessions.map((session) => session.durationSeconds)).toEqual(expect.arrayContaining(durations))
  })
})


describe('durable manual timer snapshots', () => {
  const snapshot = (): ClientManualTimerSnapshot => ({
    book: ref, requestId: 'manual', deviceId: 'device', date: '2026-11-07', timezone: 'UTC',
    phase: 'paused', startedAt: base, elapsedMs: 0, lastResumeAt: null,
    suspendedAt: null, expiresAt: null, updatedAt: base, fragments: [], coverage: [],
    startCfi: null, lastCfi: null, startFraction: null, lastFraction: null,
    startChapterIndex: null, lastChapterIndex: null,
  })
  it('retains zero and subsecond paused timers without expiry and ignores stale acknowledgements', async () => {
    const first = snapshot()
    expect(await repository.saveManualTimerSnapshot(first)).toBe(true)
    const next = { ...first, elapsedMs: 250, fragments: [{ startedAt: base, endedAt: base + 250 }], updatedAt: base + 250 }
    expect(await repository.saveManualTimerSnapshot(next)).toBe(true)
    expect(await repository.saveManualTimerSnapshot(first)).toBe(false)
    await repository.acknowledgeManualTimerSnapshot(first)
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([next])
    expect(await repository.listManualTimerSnapshots('other-vault')).toEqual([])
    await flushLocalReadingOutbox('group-vault', repository)
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([next])
    await repository.removeBook(ref, false)
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([next])
    await repository.removeBook(ref, true)
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([])
  })
  it('atomically promotes manual snapshots, rolls back failure and rejects finalized resurrection', async () => {
    const saved = { ...snapshot(), elapsedMs: 2000, fragments: [{ startedAt: base, endedAt: base + 2000 }], updatedAt: base + 2000 }
    await repository.saveManualTimerSnapshot(saved)
    const manualGroup: ClientReadingCaptureGroup = { id: 'manual', book: ref, captures: [{ ...capture('manual', 0, 2), deviceId: 'device', source: 'manual' }] }
    const put = IDBObjectStore.prototype.put
    const fault = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
      if (this.name === 'settings' && String(args[1]).includes('reading-pending-group')) throw new DOMException('Full', 'QuotaExceededError')
      return put.apply(this, args)
    })
    await expect(repository.enqueueReadingCaptureGroup(manualGroup, base + 2000)).rejects.toMatchObject({ category: 'storage-full' })
    fault.mockRestore()
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([saved])
    await repository.enqueueReadingCaptureGroup(manualGroup, base + 2000)
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([])
    await expect(repository.saveManualTimerSnapshot(saved)).rejects.toMatchObject({ category: 'conflict' })
    await flushLocalReadingOutbox('group-vault', repository)
    expect((await repository.readReadingLedger('group-vault')).sessions.map((entry) => entry.durationSeconds)).toEqual([2])
    const successor = { ...snapshot(), requestId: 'successor', updatedAt: base + 3000 }
    await repository.saveManualTimerSnapshot(successor)
    await repository.enqueueReadingCaptureGroup(manualGroup, base + 4000)
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([successor])
  })
  it('recovers expired suspended manual timers from another device and finalizes empty captures without resurrection', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(base + 10_000)
    const expired: ClientManualTimerSnapshot = { ...snapshot(), deviceId: 'closed-tab', phase: 'suspended', elapsedMs: 2000, fragments: [{ startedAt: base, endedAt: base + 2000 }], suspendedAt: base + 2000, expiresAt: base + 5000, updatedAt: base + 2000 }
    await repository.saveManualTimerSnapshot(expired)
    await flushLocalReadingOutbox('group-vault', repository)
    await flushLocalReadingOutbox('group-vault', repository)
    expect((await repository.readReadingLedger('group-vault')).sessions.map((value) => value.durationSeconds)).toEqual([2])
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([])
    const empty: ClientManualTimerSnapshot = { ...snapshot(), requestId: 'empty', phase: 'suspended', suspendedAt: base, expiresAt: base + 5000 }
    await repository.saveManualTimerSnapshot(empty)
    await flushLocalReadingOutbox('group-vault', repository)
    await expect(repository.saveManualTimerSnapshot(empty)).rejects.toMatchObject({ category: 'conflict' })
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([])
  })

  it('rejects inconsistent measured time and expiring explicit pauses', async () => {
    await expect(repository.saveManualTimerSnapshot({ ...snapshot(), elapsedMs: 1 })).rejects.toThrow()
    await expect(repository.saveManualTimerSnapshot({ ...snapshot(), expiresAt: base + 1000 })).rejects.toThrow()
    expect(await repository.listManualTimerSnapshots('group-vault')).toEqual([])
  })
})
