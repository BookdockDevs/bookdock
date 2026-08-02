import { describe, it, expect } from 'vitest'

import {
  eachDay,
  fillDailyDays,
  formatPeriodLabel,
  heatmapWeeks,
  periodRange,
  shiftPeriod,
} from '../features/stats/date-utils'

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('periodRange', () => {
  it('returns the Monday-start week containing the anchor', () => {
    const range = periodRange('week', new Date(2026, 6, 30)) // Thursday
    expect(fmt(range.from)).toBe('2026-07-27')
    expect(fmt(range.to)).toBe('2026-08-02')
  })

  it('treats Sunday as the last day of the same week', () => {
    const range = periodRange('week', new Date(2026, 7, 2))
    expect(fmt(range.from)).toBe('2026-07-27')
    expect(fmt(range.to)).toBe('2026-08-02')
  })

  it('treats Monday as the first day of a new week', () => {
    const range = periodRange('week', new Date(2026, 6, 27))
    expect(fmt(range.from)).toBe('2026-07-27')
    expect(fmt(range.to)).toBe('2026-08-02')
  })

  it('returns the full month including the last day', () => {
    const range = periodRange('month', new Date(2026, 0, 31))
    expect(fmt(range.from)).toBe('2026-01-01')
    expect(fmt(range.to)).toBe('2026-01-31')
  })

  it('handles February in leap and non-leap years', () => {
    expect(fmt(periodRange('month', new Date(2026, 1, 10)).to)).toBe('2026-02-28')
    expect(fmt(periodRange('month', new Date(2024, 1, 10)).to)).toBe('2024-02-29')
  })

  it('returns the full year', () => {
    const range = periodRange('year', new Date(2026, 6, 30))
    expect(fmt(range.from)).toBe('2026-01-01')
    expect(fmt(range.to)).toBe('2026-12-31')
  })
})

describe('shiftPeriod', () => {
  it('shifts weeks by seven days', () => {
    const shifted = shiftPeriod('week', new Date(2026, 6, 30), 1)
    const range = periodRange('week', shifted)
    expect(fmt(range.from)).toBe('2026-08-03')
    expect(fmt(range.to)).toBe('2026-08-09')
  })

  it('shifts months across year boundaries', () => {
    expect(fmt(shiftPeriod('month', new Date(2026, 0, 15), -1))).toBe('2025-12-01')
    expect(fmt(shiftPeriod('month', new Date(2026, 11, 15), 1))).toBe('2027-01-01')
  })

  it('shifts years', () => {
    expect(fmt(shiftPeriod('year', new Date(2026, 6, 30), 1))).toBe('2027-01-01')
  })
})

describe('eachDay', () => {
  it('lists every day of the range inclusive', () => {
    const days = eachDay(new Date(2026, 6, 27), new Date(2026, 7, 2))
    expect(days.map(fmt)).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ])
  })
})

describe('fillDailyDays', () => {
  it('fills days without records with zero', () => {
    const filled = fillDailyDays(
      [{ date: '2026-07-29', durationSeconds: 3661 }],
      new Date(2026, 6, 27),
      new Date(2026, 7, 2),
    )
    expect(filled).toHaveLength(7)
    expect(filled.find((d) => d.date === '2026-07-29')?.durationSeconds).toBe(3661)
    expect(filled.find((d) => d.date === '2026-07-28')?.durationSeconds).toBe(0)
    expect(filled.find((d) => d.date === '2026-08-02')?.durationSeconds).toBe(0)
  })

  it('returns all-zero days for empty input', () => {
    const filled = fillDailyDays([], new Date(2026, 1, 1), new Date(2026, 1, 28))
    expect(filled).toHaveLength(28)
    expect(filled.every((d) => d.durationSeconds === 0)).toBe(true)
  })
})

describe('heatmapWeeks', () => {
  it('builds Monday-start week columns covering the whole year', () => {
    const weeks = heatmapWeeks(2026)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    // Jan 1 2026 is a Thursday: the first week pads Mon-Wed of Dec 2025 with null
    expect(weeks[0][0]).toBeNull()
    expect(weeks[0][1]).toBeNull()
    expect(weeks[0][2]).toBeNull()
    expect(weeks[0][3]).toBe('2026-01-01')
    const dates = weeks.flat().filter((d): d is string => d !== null)
    expect(dates).toHaveLength(365)
    expect(dates[0]).toBe('2026-01-01')
    expect(dates[dates.length - 1]).toBe('2026-12-31')
  })
})

describe('formatPeriodLabel', () => {
  it('formats the week range', () => {
    const range = periodRange('week', new Date(2026, 6, 30))
    expect(formatPeriodLabel('week', range)).toBe('2026.7.27 - 8.2')
  })

  it('formats month and year', () => {
    expect(formatPeriodLabel('month', periodRange('month', new Date(2026, 6, 30)))).toBe('2026.7')
    expect(formatPeriodLabel('year', periodRange('year', new Date(2026, 6, 30)))).toBe('2026')
  })
})
