import { Link } from '@tanstack/react-router'

import type { ArchiveRecordType, ReadingRange } from '@bookdock/shared'

import { BookmarkOutlineIcon, BulbIcon, ChatBubbleIcon, HighlighterIcon } from '@/features/reader/components/annotation-icons'
import Stats from '@/features/stats/Stats'
import { DeltaDisplay } from '@/features/stats/components/SummaryCards'
import { periodDelta, periodRange, shiftPeriod, type DayRange, type DeltaInfo, type StatsPeriod } from '@/features/stats/date-utils'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import type { ArchiveSearch } from '@/routes/archive'

import { localDateString } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'

import { resolveArchiveScope } from '../archive-scope'
import { useArchiveOverview, usePreviousArchiveOverview } from '../hooks'

interface ArchiveOverviewDashboardProps {
  query?: ReadingRange
  baseSearch: ArchiveSearch
  onSelectType?: (type: ArchiveRecordType) => void
  onBack?: () => void
  showBack?: boolean
  period?: StatsPeriod
  range?: DayRange
  selectedDate?: string | null
  selectedTag?: string | null
  onSelectTag?: (tag: string) => void
  selectedReadStatus?: string | null
  onSelectReadStatus?: (status: string) => void
  onPeriodChange?: (period: StatsPeriod) => void
  onShift?: (delta: number) => void
  onDrillMonth?: (d: Date) => void
  onSelectDate?: (date: string) => void
  hideControls?: boolean
}

export default function ArchiveOverviewDashboard({
  query: externalQuery,
  baseSearch,
  onSelectType,
  onBack,
  showBack = false,
  period,
  range,
  selectedDate,
  selectedTag,
  onSelectTag,
  selectedReadStatus,
  onSelectReadStatus,
  onPeriodChange,
  onShift,
  onDrillMonth,
  onSelectDate,
  hideControls = false,
}: ArchiveOverviewDashboardProps) {
  const _ = useTranslation()
  const resolved = resolveArchiveScope({
    period,
    anchor: range ? localDateString(range.from) : undefined,
    date: selectedDate ?? undefined,
  })
  const query = externalQuery ?? resolved.query
  const activeRange = range ?? resolved.range
  const isAll = !query.from && !query.to
  const isScoped = !isAll && period !== undefined && period !== 'all' && !selectedDate
  const prevRange = isScoped ? periodRange(period, shiftPeriod(period, activeRange.from, -1)) : null
  const prevScope = prevRange ? resolveArchiveScope({ period, anchor: localDateString(prevRange.from), timezone: query.timezone }) : null
  const overview = useArchiveOverview(query)
  const prevOverview = usePreviousArchiveOverview(prevScope?.query, isScoped)
  const counts = overview.data?.data.counts
  const prevCounts = prevOverview.data?.data.counts

  function calcNoteDelta(current: number | undefined, previous: number | undefined, unit: string): DeltaInfo | undefined {
    if (!isScoped || current === undefined || previous === undefined || !period) return undefined
    return periodDelta(current, previous, (v) => `${v} ${unit}`, _, period)
  }

  const noteCards: Array<{
    type: ArchiveRecordType
    label: string
    value: number | undefined
    delta?: DeltaInfo
    icon: React.ReactNode
    iconBgClass: string
  }> = [
    {
      type: 'highlight',
      label: _('archive.highlights'),
      value: counts?.highlights,
      delta: calcNoteDelta(counts?.highlights, prevCounts?.highlights, _('archive.notesUnit') || '条'),
      icon: <HighlighterIcon size={16} />,
      iconBgClass: 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',
    },
    {
      type: 'bookmark',
      label: _('archive.bookmarks'),
      value: counts?.bookmarks,
      delta: calcNoteDelta(counts?.bookmarks, prevCounts?.bookmarks, '个'),
      icon: <BookmarkOutlineIcon size={16} />,
      iconBgClass: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',
    },
    {
      type: 'idea',
      label: _('archive.ideas'),
      value: counts?.ideas,
      delta: calcNoteDelta(counts?.ideas, prevCounts?.ideas, _('archive.notesUnit') || '条'),
      icon: <BulbIcon size={16} />,
      iconBgClass: 'bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400',
    },
    {
      type: 'review',
      label: _('archive.reviews'),
      value: counts?.reviews,
      delta: calcNoteDelta(counts?.reviews, prevCounts?.reviews, '篇'),
      icon: <ChatBubbleIcon size={16} strokeWidth={1.8} />,
      iconBgClass: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400',
    },
  ]

  const isOverviewLoading = overview.isLoading && !overview.data

  const notesSection = overview.isError && !counts ? (
    <QueryErrorState isRetrying={overview.isFetching} onRetry={() => void overview.refetch()} />
  ) : (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      {noteCards.map((card) => (
        <Link
          key={card.type}
          to="/archive"
          search={{ ...baseSearch, type: card.type }}
          replace
          // Keep the recorded archive exit source across this in-feature move.
          state={(previous) => ({ ...previous })}
          onClick={() => onSelectType?.(card.type)}
          role="button"
          className="group flex flex-col rounded-xl bg-stone-50/90 ring-1 ring-stone-900/5 p-3.5 transition-colors hover:bg-stone-100/90 sm:p-4 dark:bg-stone-800/40 dark:hover:bg-stone-800/60 dark:ring-white/5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
              {card.label}
            </span>
            <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg transition-transform group-hover:scale-105', card.iconBgClass)}>
              {card.icon}
            </div>
          </div>
          <div className="mt-2.5">
            {isOverviewLoading ? (
              <div className="space-y-1.5">
                <div className="h-6 w-12 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800 motion-reduce:animate-none" />
                {isScoped && (
                  <div className="h-4.5 w-14 animate-pulse rounded bg-stone-200/50 dark:bg-stone-800/80 motion-reduce:animate-none" />
                )}
              </div>
            ) : (
              <>
                <p className="text-xl font-bold tabular-nums tracking-tight text-stone-900 sm:text-2xl dark:text-stone-50">
                  {card.value ?? '—'}
                </p>
                <DeltaDisplay delta={card.delta} isScoped={isScoped} />
              </>
            )}
          </div>
        </Link>
      ))}
    </div>
  )

  return (
    <div className="flex w-full flex-col gap-6">
      {/* 仅在移动端需要返回时展示轻量返回条 */}
      {showBack && onBack && (
        <div className="flex items-center gap-3 border-b border-stone-200/70 pb-3 lg:hidden dark:border-stone-800/70">
          <button
            type="button"
            onClick={onBack}
            aria-label={_('archive.back')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {_('archive.statistics')}
          </span>
        </div>
      )}

      <Stats
        hideHeader
        query={query}
        notesSection={notesSection}
        period={period}
        range={range}
        selectedDate={selectedDate}
        selectedTag={selectedTag}
        onSelectTag={onSelectTag}
        selectedReadStatus={selectedReadStatus}
        onSelectReadStatus={onSelectReadStatus}
        onPeriodChange={onPeriodChange}
        onShift={onShift}
        onDrillMonth={onDrillMonth}
        onSelectDate={onSelectDate}
        hideControls={hideControls}
      />
    </div>
  )
}
