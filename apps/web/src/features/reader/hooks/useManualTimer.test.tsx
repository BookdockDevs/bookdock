import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth.store'
import { useManualTimerStore, resetManualTimerTicker } from '../lib/manual-timer-store'
import { claimReadingTimer } from '../lib/reading-timer-lease'
import { useManualTimer } from './useManualTimer'

vi.mock('./useReaderApi', () => ({ useReaderApi: () => ({ renderer: null }) }))
vi.mock('../lib/reading-record-queue', () => ({
  queueReadingRecord: vi.fn(), retryReadingRecords: vi.fn(),
  newReadingRequestId: () => crypto.randomUUID(), readingTimezone: () => 'Asia/Shanghai',
  useReadingSaveState: { setState: vi.fn() },
}))
vi.mock('../lib/reading-timer-lease', () => ({
  claimReadingTimer: vi.fn().mockResolvedValue(true), releaseReadingTimer: vi.fn(), readingDeviceId: () => 'device-test',
}))

let hidden = false
const user = { id: 'manual-reader', username: 'reader', role: 'user' }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1785000000000)
  resetManualTimerTicker()
  useAuthStore.setState({ user: null })
  localStorage.clear()
  useAuthStore.setState({ user })
  useManualTimerStore.getState().updatePosition('b1', { cfi: 'txt:100', fraction: 0.1 })
  hidden = false
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' })
})
afterEach(() => { resetManualTimerTicker(); vi.useRealTimers() })

function visibility(value: boolean) {
  act(() => { hidden = value; document.dispatchEvent(new Event('visibilitychange')) })
}

describe('manual timer visibility and restoration', () => {
  it('never resumes an explicitly paused timer on foreground return', () => {
    const hook = renderHook(() => useManualTimer('b1'))
    act(() => hook.result.current.start())
    act(() => vi.advanceTimersByTime(10_000))
    act(() => hook.result.current.pause())
    visibility(true)
    act(() => vi.advanceTimersByTime(30_000))
    visibility(false)
    expect(hook.result.current.phase).toBe('paused')
    expect(hook.result.current.elapsedMs).toBe(10_000)
    hook.unmount()
  })

  it('resumes suspended running sessions without counting the background interval', () => {
    const hook = renderHook(() => useManualTimer('b1'))
    act(() => hook.result.current.start())
    act(() => vi.advanceTimersByTime(10_000))
    visibility(true)
    act(() => vi.advanceTimersByTime(30_000))
    visibility(false)
    act(() => vi.advanceTimersByTime(10_000))
    expect(hook.result.current.phase).toBe('running')
    expect(hook.result.current.elapsedMs).toBe(20_000)
    expect(claimReadingTimer).toHaveBeenLastCalledWith('manual', false)
    hook.unmount()
  })

  it('restores an explicit pause across account-session reload', () => {
    useManualTimerStore.getState().start('b1', { cfi: null, fraction: 0.1 })
    vi.advanceTimersByTime(10_000)
    useManualTimerStore.getState().pause('b1')
    useAuthStore.setState({ user: null })
    vi.advanceTimersByTime(600_000)
    useAuthStore.setState({ user })
    const hook = renderHook(() => useManualTimer('b1'))
    expect(hook.result.current.phase).toBe('paused')
    expect(hook.result.current.elapsedMs).toBe(10_000)
    hook.unmount()
  })
})
