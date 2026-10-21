import type { ReactNode } from 'react'

import type { ReadingRange } from '@bookdock/shared'

import { localDateString, usePreviousReadingSummary, useReadingSummary } from '@/api/hooks/reading-records'
import { resolveArchiveScope } from '@/features/archive/archive-scope'
import { useArchiveOverview, usePreviousArchiveOverview } from '@/features/archive/hooks'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { FormattedStatValue } from '@/features/profile/components/ProfileStatsSection'
import { useTranslation } from '@/hooks/useTranslation'
import { isAccessRevocationError } from '@/lib/error-message'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

import { periodDelta, periodRange, shiftPeriod, type DayRange, type DeltaInfo, type StatsPeriod } from '../date-utils'

export function DeltaDisplay({ delta, isScoped }: { delta?: DeltaInfo; isScoped?: boolean }) {
  if (delta) {
    return (
      <div className="mt-1 flex h-4.5 items-center text-[11px] leading-none text-stone-400 dark:text-stone-500">
        <span className="truncate">{delta.text}</span>
        {delta.direction === 'up' && (
          <span className="ml-0.5 shrink-0 font-bold text-rose-500 dark:text-rose-400" aria-hidden="true">
            ↑
          </span>
        )}
        {delta.direction === 'down' && (
          <span className="ml-0.5 shrink-0 font-bold text-emerald-500 dark:text-emerald-400" aria-hidden="true">
            ↓
          </span>
        )}
      </div>
    )
  }
  if (isScoped) {
    return <div className="mt-1 h-4.5" aria-hidden="true" />
  }
  return null
}

function formatWords(n: number, _: (key: string, options?: Record<string, string | number>) => string): string {
  if (n >= 10000) {
    const formatted = (n / 10000).toFixed(1).replace(/\.0$/, '')
    const localized = _('stats.wordsWan', { n: formatted })
    return localized === 'stats.wordsWan' ? `${formatted}万字` : localized
  }
  const rounded = Math.round(n)
  const localized = _('stats.words', { n: rounded })
  return localized === 'stats.words' ? `${rounded}字` : localized
}

interface CardItem {
  key: string
  label: string
  value: string
  delta?: DeltaInfo
  icon: ReactNode
  iconBgClass: string
  isLoading?: boolean
}

interface SummaryCardsProps {
  query?: ReadingRange
  period?: StatsPeriod
  range?: DayRange
  selectedDate?: string | null
  selectedReadStatus?: string | null
  onSelectReadStatus?: (status: string) => void
}

export default function SummaryCards({
  period = 'all',
  query: externalQuery,
  range,
  selectedDate,
  selectedReadStatus,
  onSelectReadStatus,
}: SummaryCardsProps) {
  const _ = useTranslation()
  const resolved = resolveArchiveScope({ period, anchor: range ? localDateString(range.from) : undefined, date: selectedDate ?? undefined })
  const query = externalQuery ?? resolved.query
  const activeRange = range ?? resolved.range
  const isAll = !query.from && !query.to
  const isScoped = !isAll && period !== 'all' && !selectedDate
  const prevRange = isScoped ? periodRange(period, shiftPeriod(period, activeRange.from, -1)) : null
  const prevScope = prevRange ? resolveArchiveScope({ period, anchor: localDateString(prevRange.from), timezone: query.timezone }) : null
  const summaryQuery = useReadingSummary(query.from, query.to, query.timezone)
  const prevSummaryQuery = usePreviousReadingSummary(prevScope?.query.from, prevScope?.query.to, prevScope?.query.timezone)
  const overviewQuery = useArchiveOverview(query)
  const prevOverviewQuery = usePreviousArchiveOverview(prevScope?.query, isScoped)
  const { data } = summaryQuery
  const s = data?.data
  const scope = s?.scope
  const prevScopeData = prevSummaryQuery.data?.data.scope
  const counts = overviewQuery.data?.data.counts
  const prevCounts = prevOverviewQuery.data?.data.counts
  const totalNotes = counts?.total ?? (counts ? counts.highlights + counts.bookmarks + counts.ideas + counts.reviews : undefined)
  const prevNotes = prevCounts?.total ?? (prevCounts ? prevCounts.highlights + prevCounts.bookmarks + prevCounts.ideas + prevCounts.reviews : undefined)
  const isArchiveLoading = overviewQuery.isLoading && !counts

  if (summaryQuery.isError && (!s || isAccessRevocationError(summaryQuery.error))) {
    return (
      <QueryErrorState
        className="col-span-full rounded-xl border border-stone-200 bg-white px-4 dark:border-stone-800 dark:bg-stone-900"
        isRetrying={summaryQuery.isFetching}
        onRetry={() => summaryQuery.refetch()}
      />
    )
  }

  const displaySeconds = isAll ? s?.totalSeconds : scope?.totalSeconds
  const displayWords = isAll ? s?.totalWordsRead : scope?.totalWordsRead
  const displayDays = isAll ? s?.totalDays : scope?.totalDays
  const displayBooks = isAll ? s?.totalBooks : scope?.totalBooks
  const finishedCount = scope?.finishedBooks
  const avgSeconds = displaySeconds !== undefined && displayDays !== undefined
    ? displayDays > 0 ? Math.round(displaySeconds / displayDays) : 0
    : undefined
  const streak = isAll ? s?.currentStreak : scope?.longestStreak

  function calcDelta(current: number | undefined, previous: number | undefined, format: (v: number) => string): DeltaInfo | undefined {
    if (!isScoped || current === undefined || previous === undefined) return undefined
    return periodDelta(current, previous, format, _, period)
  }

  const cards: CardItem[] = [
    // 1. 阅读时长
    {
      key: 'totalTime',
      label: _('stats.totalTime'),
      value: displaySeconds !== undefined ? formatDuration(displaySeconds, _) : '—',
      delta: calcDelta(displaySeconds, prevScopeData?.totalSeconds, (v) => formatDuration(v, _)),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
      iconBgClass: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400',
    },
    // 2. 平均阅读时间
    {
      key: 'avgTime',
      label: _('stats.avgReadingTime'),
      value: avgSeconds !== undefined ? formatDuration(avgSeconds, _) : '—',
      delta: calcDelta(
        avgSeconds,
        prevScopeData && prevScopeData.totalDays > 0 ? Math.round(prevScopeData.totalSeconds / prevScopeData.totalDays) : 0,
        (v) => formatDuration(v, _),
      ),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="10" x2="14" y1="2" y2="2" />
          <line x1="12" x2="12" y1="14" y2="8" />
          <circle cx="12" cy="14" r="8" />
        </svg>
      ),
      iconBgClass: 'bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400',
    },
    // 3. 阅读天数
    {
      key: 'totalDays',
      label: _('stats.totalDays'),
      value: displayDays !== undefined ? `${displayDays} ${_('stats.days')}` : '—',
      delta: calcDelta(displayDays, prevScopeData?.totalDays, (v) => `${v} ${_('stats.days')}`),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
          <line x1="16" x2="16" y1="2" y2="6" />
          <line x1="8" x2="8" y1="2" y2="6" />
          <line x1="3" x2="21" y1="10" y2="10" />
        </svg>
      ),
      iconBgClass: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',
    },
    // 4. 连续阅读
    {
      key: 'streak',
      label: _(isAll ? 'stats.streakCurrent' : 'stats.streakLongest'),
      value: streak !== undefined ? `${streak} ${_('stats.days')}` : '—',
      delta: calcDelta(streak, prevScopeData?.longestStreak, (v) => `${v} ${_('stats.days')}`),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        </svg>
      ),
      iconBgClass: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',
    },
    // 5. 阅读字数
    {
      key: 'totalWords',
      label: _('stats.totalWords'),
      value: displayWords !== undefined ? formatWords(displayWords, _) : '—',
      delta: calcDelta(displayWords, prevScopeData?.totalWordsRead, (v) => formatWords(v, _)),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="4 7 4 4 20 4 20 7" />
          <line x1="9" x2="15" y1="20" y2="20" />
          <line x1="12" x2="12" y1="4" y2="20" />
        </svg>
      ),
      iconBgClass: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400',
    },
    // 6. 读过的书
    {
      key: 'totalBooks',
      label: _('stats.totalBooks'),
      value: displayBooks !== undefined ? _('stats.booksUnit', { n: displayBooks }) : '—',
      delta: calcDelta(displayBooks, prevScopeData?.totalBooks, (v) => _('stats.booksUnit', { n: v })),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5Z" />
          <path d="M10 2v8l3-2 3 2V2" />
        </svg>
      ),
      iconBgClass: 'bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400',
    },
    // 7. 读完的书
    {
      key: 'finishedBooks',
      label: _('stats.finishedBooks'),
      value: finishedCount !== undefined ? _('stats.booksUnit', { n: finishedCount }) : '—',
      delta: calcDelta(finishedCount, prevScopeData?.finishedBooks, (v) => _('stats.booksUnit', { n: v })),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
      iconBgClass: 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',
    },
    // 8. 笔记 (汇总划线、书签、想法与书评)
    {
      key: 'totalNotes',
      label: _('stats.totalNotes'),
      value: totalNotes !== undefined ? `${totalNotes} ${_('archive.notesUnit') || '条'}` : '—',
      delta: calcDelta(totalNotes, prevNotes, (v) => `${v} ${_('archive.notesUnit') || '条'}`),
      isLoading: isArchiveLoading,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      ),
      iconBgClass: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400',
    },
  ]

  const isSummaryLoading = summaryQuery.isLoading && !s

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-4" aria-busy={isSummaryLoading}>
      {summaryQuery.isError && s && !isAccessRevocationError(summaryQuery.error) && (
        <div className="col-span-full flex items-center justify-between rounded-xl border border-amber-200/80 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-700 dark:border-amber-800/80 dark:bg-amber-500/20 dark:text-amber-300">
          <span>{_('stats.revalidateFailed') || '数据刷新失败，正在显示缓存数据'}</span>
          <button
            type="button"
            onClick={() => summaryQuery.refetch()}
            disabled={summaryQuery.isFetching}
            className="font-medium underline hover:no-underline cursor-pointer"
          >
            {_('common.retry') || '重试'}
          </button>
        </div>
      )}
      {cards.map((c) => {
        const isClickable = c.key === 'finishedBooks' && Boolean(onSelectReadStatus)
        const isSelected = c.key === 'finishedBooks' && selectedReadStatus === 'finished'

        const cardContent = (
          <>
            <div className="flex items-center justify-between">
              <span className="truncate text-xs font-medium text-stone-500 dark:text-stone-400">
                {c.label}
                {isSelected && <span className="ml-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">✓</span>}
              </span>
              <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', c.iconBgClass)}>
                {c.icon}
              </div>
            </div>

            <div className="mt-2.5">
              {isSummaryLoading || c.isLoading ? (
                <div className="space-y-1.5">
                  <div className="h-6 w-16 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800 motion-reduce:animate-none" />
                  {isScoped && (
                    <div className="h-4.5 w-14 animate-pulse rounded bg-stone-200/50 dark:bg-stone-800/80 motion-reduce:animate-none" />
                  )}
                </div>
              ) : (
                <>
                  <p className="text-xl tabular-nums text-stone-900 sm:text-2xl dark:text-stone-100">
                    <FormattedStatValue text={c.value} />
                  </p>
                  <DeltaDisplay delta={c.delta} isScoped={isScoped} />
                </>
              )}
            </div>
          </>
        )

        if (isClickable) {
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelectReadStatus?.(isSelected ? 'all' : 'finished')}
              title={isSelected ? '取消筛选已读完书籍' : '筛选已读完书籍'}
              aria-pressed={isSelected}
              className={cn(
                'flex flex-col rounded-xl p-3.5 text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 sm:p-4',
                isSelected
                  ? 'border border-rose-400/80 bg-rose-50/80 ring-2 ring-rose-400/60 shadow-xs dark:border-rose-700 dark:bg-rose-950/40 dark:ring-rose-500/50'
                  : 'bg-stone-50/90 ring-1 ring-stone-900/5 hover:bg-stone-100/90 dark:bg-stone-800/40 dark:hover:bg-stone-800/60 dark:ring-white/5',
              )}
            >
              {cardContent}
            </button>
          )
        }

        return (
          <div
            key={c.key}
            className="flex flex-col rounded-xl bg-stone-50/90 ring-1 ring-stone-900/5 p-3.5 transition-colors hover:bg-stone-100/90 sm:p-4 dark:bg-stone-800/40 dark:hover:bg-stone-800/60 dark:ring-white/5"
          >
            {cardContent}
          </div>
        )
      })}
    </div>
  )
}
