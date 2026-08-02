import { localDateString, useReadingByBook } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

import StatsBookCover from './StatsBookCover'
import { formatPeriodLabel } from '../date-utils'
import type { DayRange, StatsPeriod } from '../date-utils'

interface BookTimeListProps {
  date: string | null
  period: StatsPeriod
  range: DayRange
}

export default function BookTimeList({ date, period, range }: BookTimeListProps) {
  const _ = useTranslation()
  const from = date ?? localDateString(range.from)
  const to = date ?? localDateString(range.to)
  const { data } = useReadingByBook(from, to)
  const items = data?.data ?? []
  const scopeLabel = date ?? formatPeriodLabel(period, range)

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <h2 className="mb-4 text-sm font-medium">
        <span>{_('stats.bookRanking')}</span>
        <span className="tabular-nums text-stone-500 dark:text-stone-400"> · {scopeLabel}</span>
      </h2>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-400 dark:text-stone-500">{_('stats.emptyBooks')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.bookId} className="flex items-center gap-3">
              <StatsBookCover item={item} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{item.title}</span>
                  <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-normal text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                    {_(`library.readStatus${item.readStatus[0].toUpperCase()}${item.readStatus.slice(1)}`)}
                  </span>
                </p>
                <p className="truncate text-xs text-stone-500 dark:text-stone-400">{item.author}</p>
                {item.progress > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1 w-24 overflow-hidden rounded-full bg-stone-200/80 dark:bg-stone-700">
                      <div
                        className="h-full rounded-full bg-stone-700 dark:bg-stone-400"
                        style={{ width: `${Math.min(100, item.progress)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-stone-400">{Math.round(item.progress)}%</span>
                  </div>
                )}
              </div>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="text-sm tabular-nums text-stone-600 dark:text-stone-300">
                  {formatDuration(item.durationSeconds, _)}
                </span>
                <span className="text-[10px] tabular-nums text-stone-400 dark:text-stone-500">
                  {_('stats.bookDays', { n: item.days })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
