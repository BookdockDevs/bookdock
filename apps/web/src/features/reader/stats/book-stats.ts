import type { ReadingRecordDailyItem } from '@bookdock/shared'

export interface BookStatsSummary {
  totalSeconds: number
  days: number
  startDate: string | null
  avgSecondsPerDay: number
}

export function summarizeBookRecords(records: ReadingRecordDailyItem[], totalSeconds: number): BookStatsSummary {
  const days = records.length
  let startDate: string | null = null
  for (const r of records) {
    if (startDate === null || r.date < startDate) startDate = r.date
  }
  return {
    totalSeconds,
    days,
    startDate,
    avgSecondsPerDay: days > 0 ? totalSeconds / days : 0,
  }
}

export interface StatsBar {
  key: string
  /** Short tick label under the bar ('M.D') */
  tick: string
  seconds: number
  /** Date or week range shown in the tooltip before the duration */
  rangeLabel: string
}

/** Below this per-bar width the daily chart degrades to weekly buckets */
export const MIN_BAR_WIDTH_PX = 4

export interface BookChartBars {
  mode: 'daily' | 'weekly'
  bars: StatsBar[]
}

function tickOf(date: string): string {
  return `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Monday of the ISO week containing 'YYYY-MM-DD' */
function isoWeekStart(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return formatDate(d)
}

function shiftDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return formatDate(d)
}

export function buildBookChartBars(records: ReadingRecordDailyItem[], availableWidthPx: number): BookChartBars {
  const sorted = [...records].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const maxBars = Math.floor(availableWidthPx / MIN_BAR_WIDTH_PX)
  if (sorted.length <= maxBars) {
    return {
      mode: 'daily',
      bars: sorted.map((r) => ({
        key: r.date,
        tick: tickOf(r.date),
        seconds: r.durationSeconds,
        rangeLabel: r.date,
      })),
    }
  }
  const weeks = new Map<string, number>()
  for (const r of sorted) {
    const week = isoWeekStart(r.date)
    weeks.set(week, (weeks.get(week) ?? 0) + r.durationSeconds)
  }
  return {
    mode: 'weekly',
    bars: [...weeks.entries()].map(([week, seconds]) => ({
      key: week,
      tick: tickOf(week),
      seconds,
      rangeLabel: `${week}~${shiftDays(week, 6)}`,
    })),
  }
}
