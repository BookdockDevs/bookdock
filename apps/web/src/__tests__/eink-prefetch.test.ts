import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNextSectionPrefetch } from '../eink/next-section-prefetch'

afterEach(() => vi.useRealTimers())

describe('Kindle next chapter prefetch', () => {
  it('waits for navigation to settle and fetches only the next linear section', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue('text')
    const prefetch = createNextSectionPrefetch([
      { id: 'first' }, { id: 'footnote', linear: 'no' }, { id: 'second' }, { id: 'third' },
    ], load)
    prefetch.schedule(0)
    await vi.advanceTimersByTimeAsync(799)
    expect(load).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('second', expect.any(AbortSignal))
    prefetch.dispose()
  })

  it('cancels stale timers and aborts an in-flight request on navigation or disposal', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const load = vi.fn((_path: string, signal: AbortSignal) => { signals.push(signal); return new Promise(() => {}) })
    const prefetch = createNextSectionPrefetch([{ id: 'first' }, { id: 'second' }, { id: 'third' }], load)
    prefetch.schedule(0)
    prefetch.schedule(1)
    await vi.advanceTimersByTimeAsync(800)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0]![0]).toBe('third')
    prefetch.schedule(0)
    expect(signals[0]!.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(800)
    prefetch.dispose()
    expect(signals[1]!.aborted).toBe(true)
    prefetch.schedule(0)
    await vi.advanceTimersByTimeAsync(800)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('ignores invalid and final section indices', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue(null)
    const prefetch = createNextSectionPrefetch([{ id: 'first' }, { id: 'last' }], load)
    for (const index of [undefined, -1, 0.5, 1, 5]) prefetch.schedule(index)
    await vi.advanceTimersByTimeAsync(800)
    expect(load).not.toHaveBeenCalled()
    prefetch.dispose()
  })
})
