import { useReadingDaily } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

import { heatmapWeeks } from '../date-utils'

interface YearHeatmapProps {
  selectedDate: string | null
  onSelectDate: (date: string) => void
}

function levelClass(seconds: number, max: number): string {
  if (seconds <= 0 || max <= 0) return 'bg-stone-200/60 dark:bg-stone-800'
  const ratio = seconds / max
  if (ratio <= 0.25) return 'bg-amber-200 dark:bg-amber-900'
  if (ratio <= 0.5) return 'bg-amber-400 dark:bg-amber-700'
  if (ratio <= 0.75) return 'bg-amber-500 dark:bg-amber-500'
  return 'bg-amber-600 dark:bg-amber-300'
}

export default function YearHeatmap({ selectedDate, onSelectDate }: YearHeatmapProps) {
  const _ = useTranslation()
  const year = new Date().getFullYear()
  const { data } = useReadingDaily(`${year}-01-01`, `${year}-12-31`)
  const secondsByDate = new Map((data?.data ?? []).map((i) => [i.date, i.durationSeconds]))
  const max = Math.max(0, ...secondsByDate.values())
  const weeks = heatmapWeeks(year)

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 text-sm font-medium">
        <span>{_('stats.yearHeatmap')}</span>
        <span className="tabular-nums text-stone-500 dark:text-stone-400"> · {year}</span>
      </h2>
      <div className="overflow-x-auto">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]">
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
                  'h-3 w-3 rounded-[3px] transition-transform hover:scale-125',
                  levelClass(secondsByDate.get(date) ?? 0, max),
                  selectedDate === date && 'ring-2 ring-amber-500 ring-offset-1 dark:ring-offset-stone-900',
                )}
              />
            ),
          )}
        </div>
      </div>
    </section>
  )
}
