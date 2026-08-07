import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiPost, apiPut } from '@/api/client'
import { queryClient } from '@/lib/query-client'
import { useUiStore } from '@/stores/ui.store'

import { useManualTimerStore, resetManualTimerTicker, sessionDurationMs, type ManualSession } from '../manual-timer-store'

vi.mock('@/api/client', () => ({
  apiPost: vi.fn().mockResolvedValue(undefined),
  apiPut: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/query-client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}))

const mockPost = vi.mocked(apiPost)
const mockPut = vi.mocked(apiPut)
const mockInvalidate = vi.mocked(queryClient.invalidateQueries)

function session(): ManualSession {
  return useManualTimerStore.getState().sessions['book-a']
}

const POS = { cfi: 'epubcfi(/6/4!/4/2)', fraction: 0.25 }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1785000000000)
  resetManualTimerTicker()
  useUiStore.setState({ manualTimerGraceMinutes: 5 })
  useManualTimerStore.setState({ sessions: {}, now: Date.now(), lastSummary: null })
  mockPost.mockClear()
  mockPut.mockClear()
  mockInvalidate.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('manual timer state machine', () => {
  it('start creates a running session with the given start position', () => {
    useManualTimerStore.getState().start('book-a', POS)
    expect(session()).toMatchObject({ phase: 'running', startCfi: POS.cfi, startFraction: 0.25, lastCfi: POS.cfi })
    expect(session().startedAt).toBe(1785000000000)
  })

  it('start is a no-op while a session exists', () => {
    useManualTimerStore.getState().start('book-a', POS)
    useManualTimerStore.getState().start('book-a', { cfi: null, fraction: null })
    expect(session().startCfi).toBe(POS.cfi)
  })

  it('elapsed accumulates while running and freezes when paused', () => {
    useManualTimerStore.getState().start('book-a', POS)
    vi.setSystemTime(1785000030000) // +30s
    expect(sessionDurationMs(session(), 1785000030000)).toBe(30_000)
    useManualTimerStore.getState().pause('book-a')
    expect(session().phase).toBe('paused')
    expect(session().elapsedMs).toBe(30_000)
    vi.setSystemTime(1785000060000) // +30s paused
    expect(sessionDurationMs(session(), 1785000060000)).toBe(30_000)
  })

  it('resume continues counting from the frozen elapsed', () => {
    useManualTimerStore.getState().start('book-a', POS)
    vi.setSystemTime(1785000030000)
    useManualTimerStore.getState().pause('book-a')
    useManualTimerStore.getState().resume('book-a')
    vi.setSystemTime(1785000050000) // +20s after resume
    expect(sessionDurationMs(session(), 1785000050000)).toBe(50_000)
  })

  it('suspend freezes the elapsed and starts the grace countdown', () => {
    useManualTimerStore.getState().start('book-a', POS)
    vi.setSystemTime(1785000030000)
    useManualTimerStore.getState().suspend('book-a')
    expect(session()).toMatchObject({ phase: 'suspended', elapsedMs: 30_000, suspendedAt: 1785000030000 })
    vi.setSystemTime(1785000050000) // +20s suspended
    expect(sessionDurationMs(session(), 1785000050000)).toBe(30_000)
  })

  it('grace expiry terminates the session automatically', async () => {
    useManualTimerStore.getState().start('book-a', POS)
    vi.setSystemTime(1785000030000)
    useManualTimerStore.getState().suspend('book-a')
    useManualTimerStore.getState().updatePosition('book-a', { cfi: 'epubcfi(/6/4!/4/8)', fraction: 0.5 })
    // 5-minute grace elapses
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(useManualTimerStore.getState().sessions['book-a']).toBeUndefined()
    expect(useManualTimerStore.getState().lastSummary).toEqual({ bookId: 'book-a', durationSeconds: 30 })
  })

  it('resume from suspended before expiry keeps the elapsed', () => {
    useManualTimerStore.getState().start('book-a', POS)
    vi.setSystemTime(1785000030000)
    useManualTimerStore.getState().suspend('book-a')
    useManualTimerStore.getState().resume('book-a')
    expect(session().phase).toBe('running')
    expect(session().elapsedMs).toBe(30_000)
    vi.setSystemTime(1785000040000)
    expect(sessionDurationMs(session(), 1785000040000)).toBe(40_000)
  })

  it('terminate clears the session and reports the interval + exact bounds', async () => {
    useManualTimerStore.getState().start('book-a', POS)
    vi.setSystemTime(1785000060000) // +60s
    useManualTimerStore.getState().updatePosition('book-a', { cfi: 'epubcfi(/6/4!/4/8)', fraction: 0.5, chapterIndex: 4 })
    useManualTimerStore.getState().terminate('book-a')
    expect(useManualTimerStore.getState().sessions['book-a']).toBeUndefined()

    await vi.waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/progress/book-a', {
        percent: 50,
        fraction: 0.5,
        segmentStartFraction: 0.25,
        cfi: 'epubcfi(/6/4!/4/8)',
      })
      expect(mockPost).toHaveBeenCalledWith('/reading-records', expect.objectContaining({
        bookId: 'book-a',
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        durationSeconds: 60,
        startedAt: 1785000000000,
        endedAt: 1785000060000,
        startCfi: 'epubcfi(/6/4!/4/2)',
        endCfi: 'epubcfi(/6/4!/4/8)',
        startFraction: 0.25,
        endFraction: 0.5,
        endChapterIndex: 4,
      }))
    })
    await vi.waitFor(() => {
      expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['reading-sessions'] })
      expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['reading-records'] })
    })
  })

  it('skips the progress PUT when no start fraction was captured', async () => {
    useManualTimerStore.getState().start('book-a', { cfi: null, fraction: null })
    useManualTimerStore.getState().terminate('book-a')
    expect(mockPut).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1)
    })
  })

  it('discard drops the session with no network writes, no summary and no invalidations', async () => {
    useManualTimerStore.getState().start('book-a', POS)
    vi.setSystemTime(1785000060000)
    useManualTimerStore.getState().discard('book-a')
    expect(useManualTimerStore.getState().sessions['book-a']).toBeUndefined()
    expect(useManualTimerStore.getState().lastSummary).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it('discard on a missing session is a no-op', () => {
    useManualTimerStore.getState().discard('book-a')
    expect(useManualTimerStore.getState().sessions).toEqual({})
  })
})
