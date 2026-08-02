import { describe, expect, it } from 'vitest'

import type { ReadingRecordDailyItem } from '@bookdock/shared'

import { MIN_BAR_WIDTH_PX, buildBookChartBars, summarizeBookRecords } from '../features/reader/stats/book-stats'

function day(date: string, durationSeconds: number): ReadingRecordDailyItem {
  return { date, durationSeconds }
}

describe('summarizeBookRecords', () => {
  it('handles an empty array without dividing by zero', () => {
    expect(summarizeBookRecords([], 0)).toEqual({
      totalSeconds: 0,
      days: 0,
      startDate: null,
      avgSecondsPerDay: 0,
    })
    expect(summarizeBookRecords([], 120).avgSecondsPerDay).toBe(0)
  })

  it('summarizes a single day', () => {
    const s = summarizeBookRecords([day('2026-07-20', 600)], 600)
    expect(s).toEqual({ totalSeconds: 600, days: 1, startDate: '2026-07-20', avgSecondsPerDay: 600 })
  })

  it('picks the earliest date as start and averages over recorded days', () => {
    const records = [day('2026-07-22', 300), day('2026-07-20', 900), day('2026-07-25', 600)]
    const s = summarizeBookRecords(records, 1800)
    expect(s.days).toBe(3)
    expect(s.startDate).toBe('2026-07-20')
    expect(s.avgSecondsPerDay).toBe(600)
  })

  it('keeps a zero total at zero average', () => {
    const s = summarizeBookRecords([day('2026-07-20', 0), day('2026-07-21', 0)], 0)
    expect(s.avgSecondsPerDay).toBe(0)
  })
})

describe('buildBookChartBars', () => {
  it('returns no bars for empty records', () => {
    expect(buildBookChartBars([], 300)).toEqual({ mode: 'daily', bars: [] })
  })

  it('returns daily bars sorted ascending', () => {
    const { mode, bars } = buildBookChartBars(
      [day('2026-07-22', 300), day('2026-07-20', 900)],
      300,
    )
    expect(mode).toBe('daily')
    expect(bars.map((b) => b.key)).toEqual(['2026-07-20', '2026-07-22'])
    expect(bars[0]).toMatchObject({ tick: '7.20', seconds: 900, rangeLabel: '2026-07-20' })
  })

  it('stays daily at exactly the width boundary and degrades one day past it', () => {
    const width = 25 * MIN_BAR_WIDTH_PX
    const records = Array.from({ length: 26 }, (_, i) =>
      day(`2026-07-${String(i + 1).padStart(2, '0')}`, 60))
    expect(buildBookChartBars(records.slice(0, 25), width).mode).toBe('daily')
    expect(buildBookChartBars(records, width).mode).toBe('weekly')
  })

  it('aggregates daily records into ISO weeks starting Monday', () => {
    // 2024-01-01 is a Monday; 2024-01-07 the same ISO week; 2024-01-08 the next
    const records = [
      day('2024-01-01', 100),
      day('2024-01-03', 200),
      day('2024-01-07', 50),
      day('2024-01-08', 400),
    ]
    const { mode, bars } = buildBookChartBars(records, 0)
    expect(mode).toBe('weekly')
    expect(bars).toEqual([
      { key: '2024-01-01', tick: '1.1', seconds: 350, rangeLabel: '2024-01-01~2024-01-07' },
      { key: '2024-01-08', tick: '1.8', seconds: 400, rangeLabel: '2024-01-08~2024-01-14' },
    ])
  })

  it('keeps weeks across a year boundary in separate ascending buckets', () => {
    // 2024-12-30 is a Monday; 2024-12-29 belongs to the previous week
    const records = [day('2024-12-29', 10), day('2024-12-30', 20), day('2025-01-01', 40)]
    const { bars } = buildBookChartBars(records, 0)
    expect(bars.map((b) => [b.key, b.seconds])).toEqual([
      ['2024-12-23', 10],
      ['2024-12-30', 60],
    ])
  })
})
