import { localDateString } from '@/api/hooks/reading-records'

export type StatsPeriod = 'week' | 'month' | 'year' | 'all'

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
  if (period === 'all') return { from: new Date(1970, 0, 1), to: new Date() }
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

export interface DeltaInfo {
  text: string
  direction: 'up' | 'down' | 'neutral'
}

export function periodDelta(
  current: number,
  previous: number,
  format: (v: number) => string,
  _: (key: string, options?: Record<string, string | number>) => string,
  period: StatsPeriod,
): DeltaInfo {
  const diff = current - previous
  const vsPeriodKey =
    period === 'week'
      ? 'stats.vsLastWeekPrefix'
      : period === 'month'
        ? 'stats.vsPrevMonthPrefix'
        : period === 'year'
          ? 'stats.vsLastYearPrefix'
          : 'stats.vsPrevPeriodPrefix'
  const prefix =
    _(vsPeriodKey) ||
    (period === 'week' ? '较上周' : period === 'month' ? '较上月' : period === 'year' ? '较上年' : '较上周期')

  if (diff === 0) {
    const noChangeText = _('stats.noChange') || '无变化'
    const space = prefix.endsWith(' ') ? '' : ' '
    return {
      text: `${prefix}${space}${noChangeText}`,
      direction: 'neutral',
    }
  }

  const sign = diff > 0 ? '+' : '-'
  const formattedVal = format(Math.abs(diff))
  return {
    text: `${prefix}${sign}${formattedVal}`,
    direction: diff > 0 ? 'up' : 'down',
  }
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
  if (period === 'all') return 'All'
  const { from, to } = range
  if (period === 'year') return `${from.getFullYear()}`
  if (period === 'month') return `${from.getFullYear()}.${from.getMonth() + 1}`
  return `${from.getFullYear()}.${from.getMonth() + 1}.${from.getDate()} - ${to.getMonth() + 1}.${to.getDate()}`
}

/** Checks if range has reached or exceeded current period (prevents future navigation) */
export function isFutureOrCurrentPeriod(period: StatsPeriod, range: DayRange, now = new Date()): boolean {
  if (period === 'all') return true
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'week') {
    return range.to.getTime() >= today.getTime()
  }
  if (period === 'month') {
    return (
      range.from.getFullYear() > today.getFullYear() ||
      (range.from.getFullYear() === today.getFullYear() && range.from.getMonth() >= today.getMonth())
    )
  }
  if (period === 'year') {
    return range.from.getFullYear() >= today.getFullYear()
  }
  return false
}

export function formatDisplayPeriodLabel(
  period: StatsPeriod,
  range: DayRange,
  options?: { lang?: string; firstRecordedDate?: string },
): string {
  const isZh = !options?.lang || options.lang.startsWith('zh')
  const currentYear = new Date().getFullYear()

  if (period === 'all') {
    const firstYear = options?.firstRecordedDate ? parseInt(options.firstRecordedDate.slice(0, 4), 10) : currentYear
    if (firstYear < currentYear) {
      return isZh ? `${firstYear}年～${currentYear}年` : `${firstYear} - ${currentYear}`
    }
    return isZh ? `${currentYear}年` : `${currentYear}`
  }

  const { from, to } = range
  if (period === 'year') {
    return isZh ? `${from.getFullYear()}年` : `${from.getFullYear()}`
  }

  if (period === 'month') {
    return isZh ? `${from.getFullYear()}年${from.getMonth() + 1}月` : `${from.getFullYear()}.${from.getMonth() + 1}`
  }

  // Week
  if (isZh) {
    if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) {
      return `${from.getMonth() + 1}月${from.getDate()}日～${to.getDate()}日`
    }
    if (from.getFullYear() === to.getFullYear()) {
      return `${from.getMonth() + 1}月${from.getDate()}日～${to.getMonth() + 1}月${to.getDate()}日`
    }
    return `${from.getFullYear()}年${from.getMonth() + 1}月${from.getDate()}日～${to.getFullYear()}年${to.getMonth() + 1}月${to.getDate()}日`
  }

  return `${from.getMonth() + 1}.${from.getDate()} - ${to.getMonth() + 1}.${to.getDate()}`
}
