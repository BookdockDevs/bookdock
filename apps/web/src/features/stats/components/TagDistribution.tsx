import { localDateString, useReadingByTag } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

import { formatPeriodLabel } from '../date-utils'
import type { DayRange, StatsPeriod } from '../date-utils'

interface TagDistributionProps {
  date: string | null
  period: StatsPeriod
  range: DayRange
}

const MAX_SLICES = 8

const SLICE_COLORS = [
  { slice: 'stroke-blue-500', dot: 'bg-blue-500' },
  { slice: 'stroke-emerald-500', dot: 'bg-emerald-500' },
  { slice: 'stroke-amber-500', dot: 'bg-amber-500' },
  { slice: 'stroke-rose-500', dot: 'bg-rose-500' },
  { slice: 'stroke-violet-500', dot: 'bg-violet-500' },
  { slice: 'stroke-cyan-500', dot: 'bg-cyan-500' },
  { slice: 'stroke-orange-500', dot: 'bg-orange-500' },
  { slice: 'stroke-lime-600', dot: 'bg-lime-600' },
]
const OTHER_COLOR = { slice: 'stroke-stone-300 dark:stroke-stone-600', dot: 'bg-stone-300 dark:bg-stone-600' }

export default function TagDistribution({ date, period, range }: TagDistributionProps) {
  const _ = useTranslation()
  const from = date ?? localDateString(range.from)
  const to = date ?? localDateString(range.to)
  const tagsQuery = useReadingByTag(from, to)
  const { data } = tagsQuery
  const items = data?.data ?? []
  const scopeLabel = date ?? formatPeriodLabel(period, range)

  if (tagsQuery.isError) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
        <QueryErrorState isRetrying={tagsQuery.isFetching} onRetry={tagsQuery.refetch} />
      </section>
    )
  }

  const total = items.reduce((sum, i) => sum + i.durationSeconds, 0)
  const kept = items.slice(0, MAX_SLICES)
  const rest = items.slice(MAX_SLICES)
  const raw = [
    ...kept.map((item, i) => ({ key: item.tagId, name: item.name, seconds: item.durationSeconds, color: SLICE_COLORS[i] })),
    ...(rest.length > 0
      ? [{ key: '__other__', name: _('stats.tagOther'), seconds: rest.reduce((sum, i) => sum + i.durationSeconds, 0), color: OTHER_COLOR }]
      : []),
  ]
  let acc = 0
  const slices = raw.map((s) => {
    const frac = total > 0 ? s.seconds / total : 0
    const offset = acc
    acc += frac
    return { ...s, frac, offset }
  })

  const isTagsLoading = tagsQuery.isLoading && !data

  return (
    <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 text-sm font-semibold text-stone-900 dark:text-stone-100">
        <span>{_('stats.tagDistribution')}</span>
        <span className="font-normal tabular-nums text-stone-400 dark:text-stone-500"> · {scopeLabel}</span>
      </h2>
      {isTagsLoading ? (
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <div className="flex h-36 w-36 shrink-0 items-center justify-center">
            <div className="h-32 w-32 animate-pulse rounded-full border-[14px] border-stone-200/60 dark:border-stone-800" />
          </div>
          <div className="flex w-full min-w-0 flex-1 flex-col gap-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-stone-200/70 dark:bg-stone-800" />
                <div className="h-3.5 w-24 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
                <div className="ml-auto h-3.5 w-12 animate-pulse rounded bg-stone-200/50 dark:bg-stone-800/60" />
                <div className="h-3.5 w-8 animate-pulse rounded bg-stone-200/40 dark:bg-stone-800/40" />
              </div>
            ))}
          </div>
        </div>
      ) : total === 0 ? (
        <p className="py-6 text-center text-sm text-stone-400 dark:text-stone-500">{_('stats.emptyTags')}</p>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0 -rotate-90">
            {slices.map((s) => (
              <circle
                key={s.key}
                cx="60"
                cy="60"
                r="45"
                fill="none"
                pathLength={100}
                strokeWidth="16"
                className={s.color.slice}
                strokeDasharray={`${s.frac * 100} ${100 - s.frac * 100}`}
                strokeDashoffset={-s.offset * 100}
              />
            ))}
          </svg>
          <ul className="flex w-full min-w-0 flex-1 flex-col gap-2">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-sm">
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', s.color.dot)} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 tabular-nums text-stone-500 dark:text-stone-400">
                  {formatDuration(s.seconds, _)}
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-stone-400 dark:text-stone-500">
                  {Math.round((s.seconds / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
