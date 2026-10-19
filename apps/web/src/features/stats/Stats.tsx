import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'

import type { ReadingRange } from '@bookdock/shared'

import { localDateString } from '@/api/hooks/reading-records'
import { resolveArchiveScope } from '@/features/archive/archive-scope'
import { useBackNavigation } from '@/hooks/useBackNavigation'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'

import HourDistribution from './components/HourDistribution'
import PeriodBarChart from './components/PeriodBarChart'
import SummaryCards from './components/SummaryCards'
import StatsSettingsButton from './components/StatsSettingsButton'
import TagDistribution from './components/TagDistribution'
import YearHeatmap from './components/YearHeatmap'
import { shiftPeriod } from './date-utils'
import type { DayRange, StatsPeriod } from './date-utils'

interface StatsProps {
  query?: ReadingRange
  hideHeader?: boolean
  notesSection?: React.ReactNode
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

export default function Stats({
  query: externalQuery,
  hideHeader = false,
  notesSection,
  period: externalPeriod,
  range: externalRange,
  selectedDate: externalSelectedDate,
  selectedTag,
  onSelectTag,
  selectedReadStatus,
  onSelectReadStatus,
  onPeriodChange: externalOnPeriodChange,
  onShift: externalOnShift,
  onDrillMonth: externalOnDrillMonth,
  onSelectDate: externalOnSelectDate,
  hideControls = false,
}: StatsProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isGuest = !user
  usePageTitle(_(hideHeader ? 'archive.title' : 'stats.title'))
  const onBack = useBackNavigation('/')

  const [internalPeriod, setInternalPeriod] = useState<StatsPeriod>('week')
  const [internalAnchor, setInternalAnchor] = useState(() => new Date())
  const [internalSelectedDate, setInternalSelectedDate] = useState<string | null>(null)

  const isControlled = externalPeriod !== undefined
  const period = isControlled ? externalPeriod : internalPeriod
  const internalScope = resolveArchiveScope({ period: internalPeriod, anchor: localDateString(internalAnchor), date: internalSelectedDate ?? undefined })
  const range = isControlled && externalRange ? externalRange : internalScope.range
  const selectedDate = isControlled ? externalSelectedDate ?? null : internalSelectedDate
  const query = externalQuery ?? (isControlled ? resolveArchiveScope({ period, anchor: localDateString(range.from), date: selectedDate ?? undefined }).query : internalScope.query)

  useEffect(() => {
    if (isGuest) void navigate({ to: '/' })
  }, [isGuest, navigate])

  if (isGuest) return null

  const handlePeriodChange = (p: StatsPeriod) => {
    if (isControlled) {
      externalOnPeriodChange?.(p)
    } else {
      setInternalPeriod(p)
      setInternalAnchor(new Date())
      setInternalSelectedDate(null)
    }
  }

  const handleShift = (delta: number) => {
    if (isControlled) {
      externalOnShift?.(delta)
    } else {
      setInternalAnchor((a) => shiftPeriod(period, a, delta))
      setInternalSelectedDate(null)
    }
  }

  const handleDrillMonth = (d: Date) => {
    if (isControlled) {
      externalOnDrillMonth?.(d)
    } else {
      setInternalAnchor(d)
      setInternalPeriod('month')
      setInternalSelectedDate(null)
    }
  }

  const handleSelectDate = (d: string) => {
    if (isControlled) {
      externalOnSelectDate?.(d)
    } else {
      setInternalSelectedDate(d || null)
    }
  }

  return (
    <div className={hideHeader ? 'flex flex-col gap-6 sm:gap-7' : 'mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:gap-7 sm:p-6'}>
      {!hideHeader && (
        <div className="flex items-center gap-3">
          <Link
            to="/"
            onClick={onBack}
            aria-label={_('stats.back')}
            title={_('stats.back')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold">{_('stats.title')}</h1>
          <StatsSettingsButton />
        </div>
      )}

      {/* 1. 核心数据看板 (行为投入与笔记沉淀一体化大面板) */}
      <section className="flex flex-col gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-2xs sm:gap-4 sm:p-5 dark:border-stone-800 dark:bg-stone-900/60">
        <SummaryCards
          period={period}
          range={range}
          selectedDate={selectedDate}
          query={query}
          selectedReadStatus={selectedReadStatus}
          onSelectReadStatus={onSelectReadStatus}
        />
        {notesSection}
      </section>

      {/* 2. 阅读趋势走势图 */}
      <PeriodBarChart
        period={period}
        range={range}
        selectedDate={selectedDate}
        onPeriodChange={handlePeriodChange}
        onShift={handleShift}
        onDrillMonth={handleDrillMonth}
        onSelectDate={handleSelectDate}
        hideControls={hideControls}
      />

      {selectedDate && !hideControls && <button type="button" onClick={() => handleSelectDate('')} className="self-start text-sm text-blue-600">{_('readingData.backPeriod')}</button>}

      {/* 3. 年度阅读足迹 (全年热力打卡：仅在“年”或“全部”周期展示，避免周/月视图割裂) */}
      {(period === 'year' || period === 'all') && !selectedDate && (
        <YearHeatmap year={range.to.getFullYear()} selectedDate={selectedDate} onSelectDate={handleSelectDate} />
      )}

      {/* 4. 深度分析区 (桌面端双栏栅格：左侧时段分布，右侧标签分布) */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <HourDistribution date={selectedDate} period={period} range={range} />
        <TagDistribution
          date={selectedDate}
          period={period}
          range={range}
          selectedTag={selectedTag}
          onSelectTag={onSelectTag}
        />
      </div>
    </div>
  )
}
