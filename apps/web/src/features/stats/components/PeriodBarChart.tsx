import { localDateString, useReadingDaily } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

import { fillDailyDays, formatPeriodLabel } from '../date-utils'
import type { DayRange, StatsPeriod } from '../date-utils'

interface PeriodBarChartProps {
  period: StatsPeriod
  range: DayRange
  selectedDate: string | null
  onPeriodChange: (period: StatsPeriod) => void
  onShift: (delta: number) => void
  onDrillMonth: (d: Date) => void
  onSelectDate: (date: string) => void
}

interface Bar {
  key: string
  testId: string
  tick: string
  seconds: number
  selected: boolean
  onClick: () => void
}

const PERIODS: StatsPeriod[] = ['week', 'month', 'year']

const arrowClass =
  'flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300'

export default function PeriodBarChart({
  period,
  range,
  selectedDate,
  onPeriodChange,
  onShift,
  onDrillMonth,
  onSelectDate,
}: PeriodBarChartProps) {
  const _ = useTranslation()
  const { data } = useReadingDaily(localDateString(range.from), localDateString(range.to))
  const items = data?.data ?? []

  let bars: Bar[]
  if (period === 'year') {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i,
      seconds: 0,
    }))
    for (const item of items) {
      const month = Number(item.date.slice(5, 7)) - 1
      if (month >= 0 && month < 12) months[month].seconds += item.durationSeconds
    }
    bars = months.map((m) => ({
      key: `month-${m.month}`,
      testId: `bar-month-${range.from.getFullYear()}-${String(m.month + 1).padStart(2, '0')}`,
      tick: `${m.month + 1}`,
      seconds: m.seconds,
      selected: false,
      onClick: () => onDrillMonth(new Date(range.from.getFullYear(), m.month, 1)),
    }))
  } else {
    bars = fillDailyDays(items, range.from, range.to).map((d) => {
      const date = new Date(`${d.date}T00:00:00`)
      return {
        key: d.date,
        testId: `bar-${d.date}`,
        tick: period === 'week' ? `${date.getMonth() + 1}.${date.getDate()}` : `${date.getDate()}`,
        seconds: d.durationSeconds,
        selected: selectedDate === d.date,
        onClick: () => onSelectDate(d.date),
      }
    })
  }

  const max = Math.max(0, ...bars.map((b) => b.seconds))

  const peak = period !== 'year' && items.length > 0
    ? items.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a))
    : null

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPeriodChange(p)}
              className={cn(
                'rounded-md px-3 py-1 text-xs transition-all',
                period === p
                  ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-50'
                  : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100',
              )}
            >
              {_(`stats.${p}`)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button type="button" aria-label={_('stats.prevPeriod')} onClick={() => onShift(-1)} className={arrowClass}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span className="min-w-28 text-center text-sm tabular-nums text-stone-600 dark:text-stone-300">
            {formatPeriodLabel(period, range)}
          </span>
          <button type="button" aria-label={_('stats.nextPeriod')} onClick={() => onShift(1)} className={arrowClass}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex h-28 items-end gap-1">
        {bars.map((b) => (
          <button
            key={b.key}
            type="button"
            data-testid={b.testId}
            title={`${b.key.startsWith('month-') ? b.testId.slice(10) : b.key}: ${formatDuration(b.seconds, _)}`}
            onClick={b.onClick}
            className="flex h-full min-w-0 flex-1 items-end"
          >
            <div
              className={cn(
                'w-full rounded-t-sm transition-colors',
                b.seconds > 0
                  ? b.selected
                    ? 'bg-amber-500 dark:bg-amber-400'
                    : 'bg-stone-700/80 hover:bg-stone-700 dark:bg-stone-300/80 dark:hover:bg-stone-300'
                  : 'bg-stone-200/70 dark:bg-stone-800',
              )}
              style={{ height: b.seconds > 0 && max > 0 ? `${Math.max(4, (b.seconds / max) * 100)}%` : '2px' }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {bars.map((b) => (
          <span key={b.key} className="min-w-0 flex-1 truncate text-center text-[10px] tabular-nums text-stone-400 dark:text-stone-500">
            {b.tick}
          </span>
        ))}
      </div>
      {peak && (
        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          {_('stats.insight', {
            period: _(`stats.${period}`).toLowerCase(),
            days: items.length,
            date: `${Number(peak.date.slice(5, 7))}.${Number(peak.date.slice(8, 10))}`,
            time: formatDuration(peak.durationSeconds, _),
          })}
        </p>
      )}
    </section>
  )
}
