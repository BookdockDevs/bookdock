import { afterEach, describe, expect, it, vi } from 'vitest'

import { findMatchesSafely } from '../features/reader/lib/book-search'
import type { SearchMatch } from '../features/reader/lib/book-search'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: { matches: SearchMatch[] } }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()

  constructor() { FakeWorker.instances.push(this) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  FakeWorker.instances = []
})

describe('safe search matching', () => {
  it('uses bounded plain matching without a worker', async () => {
    vi.stubGlobal('Worker', undefined)
    expect(await findMatchesSafely('aaaa', 'aa', { limit: 2 }, new AbortController().signal)).toEqual({
      matches: [{ start: 0, end: 2 }, { start: 1, end: 3 }],
    })
  })

  it('refuses main-thread regex fallback when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    expect(await findMatchesSafely('aaaa', '(a+)+$', { mode: 'regex' }, new AbortController().signal)).toEqual({
      matches: [], error: 'regex-unavailable',
    })
  })

  it('returns worker offsets and disposes the worker', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const pending = findMatchesSafely('abc', 'b', { mode: 'regex', limit: 1 }, new AbortController().signal)
    const worker = FakeWorker.instances[0]!
    expect(worker.postMessage).toHaveBeenCalledWith({ text: 'abc', query: 'b', options: { mode: 'regex', limit: 1 } })
    worker.onmessage?.({ data: { matches: [{ start: 1, end: 2 }] } })
    expect(await pending).toEqual({ matches: [{ start: 1, end: 2 }], error: undefined })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('terminates a hung regex after three seconds and ignores late messages', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    const pending = findMatchesSafely('aaaa!', '(a+)+$', { mode: 'regex' }, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(3000)
    const worker = FakeWorker.instances[0]!
    expect(await pending).toEqual({ matches: [], error: 'regex-timeout' })
    worker.onmessage?.({ data: { matches: [{ start: 0, end: 4 }] } })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('cancels immediately and leaves a newer worker running', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = new AbortController()
    const old = findMatchesSafely('old', '.', { mode: 'regex' }, controller.signal)
    const next = findMatchesSafely('new', '.', { mode: 'regex' }, new AbortController().signal)
    controller.abort()
    expect(await old).toEqual({ matches: [], error: undefined })
    expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce()
    expect(FakeWorker.instances[1]!.terminate).not.toHaveBeenCalled()
    FakeWorker.instances[1]!.onmessage?.({ data: { matches: [{ start: 0, end: 1 }] } })
    expect((await next).matches).toHaveLength(1)
  })

  it('reports worker errors without retrying regexes on the main thread', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const pending = findMatchesSafely('abc', '.', { mode: 'regex' }, new AbortController().signal)
    FakeWorker.instances[0]!.onerror?.()
    expect(await pending).toEqual({ matches: [], error: 'regex-failed' })
  })
})
