import type { ReadingRange } from '@bookdock/shared'

import { periodRange, type StatsPeriod } from '@/features/stats/date-utils'

export interface ArchiveScopeSearch {
  period?: StatsPeriod
  anchor?: string
  date?: string
  timezone?: string
}

export function resolveArchiveScope(search: ArchiveScopeSearch = {}) {
  const timezone = search.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const anchor = new Date(`${search.anchor ?? today}T12:00:00`)
  const period = search.period ?? 'week'
  const range = periodRange(period, anchor)
  const selectedDate = search.date ?? null
  const dateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const query: ReadingRange = {
    timezone,
    ...(selectedDate ? { from: selectedDate, to: selectedDate }
      : period === 'all' ? {} : { from: dateString(range.from), to: dateString(range.to) }),
  }
  return { period, anchor, range, selectedDate, query }
}

export function archiveRangeParams(range?: ReadingRange): URLSearchParams {
  const params = new URLSearchParams()
  if (range?.from) params.set('from', range.from)
  if (range?.to) params.set('to', range.to)
  if (range?.timezone) params.set('timezone', range.timezone)
  return params
}
