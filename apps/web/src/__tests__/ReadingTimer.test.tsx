import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useReadingTimer } from '../features/reader/hooks/useReadingTimer'

const mutate = vi.fn()

vi.mock('@/api/hooks/reading-records', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/hooks/reading-records')>()
  return { ...original, useAddReadingTime: () => ({ mutate }) }
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

let visibilityState: 'visible' | 'hidden' = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  visibilityState = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilityState })
})

afterEach(() => {
  vi.useRealTimers()
})

function hide() {
  visibilityState = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
}

function show() {
  visibilityState = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useReadingTimer', () => {
  it('reports elapsed time on unmount when above the fragment threshold', () => {
    const { unmount } = renderHook(() => useReadingTimer('b1'), { wrapper })
    vi.advanceTimersByTime(6_000)
    unmount()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toMatchObject({ bookId: 'b1', durationSeconds: 6 })
    expect(mutate.mock.calls[0][0].startedAt).toEqual(expect.any(Number))
  })

  it('drops fragments shorter than 5 seconds', () => {
    const { unmount } = renderHook(() => useReadingTimer('b1'), { wrapper })
    vi.advanceTimersByTime(4_000)
    unmount()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('settles on a long background stint and does not count it', () => {
    const { unmount } = renderHook(() => useReadingTimer('b1'), { wrapper })
    vi.advanceTimersByTime(6_000)
    hide()
    vi.advanceTimersByTime(60_000)
    show()
    // 6s before the stint is settled on resume; the 60s stint does not count
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toMatchObject({ durationSeconds: 6 })
    vi.advanceTimersByTime(4_000)
    unmount()
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('counts brief interruptions as reading', () => {
    const { unmount } = renderHook(() => useReadingTimer('b1'), { wrapper })
    vi.advanceTimersByTime(3_000)
    hide()
    vi.advanceTimersByTime(3_000)
    show()
    vi.advanceTimersByTime(3_000)
    unmount()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toMatchObject({ durationSeconds: 9 })
  })

  it('does nothing without a bookId', () => {
    const { unmount } = renderHook(() => useReadingTimer(undefined), { wrapper })
    vi.advanceTimersByTime(10_000)
    unmount()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('flush reports the pending segment immediately and the timer keeps running', () => {
    const { result, unmount } = renderHook(() => useReadingTimer('b1'), { wrapper })
    vi.advanceTimersByTime(6_000)
    act(() => result.current.flush())
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toMatchObject({ bookId: 'b1', durationSeconds: 6 })
    vi.advanceTimersByTime(6_000)
    unmount()
    expect(mutate).toHaveBeenCalledTimes(2)
    expect(mutate.mock.calls[1][0]).toMatchObject({ bookId: 'b1', durationSeconds: 6 })
  })

  it('flush is a no-op without a bookId', () => {
    const { result, unmount } = renderHook(() => useReadingTimer(undefined), { wrapper })
    act(() => result.current.flush())
    expect(mutate).not.toHaveBeenCalled()
    unmount()
  })
})
