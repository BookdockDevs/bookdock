import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ReadingLedgerSession } from '@bookdock/shared'

import ReadingSessionCard from './ReadingSessionCard'

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, values?: Record<string, number>) => `${key}:${JSON.stringify(values ?? {})}`,
}))

describe('reading session durations', () => {
  it.each([
    [1.909, 'stats.durationSeconds:{"s":1}'],
    [2.836, 'stats.durationSeconds:{"s":2}'],
    [59.9, 'stats.durationSeconds:{"s":59}'],
    [60, 'readingData.compactMinutes:{"n":1}'],
    [71.678, 'readingData.minuteSecond:{"m":1,"s":11}'],
  ])('shows %s seconds without rounding up to a minute', (durationSeconds, expected) => {
    const session: ReadingLedgerSession = {
      id: 'session', bookId: 'book', roundId: 'round', source: 'manual', date: '2026-10-20', durationSeconds,
      startedAt: null, endedAt: null, startFraction: null, endFraction: null, startCfi: null, endCfi: null,
      revisionId: null, wordCount: null, coverage: [], fragments: [], timezone: 'Asia/Shanghai',
    }
    render(<ReadingSessionCard session={session} />)
    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})
