import {
  localDateString,
  useReadingByBook,
  useReadingDaily,
  useReadingSummary,
} from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

import { periodRange, shiftPeriod } from '../date-utils'

function monthDelta(current: number, previous: number, format: (v: number) => string, _: (key: string, options?: Record<string, string | number>) => string): string {
  const diff = current - previous
  const delta = diff === 0 ? _('stats.noChange') : `${diff > 0 ? '+' : '-'}${format(Math.abs(diff))}`
  return _('stats.vsLastMonth', { delta })
}

export default function SummaryCards() {
  const _ = useTranslation()
  const { data } = useReadingSummary()
  const s = data?.data

  const now = new Date()
  const thisMonth = periodRange('month', now)
  const lastMonth = periodRange('month', shiftPeriod('month', now, -1))
  const thisFrom = localDateString(thisMonth.from)
  const thisTo = localDateString(now)
  const lastFrom = localDateString(lastMonth.from)
  // Same-period comparison: clamp to the same day-of-month, capped at last month's end
  const sameDayLastMonth = new Date(lastMonth.from.getFullYear(), lastMonth.from.getMonth(), now.getDate())
  const lastTo = localDateString(sameDayLastMonth > lastMonth.to ? lastMonth.to : sameDayLastMonth)
  const dailyThis = useReadingDaily(thisFrom, thisTo).data?.data
  const dailyLast = useReadingDaily(lastFrom, lastTo).data?.data
  const booksThis = useReadingByBook(thisFrom, thisTo).data?.data
  const booksLast = useReadingByBook(lastFrom, lastTo).data?.data

  const secondsThis = dailyThis?.reduce((sum, d) => sum + d.durationSeconds, 0)
  const secondsLast = dailyLast?.reduce((sum, d) => sum + d.durationSeconds, 0)
  const monthLoaded = dailyThis && dailyLast && booksThis && booksLast
    && secondsThis !== undefined && secondsLast !== undefined

  const cards: { label: string; value: string; sub?: string; delta?: string }[] = [
    {
      label: _('stats.totalTime'),
      value: s ? formatDuration(s.totalSeconds, _) : '-',
      sub: s ? `${_('stats.today')} ${formatDuration(s.todaySeconds, _)}` : undefined,
      delta: monthLoaded ? monthDelta(secondsThis, secondsLast, (v) => formatDuration(v, _), _) : undefined,
    },
    {
      label: _('stats.totalDays'),
      value: s ? `${s.totalDays} ${_('stats.days')}` : '-',
      delta: monthLoaded
        ? monthDelta(dailyThis.length, dailyLast.length, (v) => `${v} ${_('stats.days')}`, _)
        : undefined,
    },
    {
      label: _('stats.totalBooks'),
      value: s ? String(s.totalBooks) : '-',
      delta: monthLoaded
        ? monthDelta(booksThis.length, booksLast.length, (v) => _('stats.booksUnit', { n: v }), _)
        : undefined,
    },
    {
      label: _('stats.streak'),
      value: s ? `${s.currentStreak} ${_('stats.days')}` : '-',
      sub: s ? `${_('stats.streakLongest')} ${s.longestStreak} ${_('stats.days')}` : undefined,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <section
          key={c.label}
          className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900"
        >
          <p className="text-xs text-stone-500 dark:text-stone-400">{c.label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{c.value}</p>
          {c.sub && <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{c.sub}</p>}
          {c.delta && <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{c.delta}</p>}
        </section>
      ))}
    </div>
  )
}
