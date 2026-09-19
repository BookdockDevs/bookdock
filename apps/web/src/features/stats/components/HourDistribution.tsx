import { useState } from 'react'

import { localDateString, useReadingHourly } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
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
  const hourlyQuery = useReadingHourly(from, to)
  const { data } = hourlyQuery
  const items = data?.data ?? []

  const byHour = new Map(items.map((i) => [i.hour, i.durationSeconds]))
  const bars = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: byHour.get(hour) ?? 0 }))
  const max = Math.max(0, ...bars.map((b) => b.seconds))
  const peak = items.length > 0
    ? items.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a))
    : null
  const scopeLabel = date ?? formatPeriodLabel(period, range)
  const [selectedHour, setSelectedHour] = useState<number | null>(null)
  const selectedBar = selectedHour === null ? null : bars[selectedHour]

  if (hourlyQuery.isError) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
        <QueryErrorState isRetrying={hourlyQuery.isFetching} onRetry={hourlyQuery.refetch} />
      </section>
    )
  }

  const isHourlyLoading = hourlyQuery.isLoading && !data

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 text-sm font-medium">
        <span>{_('stats.hourDistribution')}</span>
        <span className="tabular-nums text-stone-500 dark:text-stone-400">
          {' · '}{selectedBar ? `${String(selectedBar.hour).padStart(2, '0')}:00 · ${formatDuration(selectedBar.seconds, _)}` : scopeLabel}
        </span>
      </h2>
      {isHourlyLoading ? (
        <div className="flex h-28 items-end gap-1">
          {Array.from({ length: 24 }).map((_, hour) => (
            <div key={hour} className="flex h-full min-w-0 flex-1 items-end">
              <div
                className="w-full animate-pulse rounded-t-sm bg-stone-200/60 dark:bg-stone-800"
                style={{
                  height: `${[15, 10, 5, 5, 5, 10, 25, 40, 35, 50, 60, 45, 55, 70, 65, 80, 75, 90, 85, 95, 70, 60, 45, 25][hour]}%`,
                  animationDelay: `${hour * 30}ms`,
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex h-28 items-end gap-1">
          {bars.map((b) => (
            <button
              key={b.hour}
              type="button"
              title={`${b.hour}:00: ${formatDuration(b.seconds, _)}`}
              aria-label={`${String(b.hour).padStart(2, '0')}:00: ${formatDuration(b.seconds, _)}`}
              aria-pressed={selectedHour === b.hour}
              onClick={() => setSelectedHour((current) => (current === b.hour ? null : b.hour))}
              className="flex h-full min-w-0 flex-1 items-end border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <div
                className={cn(
                  'w-full rounded-t-sm transition-colors',
                  selectedHour === b.hour
                    ? 'bg-blue-600 dark:bg-blue-400'
                    : b.seconds > 0 ? 'bg-stone-700/80 dark:bg-stone-300/80' : 'bg-stone-200/70 dark:bg-stone-800',
                )}
                style={{ height: b.seconds > 0 && max > 0 ? `${Math.max(4, (b.seconds / max) * 100)}%` : '2px' }}
              />
            </button>
          ))}
        </div>
      )}
      <div className="mt-1 flex gap-1">
        {bars.map((b) => (
          <span key={b.hour} className="min-w-0 flex-1 truncate text-center text-[10px] tabular-nums text-stone-400 dark:text-stone-500">
            {TICK_HOURS.includes(b.hour) ? b.hour : ''}
          </span>
        ))}
      </div>
      {isHourlyLoading ? (
        <div className="mt-3 h-3.5 w-44 animate-pulse rounded bg-stone-200/50 dark:bg-stone-800/80" />
      ) : peak ? (
        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          {_('stats.hourInsight', { range: `${peak.hour}:00-${peak.hour + 1}:00`, time: formatDuration(peak.durationSeconds, _) })}
        </p>
      ) : null}
    </section>
  )
}
