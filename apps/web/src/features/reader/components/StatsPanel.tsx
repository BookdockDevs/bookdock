import { useMemo } from 'react'

import { useQuery } from '@tanstack/react-query'

import type { BookDetailRes, ReadingProgressRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { localDateString, useBookReadingRecords } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

import { readingRateOf } from '../lib/progress-model'
import { summarizeBookRecords } from '../stats/book-stats'

import ReadingDetailList from './ReadingDetailList'

interface StatsPanelProps {
  bookId: string
}

const TREND_DAYS = 30
/** Reading days averaged for the finish estimate, and the minimum needed to show it */
const ETA_WINDOW_DAYS = 14
const ETA_MIN_READING_DAYS = 3

function formatWordCount(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万字` : `${Math.round(n)}字`
}

/**
 * Reading data sidebar (09-reading-data.md §5 v2): stat cards, words &
 * estimates, a 30-day mini trend, and the mixed detail feed with retroactive
 * entries. readFraction stays intervals-derived — editing sessions does not
 * move it (noted in the edit UI).
 */
export default function StatsPanel({ bookId }: StatsPanelProps) {
  const _ = useTranslation()
  const { data } = useBookReadingRecords(bookId)
  const detail = data?.data
  const records = useMemo(() => detail?.records ?? [], [detail])
  const summary = useMemo(
    () => (detail ? summarizeBookRecords(records, detail.totalSeconds) : null),
    [detail, records],
  )

  // Same query keys/fns as Reader so the existing cache entries are reused
  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => apiGet<{ data: BookDetailRes }>(`/books/${bookId}`),
  })
  const progressQuery = useQuery({
    queryKey: ['progress', bookId],
    queryFn: () => apiGet<{ data: ReadingProgressRes | null }>(`/progress/${bookId}`),
  })
  const totalWords = bookQuery.data?.data.meta?.wordCount
  const readFraction = progressQuery.data?.data?.readFraction
  const wordsRead = totalWords != null && readFraction != null
    ? Math.round(readFraction * totalWords)
    : null

  // Whole-book remaining time at the measured reading speed (fallback: fixed
  // 800 chars/min); shown here rather than the reader header, where book-wide
  // estimates read as absurd for multi-million-char books
  const rate = useMemo(() => readingRateOf(progressQuery.data?.data?.rateSamples), [progressQuery.data])
  const fraction = progressQuery.data?.data?.fraction ?? null
  const remainingSeconds = useMemo(() => {
    if (fraction == null) return null
    if (rate != null && rate > 0) return Math.max(0, (1 - fraction) / rate / 1000)
    if (totalWords != null && totalWords > 0) return Math.max(0, ((1 - fraction) * totalWords) / 800 * 60)
    return null
  }, [fraction, rate, totalWords])

  // Finish estimate: remaining time ÷ average of the last ETA_WINDOW_DAYS
  // reading days; hidden until enough reading history exists
  const etaDays = useMemo(() => {
    if (remainingSeconds == null || records.length < ETA_MIN_READING_DAYS) return null
    const recent = [...records].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, ETA_WINDOW_DAYS)
    const avg = recent.reduce((sum, r) => sum + r.durationSeconds, 0) / recent.length
    if (avg <= 0) return null
    return Math.max(1, Math.ceil(remainingSeconds / avg))
  }, [remainingSeconds, records])

  const trend = useMemo(() => {
    const byDate = new Map(records.map((r) => [r.date, r.durationSeconds]))
    const today = new Date()
    const days: { date: string; seconds: number }[] = []
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const date = localDateString(d)
      days.push({ date, seconds: byDate.get(date) ?? 0 })
    }
    return days
  }, [records])

  if (!detail || !summary) return null

  if (records.length === 0) {
    return (
      <div className="space-y-6 px-1">
        <p className="py-12 text-center text-sm text-[var(--bd-read-sub)]">
          {_('reader.statsEmpty')}
        </p>
        <ReadingDetailList bookId={bookId} />
      </div>
    )
  }

  const cards: { label: string; value: string }[] = [
    { label: _('reader.statsTotalTime'), value: formatDuration(summary.totalSeconds, _) },
    { label: _('reader.statsProgress'), value: readFraction != null ? `${Math.round(readFraction * 100)}%` : '-' },
    { label: _('reader.statsReadingDays'), value: `${summary.days} ${_('stats.days')}` },
    { label: _('reader.statsStartDate'), value: summary.startDate ?? '-' },
  ]

  const trendMax = Math.max(0, ...trend.map((d) => d.seconds))

  return (
    <div className="space-y-6 px-1">
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => (
          <section key={c.label} className="rounded-lg border border-[var(--bd-read-accent)] p-3">
            <p className="text-xs text-[var(--bd-read-sub)]">{c.label}</p>
            <p className="mt-1 truncate whitespace-nowrap text-base font-semibold tabular-nums">
              {c.value.replace(/\s+/g, '')}
            </p>
          </section>
        ))}
      </div>

      <section className="space-y-1.5 rounded-lg border border-[var(--bd-read-accent)] p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-[var(--bd-read-sub)]">{_('reader.statsWordsRead')}</span>
          <span className="text-sm tabular-nums">
            {wordsRead != null ? formatWordCount(wordsRead) : '-'}
            {totalWords != null && (
              <span className="ml-1 text-xs text-[var(--bd-read-sub)]">
                / {_('reader.statsWordsTotal', { n: formatWordCount(totalWords) })}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-[var(--bd-read-sub)]">{_('reader.statsRemaining')}</span>
          <span className="text-sm tabular-nums">
            {remainingSeconds != null ? formatDuration(remainingSeconds, _) : '-'}
          </span>
        </div>
        {etaDays != null && (
          <p className="text-right text-xs text-[var(--bd-read-sub)]">{_('reader.statsEtaDays', { days: etaDays })}</p>
        )}
      </section>

      <div>
        <p className="mb-2 text-xs text-[var(--bd-read-sub)]">{_('reader.statsTrend30')}</p>
        <div className="flex h-16 items-end gap-[3px]">
          {trend.map((d) => (
            <div
              key={d.date}
              title={`${d.date} ${formatDuration(d.seconds, _)}`}
              className="min-w-0 flex-1 rounded-[2px] bg-[var(--bd-read-sub)]"
              style={{
                height: d.seconds > 0 && trendMax > 0 ? `${Math.max(10, (d.seconds / trendMax) * 100)}%` : '4px',
                opacity: d.seconds > 0 ? 0.9 : 0.2,
              }}
            />
          ))}
        </div>
      </div>

      <ReadingDetailList bookId={bookId} />
    </div>
  )
}
