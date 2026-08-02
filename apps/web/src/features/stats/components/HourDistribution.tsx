import { localDateString, useReadingHourly } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

import { formatPeriodLabel } from '../date-utils'
import type { DayRange, StatsPeriod } from '../date-utils'

interface HourDistributionProps {
  date: string | null
  period: StatsPeriod
  range: DayRange
}

const TICK_HOURS = [0, 6, 12, 18, 23]

export default function HourDistribution({ date, period, range }: HourDistributionProps) {
  const _ = useTranslation()
  const from = date ?? localDateString(range.from)
  const to = date ?? localDateString(range.to)
  const { data } = useReadingHourly(from, to)
  const items = data?.data ?? []

  const byHour = new Map(items.map((i) => [i.hour, i.durationSeconds]))
  const bars = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: byHour.get(hour) ?? 0 }))
  const max = Math.max(0, ...bars.map((b) => b.seconds))
  const peak = items.length > 0
    ? items.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a))
    : null
  const scopeLabel = date ?? formatPeriodLabel(period, range)

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 text-sm font-medium">
        <span>{_('stats.hourDistribution')}</span>
        <span className="tabular-nums text-stone-500 dark:text-stone-400"> · {scopeLabel}</span>
      </h2>
      <div className="flex h-28 items-end gap-1">
        {bars.map((b) => (
          <div key={b.hour} className="flex h-full min-w-0 flex-1 items-end" title={`${b.hour}:00: ${formatDuration(b.seconds, _)}`}>
            <div
              className={cn(
                'w-full rounded-t-sm',
                b.seconds > 0 ? 'bg-stone-700/80 dark:bg-stone-300/80' : 'bg-stone-200/70 dark:bg-stone-800',
              )}
              style={{ height: b.seconds > 0 && max > 0 ? `${Math.max(4, (b.seconds / max) * 100)}%` : '2px' }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {bars.map((b) => (
          <span key={b.hour} className="min-w-0 flex-1 truncate text-center text-[10px] tabular-nums text-stone-400 dark:text-stone-500">
            {TICK_HOURS.includes(b.hour) ? b.hour : ''}
          </span>
        ))}
      </div>
      {peak && (
        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          {_('stats.hourInsight', { range: `${peak.hour}:00-${peak.hour + 1}:00`, time: formatDuration(peak.durationSeconds, _) })}
        </p>
      )}
    </section>
  )
}
