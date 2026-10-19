import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import { useManualTimerStore } from '@/features/reader/lib/manual-timer-store'
import { queueReadingRecord } from '@/features/reader/lib/reading-record-queue'
import { claimReadingTimer } from '@/features/reader/lib/reading-timer-lease'
import { useReadingTimer } from '../features/reader/hooks/useReadingTimer'

vi.mock('@/features/reader/lib/reading-record-queue', () => ({
  queueReadingRecord: vi.fn(), retryReadingRecords: vi.fn(),
  newReadingRequestId: () => crypto.randomUUID(), readingTimezone: () => 'Asia/Shanghai',
  useReadingSaveState: { setState: vi.fn() },
}))
vi.mock('@/features/reader/lib/reading-timer-lease', () => ({
  claimReadingTimer: vi.fn().mockResolvedValue(true), releaseReadingTimer: vi.fn(), readingDeviceId: () => 'device-test',
}))

let hidden = false
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1785000000000)
  vi.clearAllMocks()
  localStorage.clear()
  useUiStore.setState({ readingTimerMode: 'auto', manualTimerGraceMinutes: 5 })
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  useAuthStore.setState({ user: { id: 'u1', username: 'reader', role: 'user' } })
  useManualTimerStore.setState({ sessions: {} })
})
afterEach(() => vi.useRealTimers())

function begin() {
  const hook = renderHook(() => useReadingTimer('book-1'))
  act(() => hook.result.current.ping({ fraction: 0.1, segmentStart: 0.1 }))
  return hook
}
function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms))
}

describe('automatic reading capture', () => {
  it('waits for a valid fraction and retains complete bounds through incomplete relocation events', () => {
    const hook = renderHook(() => useReadingTimer('book-1'))
    act(() => hook.result.current.ping({ cfi: 'txt:0' }))
    advance(30_000)
    act(() => hook.result.current.ping({ fraction: 0.1, segmentStart: 0.1, revisionId: 'revision-1', wordCount: 1000 }))
    advance(30_000)
    act(() => hook.result.current.ping({ cfi: 'transient-position' }))
    advance(30_000)
    act(() => hook.result.current.ping({ fraction: 0.2, segmentStart: 0.1, revisionId: 'revision-1', wordCount: 1000 }))
    act(() => hook.result.current.flush())
    expect(queueReadingRecord).toHaveBeenCalledWith('u1', expect.objectContaining({
      durationSeconds: 60, startedAt: 1785000030000, startFraction: 0.1, endFraction: 0.2,
      revisionId: 'revision-1', wordCount: 1000, coverage: [[0.1, 0.2]],
    }))
    hook.unmount()
  })
  it('requires a rendered reading activity before counting', () => {
    const hook = renderHook(() => useReadingTimer('book-1'))
    advance(60_000)
    hook.unmount()
    expect(queueReadingRecord).not.toHaveBeenCalled()
  })
  it('captures exact effective fragments on flush', () => {
    const hook = begin()
    advance(60_000)
    act(() => hook.result.current.flush())
    expect(queueReadingRecord).toHaveBeenCalledWith('u1', expect.objectContaining({
      source: 'auto', durationSeconds: 60,
      fragments: [{ startedAt: 1785000000000, endedAt: 1785000060000 }],
    }))
    hook.unmount()
  })
  it('excludes idle gaps while resuming the same capture within grace', () => {
    const hook = begin()
    advance(180_000)
    act(() => hook.result.current.ping({ fraction: 0.2, segmentStart: 0.2 }))
    advance(60_000)
    act(() => hook.result.current.flush())
    hook.unmount()
    expect(queueReadingRecord).toHaveBeenLastCalledWith('u1', expect.objectContaining({
      startedAt: 1785000000000, durationSeconds: 180,
    }))
  })
  it('ignores jumps when collecting coverage', () => {
    const hook = begin()
    advance(30_000)
    act(() => hook.result.current.ping({ fraction: 0.12, segmentStart: 0.1 }))
    act(() => hook.result.current.ping({ fraction: 0.8, segmentStart: 0.8 }))
    advance(30_000)
    act(() => hook.result.current.flush())
    hook.unmount()
    expect(queueReadingRecord).toHaveBeenLastCalledWith('u1', expect.objectContaining({ coverage: [[0.1, 0.12]] }))
  })
  it('retains sub-minute captures as suspended drafts instead of uploading them', () => {
    const hook = begin()
    advance(59_999)
    hook.unmount()
    expect(queueReadingRecord).not.toHaveBeenCalled()
  })
  it('ignores a stale denial after a newer activity claim succeeds', async () => {
    let denyOld!: (granted: boolean) => void
    vi.mocked(claimReadingTimer).mockImplementationOnce(() => new Promise((resolve) => { denyOld = resolve }))
    const hook = begin()
    advance(1000)
    act(() => hook.result.current.ping({ fraction: 0.11, segmentStart: 0.1 }))
    await act(async () => { denyOld(false); await Promise.resolve() })
    advance(60_000)
    act(() => hook.result.current.flush())
    hook.unmount()
    expect(queueReadingRecord).toHaveBeenCalledTimes(1)
    expect(queueReadingRecord).toHaveBeenCalledWith('u1', expect.objectContaining({ durationSeconds: 61 }))
  })

  it('checkpoints running activity for reload recovery', () => {
    const hook = begin()
    advance(60_000)
    const draft = JSON.parse(localStorage.getItem('bd-reading-auto:u1:device-test')!)
    expect(draft['book-1'].pendingRecord).toMatchObject({ bookId: 'book-1', durationSeconds: 60, requestId: expect.any(String) })
    hook.unmount()
  })
  it('reuses the same record across reader unmount and re-entry without counting time away', () => {
    const first = begin()
    advance(40_000)
    first.unmount()
    const original = JSON.parse(localStorage.getItem('bd-reading-auto:u1:device-test')!)['book-1'].pendingRecord
    expect(original.durationSeconds).toBe(40)
    advance(30_000)
    const second = begin()
    advance(20_000)
    act(() => second.result.current.flush())
    expect(queueReadingRecord).toHaveBeenCalledWith('u1', expect.objectContaining({
      requestId: original.requestId, durationSeconds: 60,
      fragments: [{ startedAt: 1785000000000, endedAt: 1785000040000 }, { startedAt: 1785000070000, endedAt: 1785000090000 }],
    }))
    second.unmount()
  })

  it('pauses immediately on backgrounding and preserves the capture until activity returns', () => {
    const hook = begin()
    advance(40_000)
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    advance(30_000)
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    advance(10_000)
    act(() => hook.result.current.ping({ fraction: 0.2, segmentStart: 0.2 }))
    advance(20_000)
    act(() => hook.result.current.flush())
    expect(queueReadingRecord).toHaveBeenCalledWith('u1', expect.objectContaining({ durationSeconds: 60 }))
    hook.unmount()
  })

  it('starts a new capture after grace expires instead of reviving a short draft', () => {
    const first = begin()
    advance(40_000)
    first.unmount()
    advance(301_000)
    const second = begin()
    advance(20_000)
    act(() => second.result.current.flush())
    expect(queueReadingRecord).not.toHaveBeenCalled()
    const draft = JSON.parse(localStorage.getItem('bd-reading-auto:u1:device-test')!)['book-1'].pendingRecord
    expect(draft.durationSeconds).toBe(20)
    second.unmount()
  })

  it('preserves another book pending capture when switching books', () => {
    const first = begin()
    advance(40_000)
    first.unmount()
    const second = renderHook(() => useReadingTimer('book-2'))
    act(() => second.result.current.ping({ fraction: 0.2, segmentStart: 0.2 }))
    advance(30_000)
    second.unmount()
    const third = begin()
    advance(20_000)
    act(() => third.result.current.flush())
    expect(queueReadingRecord).toHaveBeenCalledWith('u1', expect.objectContaining({ bookId: 'book-1', durationSeconds: 60 }))
    expect(JSON.parse(localStorage.getItem('bd-reading-auto:u1:device-test')!)['book-2'].pendingRecord.durationSeconds).toBe(30)
    third.unmount()
  })

})
