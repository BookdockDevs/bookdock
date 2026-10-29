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
    await vi.advanceTimersByTimeAsync(199)
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
    await vi.advanceTimersByTimeAsync(200)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0]![0]).toBe('third')
    prefetch.schedule(0)
    expect(signals[0]!.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(200)
    prefetch.dispose()
    expect(signals[1]!.aborted).toBe(true)
    prefetch.schedule(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('ignores invalid and final section indices', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue(null)
    const prefetch = createNextSectionPrefetch([{ id: 'first' }, { id: 'last' }], load)
    for (const index of [undefined, -1, 0.5, 1, 5]) prefetch.schedule(index)
    await vi.advanceTimersByTimeAsync(200)
    expect(load).not.toHaveBeenCalled()
    prefetch.dispose()
  })

  it('keeps the same target across page turns and exposes its in-flight result', async () => {
    vi.useFakeTimers()
    let resolve!: (text: string) => void
    const load = vi.fn((_path: string, _signal: AbortSignal) => new Promise<string>(done => { resolve = done }))
    const prefetch = createNextSectionPrefetch([{ id: 'first' }, { id: 'second' }], load)
    prefetch.schedule(0)
    await vi.advanceTimersByTimeAsync(150)
    prefetch.schedule(0)
    await vi.advanceTimersByTimeAsync(50)
    expect(load).toHaveBeenCalledTimes(1)
    const pending = prefetch.waitFor('second')
    expect(pending).not.toBeNull()
    const navigation = new AbortController()
    const cancelled = prefetch.waitFor('second', navigation.signal)
    navigation.abort()
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    prefetch.schedule(0)
    expect(load.mock.calls[0]![1].aborted).toBe(false)
    resolve('chapter')
    await expect(pending).resolves.toBe('chapter')
    prefetch.dispose()
  })

  it('starts a scheduled target immediately when navigation needs it', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValue('chapter')
    const prefetch = createNextSectionPrefetch([{ id: 'first' }, { id: 'second' }], load)
    prefetch.schedule(0)
    await expect(prefetch.waitFor('second')).resolves.toBe('chapter')
    await vi.advanceTimersByTimeAsync(200)
    expect(load).toHaveBeenCalledTimes(1)
    prefetch.dispose()
  })
})
