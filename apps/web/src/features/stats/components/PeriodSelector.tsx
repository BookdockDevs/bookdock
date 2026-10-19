import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation as useI18nTranslation } from 'react-i18next'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { computeDropdownPosition, type SmartPosition } from '@/lib/position'
import { cn } from '@/lib/utils'

import {
  eachDay,
  formatDisplayPeriodLabel,
  isFutureOrCurrentPeriod,
  periodRange,
} from '../date-utils'
import type { DayRange, StatsPeriod } from '../date-utils'

interface PeriodSelectorProps {
  period: StatsPeriod
  range: DayRange
  onPeriodChange: (period: StatsPeriod) => void
  onShift: (delta: number) => void
  onSelectAnchor?: (d: Date) => void
  firstRecordedDate?: string
  className?: string
}

const PERIODS: StatsPeriod[] = ['week', 'month', 'year', 'all']

const arrowClass =
  'flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer'

interface CalendarDay {
  date: Date
  dayNumber: number
  isCurrentMonth: boolean
  isToday: boolean
}

interface CalendarWeek {
  from: Date
  to: Date
  isFuture: boolean
  isSelected: boolean
  days: CalendarDay[]
}

const WEEKDAYS_ZH = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const MONTH_NAMES_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function getCalendarWeeksForMonth(
  year: number,
  month: number,
  selectedRange: DayRange,
): CalendarWeek[] {
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const firstOfMonth = new Date(year, month, 1)
  const lastOfMonth = new Date(year, month + 1, 0)

  let cursor = periodRange('week', firstOfMonth).from
  const weeks: CalendarWeek[] = []

  while (cursor <= lastOfMonth) {
    const week = periodRange('week', cursor)
    const days: CalendarDay[] = eachDay(week.from, week.to).map((d) => ({
      date: d,
      dayNumber: d.getDate(),
      isCurrentMonth: d.getMonth() === month,
      isToday: d.getTime() === todayStart.getTime(),
    }))

    const isFuture = week.from.getTime() > todayStart.getTime()
    const isSelected =
      selectedRange.from.getFullYear() === week.from.getFullYear() &&
      selectedRange.from.getMonth() === week.from.getMonth() &&
      selectedRange.from.getDate() === week.from.getDate()

    weeks.push({
      from: week.from,
      to: week.to,
      isFuture,
      isSelected,
      days,
    })

    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)
  }

  return weeks
}


export default function PeriodSelector({
  period,
  range,
  onPeriodChange,
  onShift,
  onSelectAnchor,
  firstRecordedDate,
  className,
}: PeriodSelectorProps) {
  const _ = useTranslation()
  const { i18n } = useI18nTranslation()
  const isZh = !i18n.language || i18n.language.startsWith('zh')

  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<SmartPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const selectedWeekRef = useRef<HTMLButtonElement | null>(null)

  const [pickerYear, setPickerYear] = useState(() => range.from.getFullYear())
  const [pickerMonth, setPickerMonth] = useState(() => range.from.getMonth())

  const isNextDisabled = isFutureOrCurrentPeriod(period, range)

  const displayLabel = useMemo(
    () => formatDisplayPeriodLabel(period, range, { lang: i18n.language, firstRecordedDate }),
    [period, range, i18n.language, firstRecordedDate],
  )

  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth()

  const { minYear, minMonth } = useMemo(() => {
    if (firstRecordedDate) {
      const y = parseInt(firstRecordedDate.slice(0, 4), 10)
      const m = parseInt(firstRecordedDate.slice(5, 7), 10) - 1
      if (!Number.isNaN(y)) {
        return {
          minYear: Math.min(y, currentYear),
          minMonth: Number.isNaN(m) ? 0 : Math.max(0, Math.min(11, m)),
        }
      }
    }
    return {
      minYear: Math.min(range.from.getFullYear(), currentYear - 3),
      minMonth: 0,
    }
  }, [firstRecordedDate, currentYear, range.from])

  const isPrevMonthDisabled =
    pickerYear < minYear || (pickerYear === minYear && pickerMonth <= minMonth)

  const isNextMonthDisabled =
    pickerYear > currentYear || (pickerYear === currentYear && pickerMonth >= currentMonth)

  const goToPrevMonth = () => {
    if (isPrevMonthDisabled) return
    if (pickerMonth === 0) {
      setPickerYear((y) => y - 1)
      setPickerMonth(11)
    } else {
      setPickerMonth((m) => m - 1)
    }
  }

  const goToNextMonth = () => {
    if (isNextMonthDisabled) return
    if (pickerMonth === 11) {
      setPickerYear((y) => y + 1)
      setPickerMonth(0)
    } else {
      setPickerMonth((m) => m + 1)
    }
  }

  const popoverWidth = period === 'week' ? 240 : period === 'month' ? 190 : 120
  const popoverHeight = period === 'week' ? 260 : period === 'month' ? 180 : 160

  const togglePicker = () => {
    if (period === 'all') return
    if (isOpen) {
      setIsOpen(false)
      return
    }
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPosition(
      computeDropdownPosition(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        popoverWidth,
        popoverHeight,
        'start',
      ),
    )
    setPickerYear(Math.min(range.from.getFullYear(), currentYear))
    setPickerMonth(range.from.getMonth())
    setIsOpen(true)
  }

  // Scroll to selected week when menu opens
  useEffect(() => {
    if (isOpen && selectedWeekRef.current) {
      selectedWeekRef.current.scrollIntoView?.({ block: 'nearest' })
    }
  }, [isOpen])

  const handleSelect = (targetDate: Date) => {
    setIsOpen(false)
    if (onSelectAnchor) {
      onSelectAnchor(targetDate)
    } else {
      if (period === 'year') {
        onShift(targetDate.getFullYear() - range.from.getFullYear())
      } else if (period === 'month') {
        onShift((targetDate.getFullYear() - range.from.getFullYear()) * 12 + (targetDate.getMonth() - range.from.getMonth()))
      } else if (period === 'week') {
        onShift(Math.round((targetDate.getTime() - range.from.getTime()) / (7 * 86400000)))
      }
    }
  }

  // Calendar weeks list for selected month
  const calendarWeeks = useMemo(() => {
    if (period !== 'week') return []
    return getCalendarWeeksForMonth(pickerYear, pickerMonth, range)
  }, [period, pickerYear, pickerMonth, range])

  // Years list (descending from current year)
  const yearsList = useMemo(() => {
    if (period !== 'year') return []
    const list = []
    for (let y = currentYear; y >= minYear; y--) {
      list.push(y)
    }
    return list
  }, [period, currentYear, minYear])

  return (
    <div className={cn('flex flex-wrap items-center gap-2 sm:gap-3', className)}>
      {/* 1. 日期前后翻页与周期标签 */}
      {period === 'all' ? (
        <div className="flex items-center px-1">
          <span className="text-xs font-semibold tabular-nums text-stone-700 sm:text-sm dark:text-stone-200">
            {displayLabel}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            aria-label={_('stats.prevPeriod')}
            onClick={() => onShift(-1)}
            className={arrowClass}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>

          <button
            ref={triggerRef}
            type="button"
            aria-label={_('stats.selectPeriod')}
            onClick={togglePicker}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums text-stone-700 transition-colors hover:bg-stone-200/60 sm:text-sm dark:text-stone-200 dark:hover:bg-stone-800/60 cursor-pointer"
          >
            <span>{displayLabel}</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn('text-stone-400 transition-transform duration-150', isOpen && 'rotate-180')}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <button
            type="button"
            aria-label={_('stats.nextPeriod')}
            disabled={isNextDisabled}
            onClick={() => onShift(1)}
            className={arrowClass}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      )}

      {/* Floating Picker Popover */}
      {isOpen && (
        <SmartMenu
          innerRef={menuRef}
          triggerRef={triggerRef}
          position={position}
          onClose={() => setIsOpen(false)}
          width={popoverWidth}
          className="rounded-xl border border-stone-200 bg-white p-2 shadow-lg dark:border-stone-800 dark:bg-stone-900"
        >
          {/* Week Picker */}
          {period === 'week' && (
            <div className="flex flex-col gap-1.5">
              <span className="sr-only">{_('stats.selectDate')}</span>
              {/* 月份切换头部 */}
              <div className="flex items-center justify-between px-1 pb-1 border-b border-stone-100 dark:border-stone-800">
                <button
                  type="button"
                  disabled={isPrevMonthDisabled}
                  onClick={goToPrevMonth}
                  className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-20 dark:text-stone-400 dark:hover:bg-stone-800 cursor-pointer disabled:cursor-not-allowed"
                  aria-label={_('stats.prevPeriod')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <span className="text-xs font-semibold tabular-nums text-stone-800 dark:text-stone-200">
                  {isZh ? `${pickerYear}年 ${pickerMonth + 1}月` : `${MONTH_NAMES_EN[pickerMonth]} ${pickerYear}`}
                </span>
                <button
                  type="button"
                  disabled={isNextMonthDisabled}
                  onClick={goToNextMonth}
                  className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-20 dark:text-stone-400 dark:hover:bg-stone-800 cursor-pointer disabled:cursor-not-allowed"
                  aria-label={_('stats.nextPeriod')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>

              {/* 星期表头 */}
              <div className="grid grid-cols-7 px-1 text-center text-[11px] font-medium text-stone-400 dark:text-stone-500">
                {(isZh ? WEEKDAYS_ZH : WEEKDAYS_EN).map((d, i) => (
                  <span key={i}>{d}</span>
                ))}
              </div>

              {/* 周列表（整周作为一个可交互行） */}
              <div className="space-y-0.5">
                {calendarWeeks.map((week) => {
                  const label = formatDisplayPeriodLabel('week', week, { lang: i18n.language })
                  return (
                    <button
                      key={week.from.toISOString()}
                      ref={week.isSelected ? selectedWeekRef : undefined}
                      type="button"
                      disabled={week.isFuture}
                      onClick={() => handleSelect(week.from)}
                      aria-label={label}
                      className={cn(
                        'group flex w-full items-center rounded-lg px-1 py-0.5 text-xs transition-colors',
                        week.isSelected
                          ? 'bg-blue-600 font-semibold text-white shadow-2xs cursor-pointer'
                          : week.isFuture
                            ? 'cursor-not-allowed text-stone-300 dark:text-stone-600'
                            : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800 cursor-pointer',
                      )}
                    >
                      <span className="sr-only">{label}</span>
                      <div className="grid w-full grid-cols-7 text-center tabular-nums">
                        {week.days.map((day) => (
                          <span
                            key={day.date.toISOString()}
                            className={cn(
                              'relative flex h-6 items-center justify-center text-xs',
                              !day.isCurrentMonth && (
                                week.isSelected
                                  ? 'text-blue-200/70'
                                  : 'text-stone-300 dark:text-stone-600'
                              ),
                              day.isToday && !week.isSelected && 'font-bold text-blue-600 dark:text-blue-400',
                            )}
                          >
                            {day.dayNumber}
                            {day.isToday && (
                              <span
                                className={cn(
                                  'absolute bottom-0.5 h-1 w-1 rounded-full',
                                  week.isSelected ? 'bg-white' : 'bg-blue-600 dark:bg-blue-400',
                                )}
                              />
                            )}
                          </span>
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Month Picker */}
          {period === 'month' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1 border-b border-stone-100 pb-1.5 dark:border-stone-800">
                <button
                  type="button"
                  disabled={pickerYear <= minYear}
                  onClick={() => setPickerYear((y) => y - 1)}
                  className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-20 dark:text-stone-400 dark:hover:bg-stone-800 cursor-pointer disabled:cursor-not-allowed"
                  aria-label={_('stats.prevPeriod')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <span className="text-xs font-semibold tabular-nums text-stone-800 dark:text-stone-200">
                  {isZh ? `${pickerYear}年` : `${pickerYear}`}
                </span>
                <button
                  type="button"
                  disabled={pickerYear >= currentYear}
                  onClick={() => setPickerYear((y) => y + 1)}
                  className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 disabled:opacity-20 dark:text-stone-400 dark:hover:bg-stone-800 cursor-pointer disabled:cursor-not-allowed"
                  aria-label={_('stats.nextPeriod')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1 pt-0.5">
                {Array.from({ length: 12 }, (_, m) => {
                  const today = new Date()
                  const isFuture =
                    pickerYear > today.getFullYear() ||
                    (pickerYear === today.getFullYear() && m > today.getMonth())
                  const isSelected =
                    range.from.getFullYear() === pickerYear && range.from.getMonth() === m
                  const label = isZh ? `${m + 1}月` : `${m + 1}`

                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={isFuture}
                      onClick={() => handleSelect(new Date(pickerYear, m, 1))}
                      className={cn(
                        'rounded-lg py-1.5 text-xs font-medium transition-colors text-center cursor-pointer',
                        isSelected
                          ? 'bg-blue-600 font-semibold text-white shadow-2xs'
                          : isFuture
                            ? 'cursor-not-allowed text-stone-300 dark:text-stone-600'
                            : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Year Picker (紧凑精炼，宽度 120px) */}
          {period === 'year' && (
            <div className="flex flex-col gap-1">
              <div className="px-1.5 py-1 text-[11px] font-semibold text-stone-400 dark:text-stone-500">
                {_('stats.selectYear')}
              </div>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {yearsList.map((y) => {
                  const isSelected = range.from.getFullYear() === y
                  const label = isZh ? `${y}年` : `${y}`
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => handleSelect(new Date(y, 0, 1))}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                        isSelected
                          ? 'bg-blue-50 font-semibold text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                          : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                      )}
                    >
                      <span className="tabular-nums">{label}</span>
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 dark:text-blue-400 shrink-0">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </SmartMenu>
      )}

      {/* 2. 周期切换器（位于右侧，更靠近设置按钮） */}
      <div className="flex rounded-lg bg-stone-200/60 p-0.5 dark:bg-stone-800/80">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setIsOpen(false)
              onPeriodChange(p)
            }}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-all cursor-pointer',
              period === p
                ? 'bg-white text-stone-900 shadow-2xs dark:bg-stone-900 dark:text-stone-100'
                : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100',
            )}
          >
            {p === 'all' ? _('readingData.all') : _(`stats.${p}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
