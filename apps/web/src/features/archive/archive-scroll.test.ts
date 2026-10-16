import { beforeEach, describe, expect, it } from 'vitest'

import {
  archiveScrollKey,
  restoreScrollWithRetry,
  saveArchiveScrollRecord,
  takeArchiveScrollRecord,
} from '@/features/archive/archive-scroll'
import type { ArchiveSearch } from '@/routes/archive'

function searchWith(overrides: Partial<ArchiveSearch> = {}): ArchiveSearch {
  return { ...overrides }
}

describe('archiveScrollKey', () => {
  it('is stable for the same view and distinct across views', () => {
    expect(archiveScrollKey(searchWith({ bookId: 'a' }))).toBe(archiveScrollKey(searchWith({ bookId: 'a' })))
    expect(archiveScrollKey(searchWith({ bookId: 'a' }))).not.toBe(archiveScrollKey(searchWith({ bookId: 'b' })))
    expect(archiveScrollKey(searchWith())).not.toBe(archiveScrollKey(searchWith({ q: 'x' })))
  })
})

describe('save/takeArchiveScrollRecord', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('round-trips positions for the matching key and consumes them once', () => {
    saveArchiveScrollRecord('k1', { left: 120, main: 340, win: 0 })
    expect(takeArchiveScrollRecord('k1')).toEqual({ left: 120, main: 340, win: 0 })
    expect(takeArchiveScrollRecord('k1')).toBeNull()
  })

  it('ignores other keys without consuming the record', () => {
    saveArchiveScrollRecord('k1', { left: 10, main: 20, win: 30 })
    expect(takeArchiveScrollRecord('k2')).toBeNull()
    expect(takeArchiveScrollRecord('k1')).toEqual({ left: 10, main: 20, win: 30 })
  })

  it('rejects corrupt payloads', () => {
    sessionStorage.setItem('bd-archive-scroll', 'not-json')
    expect(takeArchiveScrollRecord('k1')).toBeNull()
    sessionStorage.setItem('bd-archive-scroll', JSON.stringify({ key: 'k1', positions: { left: 1 } }))
    expect(takeArchiveScrollRecord('k1')).toBeNull()
  })
})

/** Scripted scrollable: apply clamps to the current max like a loading page. */
function scripted(maxHeights: number[]) {
  const el = { top: 0, max: 0, height: 0 }
  let step = 0
  return {
    el,
    read: () => el.top,
    apply: (top: number) => {
      el.top = Math.min(top, el.max)
    },
    height: () => el.height,
    grow: () => {
      el.max = maxHeights[step] ?? el.max
      el.height = el.max + 500
      step += 1
    },
  }
}

function manualScheduler() {
  const queue: Array<() => void> = []
  return {
    schedule: (callback: () => void) => {
      queue.push(callback)
    },
    pending: () => queue.length,
    flush: (count = 1) => {
      for (let i = 0; i < count; i += 1) queue.shift()?.()
    },
  }
}

describe('restoreScrollWithRetry', () => {
  it('applies once when the destination is already tall enough', () => {
    const view = scripted([1000])
    view.grow()
    const scheduler = manualScheduler()
    restoreScrollWithRetry({ ...view, target: 321 }, scheduler.schedule)
    expect(view.el.top).toBe(321)
    expect(scheduler.pending()).toBe(0)
  })

  it('keeps re-applying while a static skeleton waits, then lands when data arrives', () => {
    // The reviewer repro: target 900, clamped to a 100-high skeleton whose
    // height never changes for longer than the old 8-frame settle window,
    // then content jumps to 2000. Static height must not end the retry.
    const view = scripted([100, 900])
    view.grow() // skeleton height
    const scheduler = manualScheduler()
    restoreScrollWithRetry({ ...view, target: 321 }, scheduler.schedule, 10)
    expect(view.el.top).toBe(100)
    // Skeleton sits unchanged far past the old settle window.
    for (let i = 0; i < 8; i += 1) scheduler.flush()
    expect(view.el.top).toBe(100)
    expect(scheduler.pending()).toBe(1)
    // Data arrives late: the next retry lands the saved position.
    view.grow()
    scheduler.flush()
    expect(view.el.top).toBe(321)
    expect(scheduler.pending()).toBe(0)
  })

  it('stops at the frame budget when the target stays unreachable', () => {
    const view = scripted([100])
    view.grow()
    const scheduler = manualScheduler()
    restoreScrollWithRetry({ ...view, target: 900 }, scheduler.schedule, 3)
    for (let i = 0; i < 10; i += 1) scheduler.flush()
    expect(view.el.top).toBe(100)
    expect(scheduler.pending()).toBe(0)
  })

  it('never schedules when there is nothing to restore', () => {
    const view = scripted([1000])
    view.grow()
    const scheduler = manualScheduler()
    const cancel = restoreScrollWithRetry({ ...view, target: 0 }, scheduler.schedule)
    expect(view.el.top).toBe(0)
    expect(scheduler.pending()).toBe(0)
    cancel()
  })

  it('stops retrying once cancelled, e.g. on unmount', () => {
    const view = scripted([100])
    view.grow()
    const scheduler = manualScheduler()
    const applied: number[] = []
    const cancel = restoreScrollWithRetry(
      { read: () => view.el.top, apply: (top: number) => { applied.push(top); view.el.top = Math.min(top, view.el.max) }, target: 900 },
      scheduler.schedule,
      10,
    )
    expect(applied).toEqual([900])
    cancel()
    scheduler.flush(5)
    expect(applied).toEqual([900])
    expect(scheduler.pending()).toBe(0)
  })
})
