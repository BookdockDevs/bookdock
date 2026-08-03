import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createHistoryAutoHide,
  HISTORY_HIDE_AFTER_MS,
  HISTORY_HIDE_AFTER_SCREENS,
  HISTORY_LANDING_GRACE_MS,
} from '../features/reader/history-auto-hide'

describe('createHistoryAutoHide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires after the time window once armed by a jump', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    vi.advanceTimersByTime(HISTORY_HIDE_AFTER_MS - 1)
    expect(onHide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('stays quiet before any jump, however much time or screens pass', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.trackRelocate(0.1)
    for (let i = 0; i < HISTORY_HIDE_AFTER_SCREENS + 2; i++) {
      h.trackRelocate(1)
    }
    vi.advanceTimersByTime(HISTORY_HIDE_AFTER_MS * 2)
    expect(onHide).not.toHaveBeenCalled()
  })

  it('restarts the timer on each reset (jump, back, forward)', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    vi.advanceTimersByTime(HISTORY_HIDE_AFTER_MS - 1000)
    h.reset()
    vi.advanceTimersByTime(HISTORY_HIDE_AFTER_MS - 1)
    expect(onHide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('hides after enough screens turned AND a chapter change', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    h.trackRelocate(0, 3) // jump landing in chapter 3 — baseline only
    vi.advanceTimersByTime(HISTORY_LANDING_GRACE_MS)
    for (let i = 0; i < HISTORY_HIDE_AFTER_SCREENS - 1; i++) {
      h.trackRelocate(1, 3)
    }
    expect(onHide).not.toHaveBeenCalled()
    h.trackRelocate(1, 4)
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('hides in scroll mode: small scroll moves accumulate across a chapter change', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    h.trackRelocate(0, 3) // landing
    vi.advanceTimersByTime(HISTORY_LANDING_GRACE_MS)
    // continuous scroll emits many sub-screen relocates
    for (let i = 0; i < 6; i++) {
      h.trackRelocate(0.8, 3)
    }
    expect(onHide).not.toHaveBeenCalled()
    h.trackRelocate(0.8, 4) // 7 × 0.8 = 5.6 screens, now past the chapter boundary
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('stays visible after enough screens while still in the landing chapter', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    h.trackRelocate(0, 3)
    vi.advanceTimersByTime(HISTORY_LANDING_GRACE_MS)
    for (let i = 0; i < 8; i++) {
      h.trackRelocate(1, 3)
    }
    expect(onHide).not.toHaveBeenCalled()
  })

  it('stays visible after a chapter change without enough screens turned', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    h.trackRelocate(0, 3)
    vi.advanceTimersByTime(HISTORY_LANDING_GRACE_MS)
    h.trackRelocate(1, 4)
    expect(onHide).not.toHaveBeenCalled()
  })

  it('does not count jump-settle relocates that arrive right after the landing', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    h.trackRelocate(0, 3) // landing in chapter 3
    // The view keeps settling: the anchor scroll then reports the jump's own
    // multi-screen displacement. It must not count as reading.
    h.trackRelocate(12, 3)
    vi.advanceTimersByTime(HISTORY_LANDING_GRACE_MS)
    // One genuine screen into the next chapter is far below the limit
    h.trackRelocate(1, 4)
    expect(onHide).not.toHaveBeenCalled()
  })

  it('never fires on screens alone when the chapter is unknown', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    h.trackRelocate(0, 3)
    vi.advanceTimersByTime(HISTORY_LANDING_GRACE_MS)
    for (let i = 0; i < HISTORY_HIDE_AFTER_SCREENS + 2; i++) {
      h.trackRelocate(1, undefined)
    }
    expect(onHide).not.toHaveBeenCalled()
  })

  it('ignores jitter below the screen threshold', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    h.trackRelocate(0, 3)
    vi.advanceTimersByTime(HISTORY_LANDING_GRACE_MS)
    for (let i = 0; i < HISTORY_HIDE_AFTER_SCREENS + 2; i++) {
      h.trackRelocate(0.04, 4)
    }
    expect(onHide).not.toHaveBeenCalled()
  })

  it('disarms after firing until the next jump', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    vi.advanceTimersByTime(HISTORY_HIDE_AFTER_MS)
    expect(onHide).toHaveBeenCalledTimes(1)
    // further screen turns and time must not re-fire on an already-hidden stack
    for (let i = 0; i < HISTORY_HIDE_AFTER_SCREENS + 2; i++) {
      h.trackRelocate(1)
    }
    vi.advanceTimersByTime(HISTORY_HIDE_AFTER_MS * 2)
    expect(onHide).toHaveBeenCalledTimes(1)
    // a new jump re-arms both triggers
    h.reset()
    vi.advanceTimersByTime(HISTORY_HIDE_AFTER_MS)
    expect(onHide).toHaveBeenCalledTimes(2)
  })

  it('resets the screen count on a new jump', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    h.trackRelocate(0, 3)
    vi.advanceTimersByTime(HISTORY_LANDING_GRACE_MS)
    for (let i = 0; i < HISTORY_HIDE_AFTER_SCREENS - 1; i++) {
      h.trackRelocate(1, 3)
    }
    h.reset()
    h.trackRelocate(0, 5)
    vi.advanceTimersByTime(HISTORY_LANDING_GRACE_MS)
    for (let i = 0; i < HISTORY_HIDE_AFTER_SCREENS - 1; i++) {
      h.trackRelocate(1, 5)
    }
    expect(onHide).not.toHaveBeenCalled()
  })

  it('dispose cancels a pending timer', () => {
    const onHide = vi.fn()
    const h = createHistoryAutoHide(onHide)
    h.reset()
    h.dispose()
    vi.advanceTimersByTime(HISTORY_HIDE_AFTER_MS * 2)
    expect(onHide).not.toHaveBeenCalled()
  })
})
