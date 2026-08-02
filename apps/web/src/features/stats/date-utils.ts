import { localDateString } from '@/api/hooks/reading-records'

export type StatsPeriod = 'week' | 'month' | 'year'

export interface DayRange {
  from: Date
  to: Date
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Calendar range containing `anchor`; weeks start on Monday. */
export function periodRange(period: StatsPeriod, anchor: Date): DayRange {
  const a = startOfDay(anchor)
  if (period === 'week') {
    const mondayOffset = (a.getDay() + 6) % 7
    const from = new Date(a)
    from.setDate(a.getDate() - mondayOffset)
    const to = new Date(from)
    to.setDate(from.getDate() + 6)
    return { from, to }
  }
  if (period === 'month') {
    return {
      from: new Date(a.getFullYear(), a.getMonth(), 1),
      to: new Date(a.getFullYear(), a.getMonth() + 1, 0),
    }
  }
  return { from: new Date(a.getFullYear(), 0, 1), to: new Date(a.getFullYear(), 11, 31) }
}

export function shiftPeriod(period: StatsPeriod, anchor: Date, delta: number): Date {
  const a = startOfDay(anchor)
  if (period === 'week') {
    const d = new Date(a)
    d.setDate(d.getDate() + delta * 7)
    return d
  }
  if (period === 'month') return new Date(a.getFullYear(), a.getMonth() + delta, 1)
  return new Date(a.getFullYear() + delta, 0, 1)
}

export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = []
  const d = startOfDay(from)
  const end = startOfDay(to)
  while (d <= end) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

/** The API only returns days with records; fill the rest with zero. */
export function fillDailyDays(
  items: { date: string; durationSeconds: number }[],
  from: Date,
  to: Date,
): { date: string; durationSeconds: number }[] {
  const byDate = new Map(items.map((i) => [i.date, i.durationSeconds]))
  return eachDay(from, to).map((d) => {
    const date = localDateString(d)
    return { date, durationSeconds: byDate.get(date) ?? 0 }
  })
}

/** GitHub-style grid: columns are Monday-start weeks of `year`, cells outside the year are null. */
export function heatmapWeeks(year: number): (string | null)[][] {
  const first = new Date(year, 0, 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  const end = new Date(year, 11, 31)
  const weeks: (string | null)[][] = []
  const d = start
  while (d <= end) {
    const week: (string | null)[] = []
    for (let i = 0; i < 7; i++) {
      week.push(d.getFullYear() === year ? localDateString(d) : null)
      d.setDate(d.getDate() + 1)
    }
    weeks.push(week)
  }
  return weeks
}

export function formatPeriodLabel(period: StatsPeriod, range: DayRange): string {
  const { from, to } = range
  if (period === 'year') return `${from.getFullYear()}`
  if (period === 'month') return `${from.getFullYear()}.${from.getMonth() + 1}`
  return `${from.getFullYear()}.${from.getMonth() + 1}.${from.getDate()} - ${to.getMonth() + 1}.${to.getDate()}`
}
