import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useAuthStore } from '@/stores/auth.store'
import { useReadingTimer } from '../features/reader/hooks/useReadingTimer'
import { queueReadingRecord } from '../features/reader/lib/reading-record-queue'
import { useManualTimerStore } from '../features/reader/lib/manual-timer-store'

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
  vi.clearAllMocks()
  localStorage.clear()
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  useAuthStore.setState({ user: { id: 'u1', username: 'reader', role: 'user' } })
  useManualTimerStore.setState({ sessions: {} })
})
afterEach(() => vi.useRealTimers())

function visibility(value: boolean) {
  act(() => { hidden = value; document.dispatchEvent(new Event('visibilitychange')) })
}

describe('reading timer lifecycle', () => {
  it('pauses immediately in the background, including short interruptions', () => {
    const hook = renderHook(() => useReadingTimer('b1'))
    act(() => hook.result.current.ping({ fraction: 0.1 }))
    act(() => vi.advanceTimersByTime(60_000))
    visibility(true)
    act(() => vi.advanceTimersByTime(30_000))
    visibility(false)
    act(() => hook.result.current.ping({ fraction: 0.1 }))
    act(() => vi.advanceTimersByTime(60_000))
    act(() => hook.result.current.flush())
    hook.unmount()
    expect(queueReadingRecord).toHaveBeenCalledTimes(1)
    expect(queueReadingRecord).toHaveBeenCalledWith('u1', expect.objectContaining({ durationSeconds: 120 }))
  })
  it('manual takeover saves automatic time and blocks automatic backfill', () => {
    const hook = renderHook(() => useReadingTimer('b1'))
    act(() => hook.result.current.ping({ fraction: 0.1 }))
    act(() => vi.advanceTimersByTime(60_000))
    act(() => useManualTimerStore.getState().start('b1', { cfi: null, fraction: 0.1 }))
    act(() => vi.advanceTimersByTime(20_000))
    act(() => useManualTimerStore.getState().discard('b1'))
    act(() => hook.result.current.ping({ fraction: 0.1 }))
    act(() => vi.advanceTimersByTime(60_000))
    act(() => hook.result.current.flush())
    hook.unmount()
    expect(vi.mocked(queueReadingRecord).mock.calls.map((call) => call[1].durationSeconds)).toEqual([60, 60])
  })
  it('does nothing without a book or authenticated account', () => {
    const hook = renderHook(() => useReadingTimer(undefined))
    act(() => hook.result.current.ping())
    act(() => vi.advanceTimersByTime(10_000))
    hook.unmount()
    expect(queueReadingRecord).not.toHaveBeenCalled()
  })
})
