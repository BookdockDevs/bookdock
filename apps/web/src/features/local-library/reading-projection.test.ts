import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook, ClientReadingCapture } from '@bookdock/shared'

import { projectLocalReadingBook } from './reading-projection'
import { flushLocalReadingOutbox } from './reading-outbox'
import { LocalLibraryRepository } from './repository'

const ref = { scope: { kind: 'local' as const, vaultId: 'projection-vault' }, bookId: 'book' }
const content = { book: ref, contentId: 'revision' }
const book: ClientBook = { ref, content, title: 'Book', authors: ['Author'], format: 'epub', availability: 'available', size: 3, version: 0, createdAt: 1, updatedAt: 1 }
const base = Date.parse('2026-11-07T23:59:30Z')
const capture = (requestId: string, offset: number, durationSeconds: number): ClientReadingCapture => ({ book: ref, requestId, source: 'auto', date: '2026-11-07', startedAt: base + offset, endedAt: base + offset + durationSeconds * 1000, fragments: [{ startedAt: base + offset, endedAt: base + offset + durationSeconds * 1000 }], timezone: 'UTC', durationSeconds, revisionId: 'revision', startFraction: 0.1, endFraction: 0.2, wordCount: 1000, coverage: [[0.1, 0.2]] })
let repository: LocalLibraryRepository
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local reading projections must not use HTTP') }))
  repository = new LocalLibraryRepository('reading-projections')
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('single-source atomic reading projections', () => {
  it('aggregates logical groups once while attributing actual accepted time by recorded zone and date', async () => {
    await repository.enqueueReadingCaptureGroup({ id: 'logical', book: ref, captures: [capture('logical.0', 0, 30), { ...capture('logical.1', 30_000, 40), coverage: [] }] }, base + 70_000)
    await flushLocalReadingOutbox('projection-vault', repository)
    const snapshot = await repository.readReadingBookSnapshot(ref)
    const all = projectLocalReadingBook(snapshot)
    expect(all.sessions).toHaveLength(1)
    expect(all.sessions[0]).toMatchObject({ id: 'logical', durationSeconds: 70, clientMembers: expect.any(Array) })
    expect(all.sessions[0].clientMembers).toHaveLength(2)
    expect(all.overview.totalWordsRead).toBeCloseTo(100)
    expect(all.overview.totalSeconds).toBe(70)
    expect(all.stats.daily.map((day) => [day.date, day.durationSeconds])).toEqual([['2026-11-07', 30], ['2026-11-08', 40]])
    expect(all.stats.readingDays).toBe(0)
    expect(all.stats.daily.every((day) => day.cumulativeCoverage === null)).toBe(true)
    const scoped = projectLocalReadingBook(snapshot, { from: '2026-11-08', to: '2026-11-08' })
    expect(scoped.overview.totalSeconds).toBe(70)
    expect(scoped.stats.totalSeconds).toBe(40)
    expect(scoped.stats.totalWordsRead).toBeCloseTo(100 * 40 / 70)
    expect(scoped.stats.hourly[0].durationSeconds).toBe(40)
    expect(scoped.stats.hourly[23].durationSeconds).toBe(0)
    expect(scoped.sessions[0].contributionDates).toEqual(['2026-11-07', '2026-11-08'])
  })
  it('keeps untimed reading out of hours, retains nullable historical clocks and preserves unknown words', async () => {
    await repository.setReadStatus(ref, 'finished')
    await repository.addReadingEntry({ capture: { book: ref, source: 'retroactive', requestId: 'untimed', date: '2026-10-01', startedAt: null, durationSeconds: 90 }, finished: false })
    const result = projectLocalReadingBook(await repository.readReadingBookSnapshot(ref))
    expect(result.sessions[0]).toMatchObject({ startedAt: null, endedAt: null, timezone: '', wordCount: null, progressScale: null })
    expect(result.stats.hourly.every((hour) => hour.durationSeconds === 0 && hour.days === 0)).toBe(true)
    expect(result.stats.totalSeconds).toBe(90)
    expect(result.stats.totalWordsRead).toBeNull()
    expect(result.stats.wordState).toBe('unknown')
    expect(result.overview.rounds[0]).toMatchObject({ startedAt: null, endedAt: null, status: 'finished' })
    expect(result.overview.earliestDate).toBe('2026-10-01')
  })
  it('buckets repeated daylight-saving hours without attributing time away', async () => {
    const startedAt = Date.parse('2026-11-01T05:30:00Z')
    await repository.writeReadingSession({ ...capture('fold', 0, 7200), source: 'manual', date: '2026-11-01', startedAt, endedAt: startedAt + 7200_000, fragments: [{ startedAt, endedAt: startedAt + 7200_000 }], timezone: 'America/New_York' })
    const result = projectLocalReadingBook(await repository.readReadingBookSnapshot(ref))
    expect(result.stats.totalSeconds).toBe(7200)
    expect(result.stats.hourly[1].durationSeconds).toBe(5400)
    expect(result.stats.hourly[2].durationSeconds).toBe(1800)
    expect(result.stats.readingDays).toBe(1)
  })
  it('retains timer-off round coverage through reread and undo without moving the locator', async () => {
    const state = await repository.saveState({ book: ref, readStatus: 'reading', position: null, fraction: 0.3, coverage: { content, fraction: 0.2, available: true }, lastReadAt: base, updatedAt: base, version: 0 }, 0, [[0.1, 0.3]])
    const first = await repository.readReadingBookSnapshot(ref)
    expect(projectLocalReadingBook(first).overview.coverage).toBeCloseTo(0.2)
    const reread = await repository.changeReadingRound(ref, 'reread', first.rounds.version, 'reread')
    const next = await repository.readReadingBookSnapshot(ref)
    expect(projectLocalReadingBook(next).overview.coverage).toBe(0)
    expect(projectLocalReadingBook(next).overview.rounds.find((round) => round.ordinal === 1)?.coverage).toBeCloseTo(0.2)
    await repository.changeReadingRound(ref, 'continue', reread.version, 'undo')
    const restored = await repository.readReadingBookSnapshot(ref)
    expect(projectLocalReadingBook(restored).overview.coverage).toBeCloseTo(0.2)
    expect(restored.state?.fraction).toBe(state.fraction)
    expect(restored.ledger.version).toBeGreaterThan(first.ledger.version)
  })
  it('does not undo a reread with timer-off coverage merely because it has no timed sessions', async () => {
    const initial = await repository.changeReadingRound(ref, 'reread', 0, 'reread')
    const state = (await repository.getState(ref))!
    await repository.saveState({ ...state, fraction: 0.2, coverage: { content, fraction: 0.1, available: true } }, state.version, [[0.1, 0.2]])
    const measured = await repository.readReadingBookSnapshot(ref)
    const continued = await repository.changeReadingRound(ref, 'continue', measured.rounds.version, 'continue')
    expect(continued.rounds.at(-1)?.id).toBe(initial.rounds.at(-1)?.id)
    expect(continued.rounds).toHaveLength(2)
    expect(projectLocalReadingBook(await repository.readReadingBookSnapshot(ref)).overview.coverage).toBeCloseTo(0.1)
  })

  it('keeps historical words but refuses current-content coverage or anchor scale for an unmatched revision', async () => {
    await repository.writeReadingSession(capture('historical', 0, 60))
    const snapshot = await repository.readReadingBookSnapshot(ref)
    snapshot.book.content = { ...content, contentId: 'new-revision' }
    const result = projectLocalReadingBook(snapshot)
    expect(result.sessions[0].progressScale).toBeNull()
    expect(result.sessions[0].projectedCoverage).toEqual([])
    expect(result.overview.unalignedCoverage).toBe(true)
    expect(result.overview.coverage).toBe(0)
    expect(result.overview.totalWordsRead).toBeCloseTo(100)
    expect(result.stats.remainingSeconds).toBeNull()
  })
  it('does not invalidate visible data for lease writes and reads facts/version from one transaction', async () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    await repository.claimReadingTimer('projection-vault', { deviceId: 'device', mode: 'auto', activityAt: base })
    await repository.releaseReadingTimer('projection-vault', 'device', base)
    expect(dispatch).not.toHaveBeenCalled()
    const [read] = await Promise.all([repository.readReadingBookSnapshot(ref), repository.writeReadingSession(capture('concurrent', 0, 60))])
    expect([[0, 0], [1, 1]]).toContainEqual([read.ledger.sessions.length, read.ledger.version])
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})


describe('logical local session deletion', () => {
  it('checks complete displayed membership, rolls back a partial failure and cannot delete successor facts on replay', async () => {
    const group = { id: 'logical', book: ref, captures: [capture('logical.0', 0, 30), { ...capture('logical.1', 30_000, 30), coverage: [] }] }
    await repository.enqueueReadingCaptureGroup(group, base + 60_000)
    await flushLocalReadingOutbox('projection-vault', repository)
    const session = projectLocalReadingBook(await repository.readReadingBookSnapshot(ref)).sessions[0]
    const command = { book: ref, id: session.id, members: session.clientMembers!, requestId: 'delete-logical' }
    await expect(repository.deleteReadingLogicalSession({ ...command, members: command.members.slice(0, 1) })).rejects.toMatchObject({ category: 'conflict' })
    await expect(repository.deleteReadingLogicalSession({ ...command, members: command.members.map((member) => ({ ...member, version: 99 })) })).rejects.toMatchObject({ category: 'conflict' })
    const remove = IDBObjectStore.prototype.delete
    let count = 0
    const fault = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof remove>) {
      if (this.name === 'reading-sessions' && ++count === 2) throw new DOMException('Failure', 'UnknownError')
      return remove.apply(this, args)
    })
    await expect(repository.deleteReadingLogicalSession(command)).rejects.toThrow()
    fault.mockRestore()
    expect((await repository.readReadingLedger('projection-vault')).sessions).toHaveLength(2)
    await repository.deleteReadingLogicalSession(command)
    expect((await repository.readReadingLedger('projection-vault')).sessions).toEqual([])
    await repository.writeReadingSession(capture('successor', 120_000, 60))
    await repository.deleteReadingLogicalSession(command)
    await repository.enqueueReadingCaptureGroup(group, base + 60_000)
    await flushLocalReadingOutbox('projection-vault', repository)
    expect((await repository.readReadingLedger('projection-vault')).sessions.map((row) => row.capture.requestId)).toEqual(['successor'])
    await expect(repository.deleteReadingLogicalSession({ ...command, id: 'successor' })).rejects.toMatchObject({ category: 'conflict' })
  })
})
