import { useState } from 'react'

import { localDateString, useReadingDaily } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { isAccessRevocationError } from '@/lib/error-message'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

import { fillDailyDays, formatPeriodLabel, isFutureOrCurrentPeriod } from '../date-utils'
import type { DayRange, StatsPeriod } from '../date-utils'

interface PeriodBarChartProps {
  period: StatsPeriod
  range: DayRange
  selectedDate: string | null
  onPeriodChange: (period: StatsPeriod) => void
  onShift: (delta: number) => void
  onDrillMonth: (d: Date) => void
  onSelectDate: (date: string) => void
  hideControls?: boolean
}

interface Bar {
  key: string
  testId: string
  tick: string
  tooltipTitle: string
  seconds: number
  selected: boolean
  onClick: () => void
}

const PERIODS: StatsPeriod[] = ['week', 'month', 'year', 'all']

const arrowClass =
  'flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300'

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

/** 格式化为直观易读的阅读时长：如 “4 小时 51 分钟”、“37 分钟” */
function formatTrendDuration(seconds: number): string {
  if (seconds <= 0) return ''
  const totalMinutes = Math.max(1, Math.round(seconds / 60))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0) {
    return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  }
  return `${m} 分钟`
}

/** 格式化悬浮卡片的日期显示，如 “2026年10月16日” */
function formatTooltipDate(bar: Bar, period: StatsPeriod, range: DayRange): string {
  if (period === 'all') return `${bar.key}年`
  if (period === 'year') return `${range.from.getFullYear()}年${bar.tick}月`
  const parts = bar.key.split('-')
  if (parts.length === 3) {
    return `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`
  }
  return bar.tooltipTitle
}

/** 计算月周期的 Y 轴刻度，对齐参考 App（如 5时、2时 30分） */
function computeYScale(maxSeconds: number): {
  ceilSeconds: number
  midSeconds: number
  topLabel: string
  midLabel: string
} {
  if (maxSeconds <= 0) {
    return {
      ceilSeconds: 3600,
      midSeconds: 1800,
      topLabel: '1时',
      midLabel: '30分',
    }
  }

  let ceilSeconds: number
  if (maxSeconds <= 1800) {
    ceilSeconds = 1800
  } else if (maxSeconds <= 3600) {
    ceilSeconds = 3600
  } else {
    const hours = Math.ceil(maxSeconds / 3600)
    ceilSeconds = hours * 3600
  }

  const midSeconds = Math.round(ceilSeconds / 2)
  return {
    ceilSeconds,
    midSeconds,
    topLabel: formatTrendDuration(ceilSeconds),
    midLabel: formatTrendDuration(midSeconds),
  }
}

export default function PeriodBarChart({
  period,
  range,
  selectedDate,
  onPeriodChange,
  onShift,
  onDrillMonth,
  onSelectDate,
  hideControls = false,
}: PeriodBarChartProps) {
  const _ = useTranslation()
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const dailyQuery = useReadingDaily(
    period === 'all' ? undefined : localDateString(range.from),
    period === 'all' ? undefined : localDateString(range.to),
  )
  const { data } = dailyQuery
  const items = data?.data ?? []

  let bars: Bar[]
  if (period === 'all') {
    const years = new Map<string, number>()
    for (const item of items) {
      const year = item.date.slice(0, 4)
      years.set(year, (years.get(year) ?? 0) + item.durationSeconds)
    }
    bars = [...years]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, seconds]) => ({
        key: year,
        testId: `bar-year-${year}`,
        tick: year,
        tooltipTitle: `${year}年`,
        seconds,
        selected: false,
        onClick: () => onDrillMonth(new Date(Number(year), 0, 1)),
      }))
  } else if (period === 'year') {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i,
      seconds: 0,
    }))
    for (const item of items) {
      const month = Number(item.date.slice(5, 7)) - 1
      if (month >= 0 && month < 12) months[month].seconds += item.durationSeconds
    }
    bars = months.map((m) => ({
      key: `month-${m.month}`,
      testId: `bar-month-${range.from.getFullYear()}-${String(m.month + 1).padStart(2, '0')}`,
      tick: `${m.month + 1}`,
      tooltipTitle: `${m.month + 1}月`,
      seconds: m.seconds,
      selected: false,
      onClick: () => onDrillMonth(new Date(range.from.getFullYear(), m.month, 1)),
    }))
  } else {
    bars = fillDailyDays(items, range.from, range.to).map((d) => {
      const date = new Date(`${d.date}T00:00:00`)
      let tick = ''
      if (period === 'week') {
        tick = WEEKDAY_NAMES[date.getDay()]
      } else {
        const dayNum = date.getDate()
        const lastDay = range.to.getDate()
        const isTickVisible = dayNum === 1 || dayNum % 5 === 1 || dayNum === lastDay || selectedDate === d.date
        tick = isTickVisible ? String(dayNum) : ''
      }
      return {
        key: d.date,
        testId: `bar-${d.date}`,
        tick,
        tooltipTitle: period === 'week' ? `${date.getMonth() + 1}月${date.getDate()}日 (周${WEEKDAY_NAMES[date.getDay()]})` : `${date.getMonth() + 1}月${date.getDate()}日`,
        seconds: d.durationSeconds,
        selected: selectedDate === d.date,
        onClick: () => onSelectDate(selectedDate === d.date ? '' : d.date),
      }
    })
  }

  const max = Math.max(0, ...bars.map((b) => b.seconds))
  const yScale = computeYScale(max)
  const showValueAbove = period !== 'month'

  // 周期见解文案：100% 对齐成熟参考 App 文案规范
  let insightText: string | null = null
  const activeItems = items.filter((i) => i.durationSeconds > 0)
  if (activeItems.length > 0) {
    if (period === 'all') {
      const activeYears = bars.filter((b) => b.seconds > 0)
      if (activeYears.length > 0) {
        const peakYear = activeYears.reduce((a, b) => (b.seconds > a.seconds ? b : a))
        insightText = `累计有 ${activeYears.length} 年在阅读，阅读高峰在 ${peakYear.key} 年，当年读了 ${formatTrendDuration(peakYear.seconds)}。`
      }
    } else if (period === 'year') {
      const activeMonths = bars.filter((b) => b.seconds > 0)
      if (activeMonths.length > 0) {
        const peakMonth = activeMonths.reduce((a, b) => (b.seconds > a.seconds ? b : a))
        insightText = `今年有 ${activeItems.length} 天在阅读，阅读高峰在 ${peakMonth.tick} 月，当月读了 ${formatTrendDuration(peakMonth.seconds)}。`
      }
    } else {
      const peak = activeItems.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a))
      const m = Number(peak.date.slice(5, 7))
      const d = Number(peak.date.slice(8, 10))
      const periodName = period === 'week' ? '本周' : '本月'
      insightText = `${periodName}有 ${activeItems.length} 天在阅读，阅读高峰在 ${m} 月 ${d} 日，当日读了 ${formatTrendDuration(peak.durationSeconds)}。`
    }
  }

  if (dailyQuery.isError && (!data || isAccessRevocationError(dailyQuery.error))) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
        <QueryErrorState isRetrying={dailyQuery.isFetching} onRetry={dailyQuery.refetch} />
      </section>
    )
  }

  const isChartLoading = dailyQuery.isLoading && !data

  return (
    <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-6 dark:border-stone-800 dark:bg-stone-900" aria-busy={isChartLoading}>
      {dailyQuery.isError && data && !isAccessRevocationError(dailyQuery.error) && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-amber-200/80 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-700 dark:border-amber-800/80 dark:bg-amber-500/20 dark:text-amber-300">
          <span>{_('stats.revalidateFailed') || '数据刷新失败，正在显示缓存数据'}</span>
          <button
            type="button"
            onClick={() => dailyQuery.refetch()}
            disabled={dailyQuery.isFetching}
            className="font-medium underline hover:no-underline cursor-pointer"
          >
            {_('common.retry') || '重试'}
          </button>
        </div>
      )}
      {!hideControls ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onPeriodChange(p)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs transition-all',
                  period === p
                    ? 'bg-white font-medium text-stone-900 shadow-xs dark:bg-stone-950 dark:text-stone-50'
                    : 'text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100',
                )}
              >
                {p === 'all' ? _('readingData.all') : _(`stats.${p}`)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button type="button" aria-label={_('stats.prevPeriod')} disabled={period === 'all'} onClick={() => onShift(-1)} className={arrowClass}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <span className="min-w-28 text-center text-sm font-medium tabular-nums text-stone-700 dark:text-stone-200">
              {period === 'all' ? _('readingData.all') : formatPeriodLabel(period, range)}
            </span>
            <button type="button" aria-label={_('stats.nextPeriod')} disabled={period === 'all' || isFutureOrCurrentPeriod(period, range)} onClick={() => onShift(1)} className={arrowClass}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
            {_('stats.readingTrend') || '阅读趋势'}
          </h3>
          {selectedDate && (
            <button
              type="button"
              onClick={() => onSelectDate('')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200/80 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100 dark:border-stone-800 dark:bg-stone-800/80 dark:text-stone-300 dark:hover:bg-stone-800 cursor-pointer"
            >
              <span>{selectedDate}</span>
              <span className="text-stone-400 dark:text-stone-500">✕</span>
            </button>
          )}
        </div>
      )}

      {isChartLoading ? (
        <div className="flex h-40 items-end gap-1.5 sm:h-44">
          {Array.from({ length: period === 'week' ? 7 : period === 'month' ? 30 : 12 }).map((_, i) => (
            <div key={i} className="flex h-full min-w-0 flex-1 items-end">
              <div
                className="w-full animate-pulse rounded-t-md bg-stone-200/60 dark:bg-stone-800 motion-reduce:animate-none"
                style={{
                  height: `${[35, 60, 25, 75, 45, 80, 50, 65, 40, 70, 30, 55][i % 12]}%`,
                  animationDelay: `${i * 40}ms`,
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="relative flex h-44 items-end gap-1 sm:h-48 pt-10">
          {/* Reference lines and scale labels */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-10 flex flex-col justify-between">
            {/* Top dashed line (100% of scale) */}
            <div className="relative w-full border-b border-dashed border-stone-200/90 dark:border-stone-700/80">
              {period === 'month' && (
                <span className="absolute right-0 -top-2.5 text-[10px] sm:text-[11px] font-medium tabular-nums text-stone-400 dark:text-stone-500">
                  {yScale.topLabel}
                </span>
              )}
            </div>
            {/* Mid dashed line (50% of scale) */}
            <div className="relative w-full border-b border-dashed border-stone-200/90 dark:border-stone-700/80">
              {period === 'month' && (
                <span className="absolute right-0 -top-2.5 text-[10px] sm:text-[11px] font-medium tabular-nums text-stone-400 dark:text-stone-500">
                  {yScale.midLabel}
                </span>
              )}
            </div>
            {/* Baseline (0%) */}
            <div className="w-full border-b border-stone-100 dark:border-stone-800" />
          </div>

          <div
            className={cn(
              'relative flex h-full w-full items-end gap-1',
              period === 'month' ? 'pr-12 sm:pr-14' : 'pr-0',
            )}
          >
            {bars.map((b) => {
              const isActive = (hoveredKey === b.key || b.selected) && b.seconds > 0
              const barWidthClass =
                period === 'month'
                  ? 'w-full max-w-[8px] sm:max-w-[10px] rounded-t-xs sm:rounded-t-sm'
                  : period === 'year'
                  ? 'w-full max-w-[20px] rounded-t-md'
                  : 'w-full max-w-[24px] sm:max-w-[26px] rounded-t-lg'
              const barColorClass =
                isActive
                  ? 'bg-[#5ac8fa] shadow-xs dark:bg-[#38bdf8]'
                  : 'bg-[#2f73f6] hover:bg-[#5ac8fa] dark:bg-[#4d8eff] dark:hover:bg-[#38bdf8]'

              const heightPercent =
                period === 'month'
                  ? yScale.ceilSeconds > 0
                    ? Math.min(100, (b.seconds / yScale.ceilSeconds) * 100)
                    : 0
                  : max > 0
                  ? Math.max(6, (b.seconds / max) * 78)
                  : 0

              return (
                <button
                  key={b.key}
                  type="button"
                  data-testid={b.testId}
                  aria-label={`${b.tooltipTitle}: ${formatDuration(b.seconds, _)}`}
                  onClick={b.onClick}
                  onMouseEnter={() => {
                    if (b.seconds > 0) setHoveredKey(b.key)
                  }}
                  onMouseLeave={() => {
                    setHoveredKey((k) => (k === b.key ? null : k))
                  }}
                  className={cn(
                    'group relative z-10 flex h-full min-w-0 flex-1 flex-col items-center justify-end p-0.5',
                    b.seconds > 0 ? 'cursor-pointer' : 'cursor-default',
                  )}
                >
                  {b.seconds > 0 && (
                    <div
                      className="relative flex w-full flex-col items-center justify-end"
                      style={{ height: `${heightPercent}%` }}
                    >
                      {/* Floating Tooltip Card */}
                      {isActive && (
                        <div
                          className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-30 flex flex-col items-center rounded-xl bg-white px-3 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.12)] border border-stone-100 dark:bg-stone-800 dark:border-stone-700/80 dark:shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
                        >
                          <div className="text-base font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50 whitespace-nowrap leading-tight">
                            {formatTrendDuration(b.seconds)}
                          </div>
                          <div className="mt-0.5 text-[11px] font-normal tabular-nums text-stone-400 dark:text-stone-400 whitespace-nowrap">
                            {formatTooltipDate(b, period, range)}
                          </div>
                          <div
                            className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2 w-2 rotate-45 bg-white border-r border-b border-stone-100 dark:bg-stone-800 dark:border-stone-700/80"
                          />
                        </div>
                      )}

                      {/* Regular small duration text directly above the bar */}
                      {showValueAbove && !isActive && (
                        <span className="pointer-events-none absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 text-[11px] font-normal tabular-nums text-stone-500 whitespace-nowrap dark:text-stone-400">
                          {formatTrendDuration(b.seconds)}
                        </span>
                      )}

                      {/* The bar pillar */}
                      <div
                        className={cn(barWidthClass, barColorClass, 'h-full transition-all')}
                      />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div
        className={cn(
          'mt-2.5 flex gap-1',
          period === 'month' ? 'pr-12 sm:pr-14' : 'pr-0',
        )}
      >
        {bars.map((b) => (
          <span
            key={b.key}
            className={cn(
              'min-w-0 flex-1 truncate text-center text-xs tabular-nums transition-colors',
              b.selected || hoveredKey === b.key
                ? 'font-bold text-[#2f73f6] dark:text-[#4d8eff]'
                : 'text-stone-400 dark:text-stone-500',
            )}
          >
            {b.tick}
          </span>
        ))}
      </div>
      {isChartLoading ? (
        <div className="mt-3.5 h-10 w-full animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800/50" />
      ) : insightText ? (
        <div className="mt-3 rounded-xl bg-stone-50/80 px-3.5 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-[13px] leading-relaxed text-stone-600 dark:bg-stone-800/40 dark:text-stone-300">
          {insightText}
        </div>
      ) : null}
    </section>
  )
}
