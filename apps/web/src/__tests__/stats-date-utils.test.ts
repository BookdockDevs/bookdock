import { describe, it, expect } from 'vitest'

import {
  eachDay,
  fillDailyDays,
  formatPeriodLabel,
  formatDisplayPeriodLabel,
  heatmapWeeks,
  isFutureOrCurrentPeriod,
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

describe('isFutureOrCurrentPeriod', () => {
  it('identifies current and future weeks correctly', () => {
    const fixedNow = new Date(2026, 9, 15) // Thu Oct 15 2026
    const currentWeek = periodRange('week', fixedNow)
    expect(isFutureOrCurrentPeriod('week', currentWeek, fixedNow)).toBe(true)

    const pastWeek = periodRange('week', new Date(2026, 9, 5))
    expect(isFutureOrCurrentPeriod('week', pastWeek, fixedNow)).toBe(false)

    const futureWeek = periodRange('week', new Date(2026, 9, 22))
    expect(isFutureOrCurrentPeriod('week', futureWeek, fixedNow)).toBe(true)
  })

  it('identifies current and future months correctly', () => {
    const fixedNow = new Date(2026, 9, 15) // Oct 2026
    const currentMonth = periodRange('month', fixedNow)
    expect(isFutureOrCurrentPeriod('month', currentMonth, fixedNow)).toBe(true)

    const pastMonth = periodRange('month', new Date(2026, 8, 1))
    expect(isFutureOrCurrentPeriod('month', pastMonth, fixedNow)).toBe(false)
  })

  it('identifies current and future years correctly', () => {
    const fixedNow = new Date(2026, 9, 15)
    const currentYear = periodRange('year', fixedNow)
    expect(isFutureOrCurrentPeriod('year', currentYear, fixedNow)).toBe(true)

    const pastYear = periodRange('year', new Date(2025, 0, 1))
    expect(isFutureOrCurrentPeriod('year', pastYear, fixedNow)).toBe(false)
  })

  it('always returns true for all period', () => {
    expect(isFutureOrCurrentPeriod('all', periodRange('all', new Date()))).toBe(true)
  })
})

describe('formatDisplayPeriodLabel', () => {
  it('formats week label in Chinese and English', () => {
    const range = periodRange('week', new Date(2026, 9, 15)) // Oct 12 - 18
    expect(formatDisplayPeriodLabel('week', range, { lang: 'zh-CN' })).toBe('10月12日～18日')
    expect(formatDisplayPeriodLabel('week', range, { lang: 'en' })).toBe('10.12 - 10.18')
  })

  it('formats month and year in Chinese and English', () => {
    const monthRange = periodRange('month', new Date(2026, 9, 15))
    expect(formatDisplayPeriodLabel('month', monthRange, { lang: 'zh-CN' })).toBe('2026年10月')
    expect(formatDisplayPeriodLabel('month', monthRange, { lang: 'en' })).toBe('2026.10')

    const yearRange = periodRange('year', new Date(2026, 9, 15))
    expect(formatDisplayPeriodLabel('year', yearRange, { lang: 'zh-CN' })).toBe('2026年')
    expect(formatDisplayPeriodLabel('year', yearRange, { lang: 'en' })).toBe('2026')
  })

  it('formats all mode with year range from firstRecordedDate', () => {
    const allRange = periodRange('all', new Date())
    const curYear = new Date().getFullYear()
    expect(formatDisplayPeriodLabel('all', allRange, { lang: 'zh-CN', firstRecordedDate: '2020-04-10' })).toBe(`2020年～${curYear}年`)
    expect(formatDisplayPeriodLabel('all', allRange, { lang: 'en', firstRecordedDate: '2020-04-10' })).toBe(`2020 - ${curYear}`)
  })
})
