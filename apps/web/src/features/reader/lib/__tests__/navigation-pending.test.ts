import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import { NavigationPending } from '../navigation-pending'

describe('NavigationPending', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the indicator only after the anti-flicker window', () => {
    const changes: boolean[] = []
    const n = new NavigationPending((pending) => changes.push(pending))
    const gen = n.begin()
    vi.advanceTimersByTime(199)
    expect(changes).toEqual([])
    vi.advanceTimersByTime(1)
    expect(changes).toEqual([true])
    n.end(gen)
    expect(changes).toEqual([true, false])
  })

  it('fast navigations never show the indicator', () => {
    const changes: boolean[] = []
    const n = new NavigationPending((pending) => changes.push(pending))
    const gen = n.begin()
    vi.advanceTimersByTime(100)
    n.end(gen)
    vi.advanceTimersByTime(200)
    expect(changes).toEqual([])
  })

  it('a newer navigation supersedes an older one', () => {
    const changes: boolean[] = []
    const n = new NavigationPending((pending) => changes.push(pending))
    const genA = n.begin()
    vi.advanceTimersByTime(50)
    const genB = n.begin()
    vi.advanceTimersByTime(250)
    expect(changes).toEqual([true])
    n.end(genA)
    expect(changes).toEqual([true])
    n.end(genB)
    expect(changes).toEqual([true, false])
  })

  it('settling the shown navigation hides the indicator once', () => {
    const changes: boolean[] = []
    const n = new NavigationPending((pending) => changes.push(pending))
    const gen = n.begin()
    vi.advanceTimersByTime(200)
    n.end(gen)
    n.end(gen)
    expect(changes).toEqual([true, false])
  })

  it('dispose cancels the pending timer and invalidates in-flight navigations', () => {
    const changes: boolean[] = []
    const n = new NavigationPending((pending) => changes.push(pending))
    const gen = n.begin()
    n.dispose()
    vi.advanceTimersByTime(500)
    expect(changes).toEqual([])
    n.end(gen)
    expect(changes).toEqual([])
  })
})
