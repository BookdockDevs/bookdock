import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mutate = vi.fn()

vi.mock('@/api/hooks/reading-records', () => ({
  READING_RECORDS_KEY: ['reading-records'],
  localDateString: (d: Date) => d.toISOString().slice(0, 10),
  useAddReadingTime: () => ({ mutate }),
}))

import { useReadingTimer } from '../features/reader/hooks/useReadingTimer'

const IDLE_PLUS = 120_001

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

function renderTimer(bookId: string | undefined = 'book-1') {
  return renderHook(() => useReadingTimer(bookId), { wrapper })
}

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-05T12:00:00'))
  mutate.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useReadingTimer idle handling', () => {
  it('reports the active stretch when flush is called', () => {
    const { result } = renderTimer()
    advance(10_000)
    act(() => result.current.flush())
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toMatchObject({ bookId: 'book-1', durationSeconds: 10 })
  })

  it('idle timeout settles once and pauses (no further accumulation)', () => {
    const { result } = renderTimer()
    advance(IDLE_PLUS)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0].durationSeconds).toBe(120)
    // paused: more wall time without activity adds nothing
    advance(60_000)
    act(() => result.current.flush())
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('ping after an idle pause resumes a fresh session', () => {
    const { result } = renderTimer()
    advance(IDLE_PLUS)
    expect(mutate).toHaveBeenCalledTimes(1)
    advance(5_000)
    act(() => result.current.ping())
    advance(30_000)
    act(() => result.current.flush())
    expect(mutate).toHaveBeenCalledTimes(2)
    expect(mutate.mock.calls[1][0].durationSeconds).toBe(30)
  })

  it('ping refreshes the idle timer while active', () => {
    const { result } = renderTimer()
    advance(119_000)
    act(() => result.current.ping())
    advance(119_000)
    expect(mutate).not.toHaveBeenCalled()
    advance(2_000)
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('fragments shorter than 5s are dropped', () => {
    const { result } = renderTimer()
    advance(3_000)
    act(() => result.current.flush())
    expect(mutate).not.toHaveBeenCalled()
  })
})
