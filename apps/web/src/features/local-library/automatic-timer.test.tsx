import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { setImmediate as nextTurn } from 'node:timers'

import { IDBFactory } from 'fake-indexeddb'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientBook } from '@bookdock/shared'

import { useReadingTimer } from '../reader/hooks/useReadingTimer'
import { useManualTimerStore } from '../reader/lib/manual-timer-store'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

import { localAutomaticTimerDestination } from './automatic-timer'
import { createLocalManualTimer } from './manual-timer'
import { LocalLibraryRepository } from './repository'

const ref = { scope: { kind: 'local' as const, vaultId: 'timer-vault' }, bookId: 'same-book' }
const book: ClientBook = { ref, title: 'Local book', authors: [], format: 'epub', content: { book: ref, contentId: 'revision' }, availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0 }
let repository: LocalLibraryRepository
const onError = vi.fn()

async function spin(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await check()) return
    await new Promise<void>((resolve) => nextTurn(resolve))
  }
  throw new Error('Storage operation did not settle')
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(Date.parse('2026-11-07T00:00:00Z'))
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local timer must not send HTTP requests') }))
  localStorage.clear()
  useAuthStore.getState().clearAuth()
  useManualTimerStore.setState({ sessions: {} })
  useUiStore.setState({ readingTimerMode: 'auto', manualTimerGraceMinutes: 5 })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  onError.mockClear()
  repository = new LocalLibraryRepository('automatic-timer')
  await repository.addBook(book, new Blob(['abc']))
})
afterEach(async () => { cleanup(); await repository.close(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function mount(manualStore?: typeof useManualTimerStore) {
  const destination = localAutomaticTimerDestination(ref, onError, repository)
  const load = destination.loadDraft.bind(destination)
  let loaded = false
  destination.loadDraft = async () => { const value = await load(); loaded = true; return value }
  const claim = destination.claim.bind(destination)
  let claimed = false
  destination.claim = async (at) => { const value = await claim(at); claimed = value; return value }
  const hook = renderHook(() => useReadingTimer(ref.bookId, destination, manualStore))
  await act(async () => { await spin(() => loaded) })
  act(() => hook.result.current.ping({ fraction: 0.1, segmentStart: 0.1, revisionId: 'revision' }))
  await act(async () => { await spin(() => claimed) })
  return { ...hook, destination }
}

describe('existing automatic capture with a local destination', () => {
  it('records anonymous local activity and keeps it independent of service account changes', async () => {
    const hook = await mount()
    act(() => vi.advanceTimersByTime(30_000))
    act(() => useAuthStore.getState().setAuth({ id: 'service-account', username: 'service', role: 'member' }))
    act(() => vi.advanceTimersByTime(30_000))
    act(() => { hook.result.current.ping({ fraction: 0.2, segmentStart: 0.1, revisionId: 'revision' }); hook.result.current.flush() })
    await hook.destination.retry()
    const ledger = await repository.readReadingLedger('timer-vault')
    expect(ledger.sessions).toHaveLength(1)
    expect(ledger.sessions[0]?.durationSeconds).toBe(60)
    expect(ledger.sessions[0]?.capture.book).toEqual(ref)
    expect(ledger.sessions[0]?.capture.revisionId).toBe('revision')
    expect(Object.keys(localStorage).some((key) => key.startsWith('bd-reading-auto:'))).toBe(false)
    expect(onError).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('restores measured fragments within grace without counting the time spent away', async () => {
    const first = await mount()
    act(() => vi.advanceTimersByTime(20_000))
    first.unmount()
    await first.destination.retry()
    expect(await repository.listReadingTimerDrafts('timer-vault')).toHaveLength(1)
    act(() => vi.advanceTimersByTime(60_000))
    const second = await mount()
    act(() => vi.advanceTimersByTime(40_000))
    act(() => second.result.current.flush())
    await second.destination.retry()
    const sessions = (await repository.readReadingLedger('timer-vault')).sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.durationSeconds).toBe(60)
    expect(sessions[0]?.acceptedFragments.map((fragment) => (fragment.endedAt - fragment.startedAt) / 1000)).toEqual([20, 40])
    expect(onError).not.toHaveBeenCalled()
    second.unmount()
  })

  it('retains finalized capture in memory when storage fails and commits it on explicit retry', async () => {
    const hook = await mount()
    act(() => vi.advanceTimersByTime(60_000))
    await hook.destination.retry()
    const enqueue = vi.spyOn(repository, 'enqueueReadingCaptureGroup').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'))
    act(() => hook.result.current.flush())
    await act(async () => { await spin(() => onError.mock.calls.length > 0) })
    expect((await repository.readReadingLedger('timer-vault')).sessions).toEqual([])
    enqueue.mockRestore()
    await hook.destination.retry()
    expect((await repository.readReadingLedger('timer-vault')).sessions.map((session) => session.durationSeconds)).toEqual([60])
    hook.unmount()
  })

  it('settles an expired persisted capture on re-entry without including the closed interval', async () => {
    const first = await mount()
    act(() => vi.advanceTimersByTime(70_000))
    first.unmount()
    await first.destination.retry()
    act(() => vi.advanceTimersByTime(301_000))
    const next = await mount()
    await next.destination.retry()
    expect((await repository.readReadingLedger('timer-vault')).sessions.map((session) => session.durationSeconds)).toEqual([70])
    expect(onError).not.toHaveBeenCalled()
    next.unmount()
  })

  it('never revives capture when a draft finishes loading after unmount', async () => {
    const destination = localAutomaticTimerDestination(ref, onError, repository)
    let resolve!: (snapshot: undefined) => void
    destination.loadDraft = () => new Promise((done) => { resolve = done })
    const claim = vi.spyOn(destination, 'claim')
    const hook = renderHook(() => useReadingTimer(ref.bookId, destination))
    act(() => hook.result.current.ping({ fraction: 0.1, revisionId: 'revision' }))
    hook.unmount()
    await act(async () => { resolve(undefined); await new Promise<void>((done) => nextTurn(done)) })
    expect(claim).not.toHaveBeenCalled()
    expect(await repository.listReadingTimerDrafts('timer-vault')).toEqual([])
    expect((await repository.readReadingLedger('timer-vault')).sessions).toEqual([])
  })
})


describe('source-specific automatic and manual priority', () => {
  it('settles automatic activity at local manual start and resumes without counting the manual interval twice', async () => {
    const manual = createLocalManualTimer('timer-vault', repository)
    await manual.useStore.getState().restore()
    const hook = await mount(manual.useStore)
    try {
      act(() => vi.advanceTimersByTime(20_000))
      act(() => manual.useStore.getState().start(ref.bookId, { cfi: null, fraction: 0.1, revisionId: 'revision' }))
      await manual.flush()
      act(() => vi.advanceTimersByTime(20_000))
      act(() => manual.useStore.getState().terminate(ref.bookId))
      await manual.flush()
      act(() => vi.advanceTimersByTime(60_000))
      act(() => hook.result.current.flush())
      await hook.destination.retry()
      const sessions = (await repository.readReadingLedger('timer-vault')).sessions
      expect(sessions.map((session) => [session.capture.source, session.durationSeconds])).toEqual(expect.arrayContaining([['manual', 20], ['auto', 60]]))
      expect(sessions).toHaveLength(2)
    } finally { hook.unmount(); await hook.destination.retry(); manual.dispose() }
  })
})
