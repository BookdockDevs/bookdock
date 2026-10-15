import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import type { ArchiveRecordType } from '@bookdock/shared'

import { BookmarkOutlineIcon, BulbIcon, ChatBubbleIcon, HighlighterIcon } from '@/features/reader/components/annotation-icons'
import BookTimeList from '@/features/stats/components/BookTimeList'
import HourDistribution from '@/features/stats/components/HourDistribution'
import PeriodBarChart from '@/features/stats/components/PeriodBarChart'
import SummaryCards from '@/features/stats/components/SummaryCards'
import TagDistribution from '@/features/stats/components/TagDistribution'
import YearHeatmap from '@/features/stats/components/YearHeatmap'
import { periodRange, shiftPeriod, type StatsPeriod } from '@/features/stats/date-utils'
import { useTranslation } from '@/hooks/useTranslation'
import type { ArchiveSearch } from '@/routes/archive'

import { useArchiveOverview } from '../hooks'

interface ArchiveOverviewDashboardProps {
  baseSearch: ArchiveSearch
  onSelectType?: (type: ArchiveRecordType) => void
  onBack?: () => void
  showBack?: boolean
}

export default function ArchiveOverviewDashboard({
  baseSearch,
  onSelectType,
  onBack,
  showBack = false,
}: ArchiveOverviewDashboardProps) {
  const _ = useTranslation()
  const overview = useArchiveOverview()
  const [period, setPeriod] = useState<StatsPeriod>('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const range = periodRange(period, anchor)

  const changePeriod = (p: StatsPeriod) => {
    setPeriod(p)
    setAnchor(new Date())
    setSelectedDate(null)
  }

  const drillToMonth = (d: Date) => {
    setAnchor(d)
    setPeriod('month')
    setSelectedDate(null)
  }

  const counts = overview.data?.data.counts ?? { highlights: 0, bookmarks: 0, ideas: 0, reviews: 0 }
  const noteCards: Array<{ type: ArchiveRecordType; label: string; value: number; icon: React.ReactNode }> = [
    { type: 'highlight', label: _('archive.highlights'), value: counts.highlights, icon: <HighlighterIcon size={18} /> },
    { type: 'bookmark', label: _('archive.bookmarks'), value: counts.bookmarks, icon: <BookmarkOutlineIcon size={18} /> },
    { type: 'idea', label: _('archive.ideas'), value: counts.ideas, icon: <BulbIcon size={18} /> },
    { type: 'review', label: _('archive.reviews'), value: counts.reviews, icon: <ChatBubbleIcon size={18} strokeWidth={1.8} /> },
  ]

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

      {/* 笔记资产一体化通栏 */}
      <section
        role="region"
        aria-label={_('archive.overview')}
        className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-2xs dark:border-stone-800 dark:bg-stone-900/60"
      >
        <div className="grid grid-cols-2 divide-y divide-stone-100 sm:grid-cols-4 sm:divide-x sm:divide-y-0 dark:divide-stone-800/80">
          {noteCards.map((card) => (
            <Link
              key={card.type}
              to="/archive"
              search={{ ...baseSearch, type: card.type, page: 1 }}
              // Keep the recorded archive exit source across this in-feature move.
              state={(previous) => ({ ...previous })}
              onClick={() => onSelectType?.(card.type)}
              role="button"
              className="group flex items-center justify-between p-4 transition-colors hover:bg-stone-50/80 dark:hover:bg-stone-800/40"
            >
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {card.label}
                </span>
                <p className="text-2xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
                  {card.value}
                </p>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500 transition-colors group-hover:bg-stone-200/80 group-hover:text-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:group-hover:bg-stone-700 dark:group-hover:text-stone-200">
                {card.icon}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 习惯与时长统计 */}
      <SummaryCards />

      <PeriodBarChart
        period={period}
        range={range}
        selectedDate={selectedDate}
        onPeriodChange={changePeriod}
        onShift={(delta) => {
          setAnchor((a) => shiftPeriod(period, a, delta))
          setSelectedDate(null)
        }}
        onDrillMonth={drillToMonth}
        onSelectDate={setSelectedDate}
      />

      <YearHeatmap selectedDate={selectedDate} onSelectDate={setSelectedDate} />

      <HourDistribution date={selectedDate} period={period} range={range} />

      <BookTimeList date={selectedDate} period={period} range={range} />

      <TagDistribution date={selectedDate} period={period} range={range} />
    </div>
  )
}
