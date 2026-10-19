import { useMemo } from 'react'

import type { ReadingRange } from '@bookdock/shared'

import { useBookReadingRecords } from '@/api/hooks/reading-records'
import { useBook } from '@/features/library/hooks'
import { formatDuration } from '@/lib/format-duration'
import { useTranslation } from '@/hooks/useTranslation'
import { formatRelativeTime } from '@/features/reader/components/format-relative-time'

interface BookStatsMicroCardProps {
  bookVersionId: string
  range?: ReadingRange
}

export default function BookStatsMicroCard({ bookVersionId, range }: BookStatsMicroCardProps) {
  const _ = useTranslation()
  const recordsQuery = useBookReadingRecords(bookVersionId, { range })
  const bookQuery = useBook(bookVersionId)

  const book = bookQuery.data?.data
  const records = recordsQuery.data?.data

  const bounded = Boolean(range?.from || range?.to)
  const totalSeconds = records?.totalSeconds ?? 0
  const progressPercent = useMemo(() => {
    if (book?.progress == null) return 0
    return Math.min(100, Math.max(0, Math.round(book.progress)))
  }, [book?.progress])

  const distinctDays = useMemo(() => {
    if (!records?.records) return 0
    return records.records.filter((r) => r.durationSeconds >= 60).length
  }, [records?.records])

  const firstDate = useMemo(() => {
    if (!records?.records || records.records.length === 0) return null
    const sorted = [...records.records].sort((a, b) => a.date.localeCompare(b.date))
    return sorted[0]?.date ?? null
  }, [records?.records])

  const durationText = totalSeconds > 0
    ? formatDuration(totalSeconds, _)
    : _('stats.durationSeconds', { s: 0 })

  const isPending = recordsQuery.isPending || bookQuery.isPending

  if (isPending) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 animate-pulse">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-stone-500/10" />
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-2xs dark:border-stone-800 dark:bg-stone-900/60">
      <div className={`grid grid-cols-2 divide-y divide-stone-100 sm:divide-x sm:divide-y-0 dark:divide-stone-800/80 ${bounded ? 'sm:grid-cols-2' : 'sm:grid-cols-4'}`}>
        {/* Duration and qualifying days follow the archive scope. */}
        <div className="flex flex-col justify-center p-3.5 sm:p-4">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
            {_('archive.bookDuration', { defaultValue: '本书用时' })}
          </span>
          <span className="mt-1 text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
            {durationText}
          </span>
        </div>

        {/* Current reading position is lifetime context. */}
        {!bounded && <div className="flex flex-col justify-center p-3.5 sm:p-4">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
            {_('archive.readingProgress', { defaultValue: '阅读进度' })}
          </span>
          <span className="mt-1 text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
            {progressPercent}%
          </span>
        </div>}

        {/* Reading days in scope. */}
        <div className="flex flex-col justify-center p-3.5 sm:p-4">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
            {_('archive.readingDays', { defaultValue: '阅读天数' })}
          </span>
          <span className="mt-1 text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
            {distinctDays} <span className="text-xs font-normal text-stone-400">{_('archive.daysUnit', { defaultValue: '天' })}</span>
          </span>
        </div>

        {/* Last-read position is lifetime context. */}
        {!bounded && <div className="flex flex-col justify-center p-3.5 sm:p-4">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
            {_('archive.recentActivity', { defaultValue: '最近阅读' })}
          </span>
          <span className="mt-1 text-base sm:text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-50 truncate">
            {book?.lastReadAt ? formatRelativeTime(_, book.lastReadAt) : '-'}
          </span>
          {firstDate && (
            <span className="text-[11px] text-stone-400 dark:text-stone-500 truncate">
              {_('archive.firstReadAt', { date: firstDate, defaultValue: `初读于 ${firstDate}` })}
            </span>
          )}
        </div>}
      </div>
    </div>
  )
}
