import { useMemo, useState } from 'react'

import { useQuery } from '@tanstack/react-query'

import type { BookDetailRes, ReadingProgressRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { localDateString, useBookReadingRecords } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

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

function formatWordCount(n: number, _: (key: string, options?: Record<string, string | number>) => string): string {
  if (n >= 10000) {
    const formatted = (n / 10000).toFixed(1).replace(/\.0$/, '')
    const localized = _('stats.wordsWan', { n: formatted })
    return localized === 'stats.wordsWan' ? `${formatted}万字` : localized
  }
  const rounded = Math.round(n)
  const localized = _('stats.words', { n: rounded })
  return localized === 'stats.words' ? `${rounded}字` : localized
}

function TimerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function ProgressTrendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  )
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function FlagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  )
}

function ChartBarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function formatDurationParts(seconds: number, _: (key: string, options?: Record<string, string | number>) => string) {
  const total = Math.max(0, Math.floor(seconds))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (d > 0) return { value: `${d}`, unit: `${_('stats.days')}${h > 0 ? ` ${h}h` : ''}` }
  if (h > 0) return { value: `${h}`, unit: `小时${m > 0 ? ` ${m}分` : ''}` }
  if (m > 0) return { value: `${m}`, unit: '分钟' }
  return { value: `${total}`, unit: '秒' }
}

/**
 * Reading data sidebar (09-reading-data.md §5 v2): stat cards, words &
 * estimates, a 30-day mini trend, and the mixed detail feed with retroactive
 * entries. readFraction stays intervals-derived — editing sessions does not
 * move it (noted in the edit UI).
 */
export default function StatsPanel({ bookId }: StatsPanelProps) {
  const _ = useTranslation()
  const recordsQuery = useBookReadingRecords(bookId)
  const { data } = recordsQuery
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

  const trendReadingDays = useMemo(() => trend.filter((d) => d.seconds > 0), [trend])
  const dailyAvgSeconds = useMemo(() => {
    if (trendReadingDays.length === 0) return 0
    const sum = trendReadingDays.reduce((acc, d) => acc + d.seconds, 0)
    return Math.round(sum / trendReadingDays.length)
  }, [trendReadingDays])
  const [hoveredDay, setHoveredDay] = useState<{ date: string; seconds: number } | null>(null)

  if (recordsQuery.isError || bookQuery.isError || progressQuery.isError) {
    return (
      <QueryErrorState
        className="text-[var(--bd-read-sub)]"
        isRetrying={recordsQuery.isFetching || bookQuery.isFetching || progressQuery.isFetching}
        onRetry={() => Promise.all([recordsQuery.refetch(), bookQuery.refetch(), progressQuery.refetch()])}
      />
    )
  }

  if (!detail || !summary) return null

  if (records.length === 0) {
    return (
      <div className="space-y-6 px-1 pt-3 pb-6">
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-500/10 text-[var(--bd-read-sub)]">
            <ChartBarIcon className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-[var(--bd-read-text)]">
            {_('reader.statsEmptyTitle')}
          </p>
          <p className="mt-1.5 max-w-[220px] text-xs leading-relaxed text-[var(--bd-read-sub)]">
            {_('reader.statsEmptyDesc')}
          </p>
        </div>
        <ReadingDetailList bookId={bookId} />
      </div>
    )
  }

  const durationParts = formatDurationParts(summary.totalSeconds, _)
  const trendMax = Math.max(0, ...trend.map((d) => d.seconds))
  const progressPct = Math.round((readFraction ?? 0) * 100)

  return (
    <div className="space-y-4 px-1 pt-3 pb-6">
      {/* 2x2 指标卡片 */}
      <div className="grid grid-cols-2 gap-2">
        {/* 总时长 */}
        <section className="rounded-xl border border-black/5 bg-stone-500/5 p-3 dark:border-white/5 dark:bg-stone-500/10 transition-colors">
          <div className="flex items-center gap-1.5 text-xs text-[var(--bd-read-sub)]">
            <TimerIcon className="h-3.5 w-3.5 shrink-0 text-[var(--bd-read-sub)]" />
            <span className="truncate">{_('reader.statsTotalTime')}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums text-[var(--bd-read-text)]">
              {durationParts.value}
            </span>
            <span className="text-xs font-medium text-[var(--bd-read-sub)]">
              {durationParts.unit}
            </span>
          </div>
        </section>

        {/* 已读进度 */}
        <section className="rounded-xl border border-black/5 bg-stone-500/5 p-3 dark:border-white/5 dark:bg-stone-500/10 transition-colors">
          <div className="flex items-center gap-1.5 text-xs text-[var(--bd-read-sub)]">
            <ProgressTrendIcon className="h-3.5 w-3.5 shrink-0 text-[var(--bd-read-sub)]" />
            <span className="truncate">{_('reader.statsProgress')}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-0.5">
            <span className="text-xl font-bold tabular-nums text-[var(--bd-read-text)]">
              {progressPct}
            </span>
            <span className="text-xs font-medium text-[var(--bd-read-sub)]">%</span>
          </div>
        </section>

        {/* 阅读天数 */}
        <section className="rounded-xl border border-black/5 bg-stone-500/5 p-3 dark:border-white/5 dark:bg-stone-500/10 transition-colors">
          <div className="flex items-center gap-1.5 text-xs text-[var(--bd-read-sub)]">
            <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-[var(--bd-read-sub)]" />
            <span className="truncate">{_('reader.statsReadingDays')}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums text-[var(--bd-read-text)]">
              {summary.days}
            </span>
            <span className="text-xs font-medium text-[var(--bd-read-sub)]">
              {_('stats.days')}
            </span>
          </div>
        </section>

        {/* 开始日期 */}
        <section className="rounded-xl border border-black/5 bg-stone-500/5 p-3 dark:border-white/5 dark:bg-stone-500/10 transition-colors">
          <div className="flex items-center gap-1.5 text-xs text-[var(--bd-read-sub)]">
            <FlagIcon className="h-3.5 w-3.5 shrink-0 text-[var(--bd-read-sub)]" />
            <span className="truncate">{_('reader.statsStartDate')}</span>
          </div>
          <div className="mt-2">
            <span className="text-sm font-semibold tabular-nums text-[var(--bd-read-text)] truncate block">
              {summary.startDate ?? '-'}
            </span>
          </div>
        </section>
      </div>

      {/* 进度与字数卡片 */}
      <section className="space-y-3 rounded-xl border border-black/5 bg-stone-500/5 p-3.5 dark:border-white/5 dark:bg-stone-500/10">
        {/* 顶部进度条 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--bd-read-text)]">
              {_('reader.statsProgress')}
            </span>
            <span className="font-semibold tabular-nums text-[var(--bd-read-primary)]">
              {progressPct}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-stone-500/15">
            <div
              className="h-full rounded-full bg-[var(--bd-read-primary)] transition-all duration-300"
              style={{
                width: `${Math.min(100, Math.max(progressPct, progressPct > 0 ? 2 : 0))}%`,
              }}
            />
          </div>
        </div>

        {/* 字数与剩余时间 */}
        <div className="space-y-2 border-t border-black/5 pt-2.5 dark:border-white/5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-[var(--bd-read-sub)]">{_('reader.statsWordsRead')}</span>
            <span className="tabular-nums font-medium text-[var(--bd-read-text)]">
              {wordsRead != null ? formatWordCount(wordsRead, _) : '-'}
              {totalWords != null && (
                <span className="ml-1 text-[11px] text-[var(--bd-read-sub)] font-normal">
                  / {_('reader.statsWordsTotal', { n: formatWordCount(totalWords, _) })}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-[var(--bd-read-sub)]">{_('reader.statsRemaining')}</span>
            <span className="tabular-nums font-medium text-[var(--bd-read-text)]">
              {remainingSeconds != null ? formatDuration(remainingSeconds, _) : '-'}
            </span>
          </div>
          {etaDays != null && (
            <p className="text-right text-[11px] text-[var(--bd-read-sub)]">
              {_('reader.statsEtaDays', { days: etaDays })}
            </p>
          )}
        </div>
      </section>

      {/* 近 30 天趋势图 */}
      <section className="rounded-xl border border-black/5 bg-stone-500/5 p-3.5 dark:border-white/5 dark:bg-stone-500/10">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-medium text-[var(--bd-read-text)]">
            {_('reader.statsTrend30')}
          </div>
          <div className="text-[11px] tabular-nums text-[var(--bd-read-sub)]">
            {hoveredDay ? (
              <span className="font-semibold text-[var(--bd-read-primary)]">
                {hoveredDay.date.slice(5)} · {formatDuration(hoveredDay.seconds, _)}
              </span>
            ) : (
              <span>
                {_('reader.statsDailyAvg', { time: formatDuration(dailyAvgSeconds, _) })}
              </span>
            )}
          </div>
        </div>

        <div className="flex h-18 items-end gap-[3px]">
          {trend.map((d) => {
            const hasData = d.seconds > 0
            const heightPct = hasData && trendMax > 0
              ? Math.max(12, (d.seconds / trendMax) * 100)
              : 8
            const isHovered = hoveredDay?.date === d.date
            return (
              <div
                key={d.date}
                role="img"
                aria-label={`${d.date} ${formatDuration(d.seconds, _)}`}
                onMouseEnter={() => setHoveredDay(d)}
                onMouseLeave={() => setHoveredDay(null)}
                className="group relative flex h-full min-w-0 flex-1 cursor-pointer items-end py-0.5"
                title={`${d.date} ${formatDuration(d.seconds, _)}`}
              >
                <div
                  className={cn(
                    'w-full rounded-sm transition-all duration-150',
                    hasData
                      ? isHovered
                        ? 'bg-[var(--bd-read-primary)] brightness-115 scale-y-105'
                        : 'bg-[var(--bd-read-primary)]/80 hover:bg-[var(--bd-read-primary)]'
                      : 'bg-stone-500/15 hover:bg-stone-500/30',
                  )}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
            )
          })}
        </div>

        <div className="mt-1.5 flex justify-between text-[10px] text-[var(--bd-read-sub)] select-none">
          <span>{_('reader.stats30DaysAgo')}</span>
          <span>{_('reader.statsToday')}</span>
        </div>
      </section>

      <ReadingDetailList bookId={bookId} />
    </div>
  )
}
