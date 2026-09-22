import { useMemo } from 'react'

import { useReadingDaily } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

import { heatmapWeeks } from '../date-utils'

interface YearHeatmapProps {
  selectedDate: string | null
  onSelectDate: (date: string) => void
}

function levelClass(seconds: number, max: number): string {
  if (seconds <= 0 || max <= 0) return 'bg-stone-100 hover:bg-stone-200 dark:bg-stone-850 dark:hover:bg-stone-800'
  const ratio = seconds / max
  if (ratio <= 0.25) return 'bg-emerald-200 hover:bg-emerald-300 dark:bg-emerald-950/70 dark:hover:bg-emerald-900'
  if (ratio <= 0.5) return 'bg-emerald-400 hover:bg-emerald-500 dark:bg-emerald-700 dark:hover:bg-emerald-600'
  if (ratio <= 0.75) return 'bg-emerald-500 hover:bg-emerald-600 dark:bg-emerald-500 dark:hover:bg-emerald-400'
  return 'bg-emerald-700 hover:bg-emerald-800 dark:bg-emerald-400 dark:hover:bg-emerald-300'
}

export default function YearHeatmap({ selectedDate, onSelectDate }: YearHeatmapProps) {
  const _ = useTranslation()
  const year = new Date().getFullYear()
  const dailyQuery = useReadingDaily(`${year}-01-01`, `${year}-12-31`)
  const { data } = dailyQuery
  const secondsByDate = useMemo(() => new Map((data?.data ?? []).map((i) => [i.date, i.durationSeconds])), [data])
  const max = Math.max(0, ...secondsByDate.values())
  const weeks = useMemo(() => heatmapWeeks(year), [year])

  // Extract month label positions
  const monthLabels = useMemo(() => {
    const labels: { weekIndex: number; name: string }[] = []
    let prevMonth = -1
    weeks.forEach((week, wIdx) => {
      const firstValid = week.find((d) => d !== null)
      if (firstValid) {
        const m = Number(firstValid.slice(5, 7)) - 1
        if (m !== prevMonth) {
          const d = new Date(year, m, 1)
          const name = d.toLocaleDateString(undefined, { month: 'short' })
          labels.push({ weekIndex: wIdx, name })
          prevMonth = m
        }
      }
    })
    return labels
  }, [weeks, year])

  if (dailyQuery.isError) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
        <QueryErrorState isRetrying={dailyQuery.isFetching} onRetry={dailyQuery.refetch} />
      </section>
    )
  }

  const isHeatmapLoading = dailyQuery.isLoading && !data

  return (
    <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          <span>{_('stats.yearHeatmap')}</span>
          <span className="font-normal tabular-nums text-stone-400 dark:text-stone-500"> · {year}</span>
        </h2>
        {selectedDate && (
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {selectedDate} · <span className="font-medium text-stone-700 dark:text-stone-200">{formatDuration(secondsByDate.get(selectedDate) ?? 0, _)}</span>
          </span>
        )}
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-[680px]">
          {/* Month labels */}
          <div className="mb-1.5 flex h-4 text-[10px] text-stone-400 select-none dark:text-stone-500">
            <div className="w-5 shrink-0" />
            <div className="relative flex-1">
              {monthLabels.map((m) => (
                <span
                  key={m.weekIndex}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${(m.weekIndex / weeks.length) * 100}%` }}
                >
                  {m.name}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            {/* Weekday labels */}
            <div className="grid w-5 shrink-0 grid-rows-7 gap-[3px] py-[0.5px] text-right text-[9px] text-stone-400 select-none dark:text-stone-500">
              <span className="h-3 leading-3">{_('stats.weekdayMon')}</span>
              <span className="h-3" />
              <span className="h-3 leading-3">{_('stats.weekdayWed')}</span>
              <span className="h-3" />
              <span className="h-3 leading-3">{_('stats.weekdayFri')}</span>
              <span className="h-3" />
              <span className="h-3" />
            </div>

            {/* Heatmap cells */}
            <div className={cn('grid flex-1 grid-flow-col grid-rows-7 gap-[3px]', isHeatmapLoading && 'animate-pulse')}>
              {weeks.flat().map((date, i) =>
                date === null ? (
                  <div key={`pad-${i}`} className="h-3 w-3" />
                ) : (
                  <button
                    key={date}
                    type="button"
                    data-testid={`heat-${date}`}
                    title={`${date}: ${formatDuration(secondsByDate.get(date) ?? 0, _)}`}
                    onClick={() => onSelectDate(date)}
                    className={cn(
                      'h-3 w-3 rounded-[2.5px] transition-transform hover:scale-125 focus:outline-hidden',
                      isHeatmapLoading ? 'bg-stone-200/50 dark:bg-stone-800/80' : levelClass(secondsByDate.get(date) ?? 0, max),
                      selectedDate === date && 'ring-2 ring-emerald-500 ring-offset-1 dark:ring-offset-stone-900',
                    )}
                  />
                ),
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-stone-400 select-none dark:text-stone-500">
            <span>{_('stats.heatmapLess')}</span>
            <div className="flex items-center gap-[3px]">
              <div className="h-2.5 w-2.5 rounded-[2px] bg-stone-100 dark:bg-stone-850" />
              <div className="h-2.5 w-2.5 rounded-[2px] bg-emerald-200 dark:bg-emerald-950/70" />
              <div className="h-2.5 w-2.5 rounded-[2px] bg-emerald-400 dark:bg-emerald-700" />
              <div className="h-2.5 w-2.5 rounded-[2px] bg-emerald-500 dark:bg-emerald-500" />
              <div className="h-2.5 w-2.5 rounded-[2px] bg-emerald-700 dark:bg-emerald-400" />
            </div>
            <span>{_('stats.heatmapMore')}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
