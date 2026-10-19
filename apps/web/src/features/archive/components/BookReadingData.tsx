import { useMemo, useState } from 'react'

import type { ReadingLedgerSession, ReadingRange } from '@bookdock/shared'

import { localDateString, useDeleteSession, useReadingLedger } from '@/api/hooks/reading-records'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import AddRecordDialog from '@/features/reader/components/AddRecordDialog'
import HourDistributionView from '@/features/stats/components/HourDistributionView'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

import BookReadingTrendChart from './BookReadingTrendChart'
import ReadingSessionCard from './ReadingSessionCard'
import { useBook } from '@/features/library/hooks'
import { ledgerCoverageByDate, ledgerDateInRange, ledgerEstimates, ledgerProgressBounds, ledgerScopedWords, ledgerTimeDistribution } from './reading-ledger-stats'

interface BookReadingDataProps { bookId: string; onDeleted?: () => void; range?: ReadingRange; onSelectDate?: (date: string | null) => void }

export default function BookReadingData({ bookId, range, onSelectDate }: BookReadingDataProps) {
  const _ = useTranslation()
  const ledgerQuery = useReadingLedger(bookId)
  const deleteMutation = useDeleteSession()
  const [localSelectedDate, setSelectedDate] = useState<string | null>(null)
  const selectedDate = onSelectDate ? range?.from === range?.to ? range?.from ?? null : null : localSelectedDate
  const effectiveRange = useMemo(() => (selectedDate ? { ...range, from: selectedDate, to: selectedDate } : range), [range, selectedDate])
  const bounded = Boolean(effectiveRange?.from || effectiveRange?.to)
  const [recordLimit, setRecordLimit] = useState(50)
  const [editingSession, setEditingSession] = useState<ReadingLedgerSession | null>(null)
  const [deletingSession, setDeletingSession] = useState<ReadingLedgerSession | null>(null)
  const [addRecordOpen, setAddRecordOpen] = useState(false)
  const [deletingBusy, setDeletingBusy] = useState(false)
  const scopeKey = `${bookId}:${range?.from ?? ''}:${range?.to ?? ''}:${range?.timezone ?? ''}`
  const [previousScope, setPreviousScope] = useState(scopeKey)
  if (previousScope !== scopeKey) {
    setPreviousScope(scopeKey)
    setSelectedDate(null)
    setRecordLimit(50)
    setEditingSession(null)
    setDeletingSession(null)
  }
  const ledger = ledgerQuery.data?.data
  const currentRound = ledger?.rounds.find((r) => r.id === ledger.currentRoundId) ?? ledger?.rounds.at(-1)
  const sessions = useMemo(() => ledger?.sessions ?? [], [ledger])
  const sessionDistributions = useMemo(() => new Map(sessions.map((session) => [session.id, ledgerTimeDistribution([session], effectiveRange)])), [sessions, effectiveRange])
  const includeLegacy = true
  const distribution = useMemo(() => {
    const result = {
      days: new Map<string, number>(),
      hours: Array.from({ length: 24 }, () => 0),
      hourDays: Array.from({ length: 24 }, () => new Set<string>()),
    }
    for (const dist of sessionDistributions.values()) {
      for (const [date, seconds] of dist.days) result.days.set(date, (result.days.get(date) ?? 0) + seconds)
      dist.hours.forEach((seconds, hour) => { result.hours[hour] += seconds })
      if (dist.hourDays) {
        dist.hourDays.forEach((dates, hour) => {
          dates.forEach((d) => result.hourDays[hour].add(d))
        })
      }
    }
    if (includeLegacy) for (const day of ledger?.legacyDaily ?? []) {
      if (ledgerDateInRange(day.date, effectiveRange)) result.days.set(day.date, (result.days.get(day.date) ?? 0) + day.durationSeconds)
    }
    return result
  }, [sessionDistributions, includeLegacy, ledger?.legacyDaily, effectiveRange])
  const hourBars = useMemo(() => {
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      seconds: distribution.hours[hour] ?? 0,
      days: distribution.hourDays[hour]?.size ?? (distribution.hours[hour] > 0 ? 1 : 0),
    }))
  }, [distribution.hours, distribution.hourDays])
  const dailyTrendPoints = useMemo(() => {
    const dates = [...distribution.days.entries()]
      .filter(([, seconds]) => seconds >= 60)
      .map(([date]) => date)
      .sort()

    return dates.map((date) => {
      const seconds = distribution.days.get(date) ?? 0
      const sessionsOnDate = sessions.filter((s) => s.date === date)
      const progressDelta = sessionsOnDate.reduce((sum, s) => {
        const scale = s.progressScale ?? 1
        const covDelta = s.coverage.reduce((covSum, [start, end]) => covSum + Math.abs(end - start), 0)
        return sum + covDelta * scale
      }, 0) * 100

      return {
        date,
        seconds,
        progressPercent: Number(progressDelta.toFixed(1)),
      }
    })
  }, [distribution.days, sessions])
  const totalSeconds = [...distribution.days.values()].reduce((sum, seconds) => sum + seconds, 0)
  const scopedWords = useMemo(() => ledgerScopedWords(sessions, effectiveRange), [sessions, effectiveRange])
  const coverageByDate = useMemo(() => ledgerCoverageByDate(sessions, includeLegacy ? ledger?.projectedLegacyIntervals ?? ledger?.legacyIntervals : []), [sessions, includeLegacy, ledger?.legacyIntervals, ledger?.projectedLegacyIntervals])
  const coverage = [...coverageByDate.values()].at(-1) ?? (ledger?.projectedLegacyIntervals ?? ledger?.legacyIntervals ?? []).reduce((sum, [start, end]) => sum + end - start, 0)
  const bookQuery = useBook(bookId)
  const book = bookQuery.data?.data
  const latestProgress = useMemo(() => {
    if (book?.progress != null) {
      return Number(book.progress.toFixed(2))
    }
    const lastSessionEnd = sessions
      .map((s) => ledgerProgressBounds(s).end)
      .filter((v): v is number => v !== null)
      .at(-1)
    if (lastSessionEnd != null) {
      return Number((lastSessionEnd * 100).toFixed(2))
    }
    return Number((coverage * 100).toFixed(2))
  }, [book?.progress, sessions, coverage])
  const estimates = useMemo(() => ledgerEstimates(sessions, coverage, currentRound?.wordCount), [sessions, coverage, currentRound?.wordCount])
  const readingDays = [...distribution.days.values()].filter((seconds) => seconds >= 60).length
  const averageSeconds = readingDays > 0 ? totalSeconds / readingDays : null
  const groups = useMemo(() => {
    const result = new Map<string, ReadingLedgerSession[]>()
    for (const session of [...sessions].sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt ?? 0) - (a.startedAt ?? 0))) {
      for (const [date] of sessionDistributions.get(session.id)!.days) {
        if (selectedDate && date !== selectedDate) continue
        result.set(date, [...(result.get(date) ?? []), session])
      }
    }
    if (includeLegacy) for (const day of ledger?.legacyDaily ?? []) {
      if (ledgerDateInRange(day.date, effectiveRange) && !result.has(day.date)) result.set(day.date, [])
    }
    return [...result].sort(([a], [b]) => b.localeCompare(a))
  }, [sessions, sessionDistributions, selectedDate, includeLegacy, ledger?.legacyDaily, effectiveRange])
  const totalRows = groups.reduce((sum, [, records]) => sum + Math.max(1, records.length), 0)
  let remainingRows = recordLimit
  const visibleGroups = groups.flatMap(([date, records]): Array<[string, ReadingLedgerSession[]]> => {
    if (remainingRows <= 0) return []
    const visible = records.slice(0, remainingRows)
    remainingRows -= Math.max(1, visible.length)
    return [[date, visible]]
  })
  function changeDate(date: string | null) {
    if (onSelectDate) onSelectDate(date)
    else setSelectedDate(date)
    setRecordLimit(50)
    setEditingSession(null)
    setDeletingSession(null)
  }
  const card = 'rounded-3xl border border-stone-200/80 bg-white p-5 shadow-xs dark:border-stone-800 dark:bg-stone-900'

  const totalWords = Math.round(
    scopedWords.words +
      (!bounded && includeLegacy
        ? (ledger?.legacyIntervals ?? []).reduce((sum, [start, end]) => sum + end - start, 0) * (ledger?.legacyWordCount ?? 0)
        : 0),
  )
  const totalWordsDisplay = totalWords.toLocaleString()

  const earliestDate = useMemo(() => {
    let minDate: string | null = null
    for (const session of sessions) {
      if (!minDate || session.date < minDate) minDate = session.date
    }
    for (const legacy of ledger?.legacyDaily ?? []) {
      if (!minDate || legacy.date < minDate) minDate = legacy.date
    }
    return minDate
  }, [sessions, ledger?.legacyDaily])

  const dailyCoveragePercent = useMemo(() => {
    if (!readingDays || coverage <= 0) return null
    return (coverage * 100) / readingDays
  }, [readingDays, coverage])

  const secondsPerPercent = useMemo(() => {
    if (totalSeconds <= 0 || coverage <= 0) return null
    return totalSeconds / (coverage * 100)
  }, [totalSeconds, coverage])

  const secondsPerThousandWords = useMemo(() => {
    if (totalSeconds <= 0 || totalWords <= 0) return null
    return (totalSeconds / totalWords) * 1000
  }, [totalSeconds, totalWords])

  const remainingDays = useMemo(() => {
    if (estimates.remainingSeconds === null || !averageSeconds || averageSeconds <= 0) return null
    return Math.ceil(estimates.remainingSeconds / averageSeconds)
  }, [estimates.remainingSeconds, averageSeconds])

  function formatPercent(value: number): string {
    const rounded = Number(value.toFixed(2))
    return `${rounded}%`
  }

  function formatDetailedDuration(seconds: number | null): string {
    if (seconds === null || seconds <= 0 || !Number.isFinite(seconds)) return '—'
    const total = Math.round(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) return _('stats.durationHours', { h, m })
    return _('readingData.minuteSecond', { m, s })
  }

  const ringIntervals = useMemo(() => {
    const raw: Array<[number, number]> = []
    if (includeLegacy) {
      raw.push(...(ledger?.projectedLegacyIntervals ?? ledger?.legacyIntervals ?? []))
    }
    for (const session of sessions) {
      const cov = session.projectedCoverage ?? session.coverage
      if (cov && Array.isArray(cov)) {
        raw.push(...cov)
      }
    }
    const sorted = raw
      .map(([a, b]): [number, number] => [Math.max(0, Math.min(1, Math.min(a, b))), Math.max(0, Math.min(1, Math.max(a, b)))])
      .filter(([a, b]) => b > a)
      .sort(([a], [b]) => a - b)
    const merged: Array<[number, number]> = []
    for (const [start, end] of sorted) {
      const last = merged.at(-1)
      if (last && start <= last[1]) {
        last[1] = Math.max(last[1], end)
      } else {
        merged.push([start, end])
      }
    }
    return merged
  }, [sessions, includeLegacy, ledger?.legacyIntervals, ledger?.projectedLegacyIntervals])

  const endDate = useMemo(() => {
    if (currentRound?.status !== 'finished') return null
    if (currentRound.endedAt) return localDateString(new Date(currentRound.endedAt))
    let maxDate: string | null = null
    for (const session of sessions) {
      if (!maxDate || session.date > maxDate) maxDate = session.date
    }
    return maxDate
  }, [currentRound, sessions])

  const crossDayDates = useMemo(() => {
    const dates = new Set<string>()
    for (const s of sessions) {
      if (s.startedAt && s.endedAt) {
        const startDay = localDateString(new Date(s.startedAt))
        const endDay = localDateString(new Date(s.endedAt))
        if (startDay !== endDay) {
          dates.add(startDay)
          dates.add(endDay)
        }
      }
    }
    return dates
  }, [sessions])

  const calendarItems = useMemo(() => {
    const dates = [...distribution.days.keys()].sort()
    const currentMonth = localDateString().slice(0, 7)
    const startMonth = dates[0]?.slice(0, 7) ?? currentMonth
    const endMonth = dates.at(-1)?.slice(0, 7) ?? currentMonth
    const latestMonth = endMonth > currentMonth ? endMonth : currentMonth
    const [startYear, startM] = startMonth.split('-').map(Number)
    const [endYear, endM] = latestMonth.split('-').map(Number)

    const activeMonths = new Set(dates.map((d) => d.slice(0, 7)))
    activeMonths.add(startMonth)
    activeMonths.add(endMonth)

    const items: Array<{
      key: string
      isGap?: boolean
      gapCount?: number
      month?: string
      year?: number
      monthNum?: number
      label?: string
    }> = []

    let curY = startYear
    let curM = startM
    let gapMonths = 0

    while (curY < endYear || (curY === endYear && curM <= endM)) {
      const mStr = `${curY}-${String(curM).padStart(2, '0')}`
      const hasActivity = activeMonths.has(mStr)

      if (!hasActivity) {
        gapMonths++
      } else {
        if (gapMonths > 2) {
          items.push({
            key: `gap-${mStr}`,
            isGap: true,
            gapCount: gapMonths,
          })
        } else {
          for (let g = gapMonths; g > 0; g--) {
            let backM = curM - g
            let backY = curY
            while (backM <= 0) {
              backM += 12
              backY--
            }
            const backStr = `${backY}-${String(backM).padStart(2, '0')}`
            const prevItem = items.filter((it) => !it.isGap).at(-1)
            const isFirstOrNewYear = !prevItem || prevItem.year !== backY
            items.push({
              key: backStr,
              month: backStr,
              year: backY,
              monthNum: backM,
              label: isFirstOrNewYear ? backStr : _('readingData.monthLabel', { n: backM }),
            })
          }
        }
        gapMonths = 0
        const prevItem = items.filter((it) => !it.isGap).at(-1)
        const isFirstOrNewYear = !prevItem || prevItem.year !== curY
        items.push({
          key: mStr,
          month: mStr,
          year: curY,
          monthNum: curM,
          label: isFirstOrNewYear ? mStr : _('readingData.monthLabel', { n: curM }),
        })
      }

      curM++
      if (curM > 12) {
        curM = 1
        curY++
      }
    }

    if (gapMonths > 2) {
      items.push({
        key: 'gap-end',
        isGap: true,
        gapCount: gapMonths,
      })
    }
    return items
  }, [distribution.days, _])

  if (ledgerQuery.isPending) return <div role="status" className="h-48 animate-pulse rounded-3xl bg-stone-500/10" />
  if (ledgerQuery.isError || !ledger) return <QueryErrorState isRetrying={ledgerQuery.isFetching} onRetry={() => void ledgerQuery.refetch()} />

  return (
    <div className="flex flex-col gap-5">
      {!bounded ? (
        <div className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
          <div className="grid grid-cols-1 items-center gap-6 sm:grid-cols-[auto_1fr] sm:gap-8">
            {/* Left: Circular Progress Ring with segmented intervals */}
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="relative flex h-32 w-32 items-center justify-center">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" strokeWidth="8" className="stroke-stone-100 dark:stroke-stone-800" fill="none" />
                  {ringIntervals.map(([start, end], idx) => {
                    const dash = Math.max(0, (end - start) * 263.8938)
                    const offset = -start * 263.8938
                    return (
                      <circle
                        key={`${start}-${end}-${idx}`}
                        cx="50" cy="50" r="42" strokeWidth="8"
                        strokeDasharray={`${dash} 263.8938`}
                        strokeDashoffset={offset}
                        strokeLinecap="round"
                        className="stroke-emerald-500 transition-all duration-700 ease-out dark:stroke-emerald-400"
                        fill="none"
                      />
                    )
                  })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
                    {formatPercent(latestProgress)}
                  </span>
                </div>
              </div>
              <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                {currentRound?.status === 'finished' ? _('readingData.status.finished') : _('readingData.roundOrdinal', { n: currentRound?.ordinal ?? 1 })}
              </span>
            </div>

            {/* Right: Key Stats Matrix */}
            <div className="grid grid-cols-2 gap-4 border-t border-stone-100 pt-4 sm:border-t-0 sm:border-l sm:border-stone-100 sm:pl-8 sm:pt-0 dark:border-stone-800">
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.duration')}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
                  {formatDuration(totalSeconds, _)}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.days')}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
                  {readingDays}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.words')}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
                  {totalWordsDisplay}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.startDate')}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-stone-900 dark:text-stone-50">
                  {earliestDate ? earliestDate.replace(/-/g, '.') : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Reading Analysis */}
          <div className="mt-6 border-t border-stone-100 pt-5 dark:border-stone-800">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.avgDailyDuration')}</div>
                <div className="mt-1 text-base font-bold tabular-nums text-stone-900 dark:text-stone-100">
                  {averageSeconds === null ? '—' : formatDuration(averageSeconds, _)}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.avgDailyProgress')}</div>
                <div className="mt-1 text-base font-bold tabular-nums text-stone-900 dark:text-stone-100">
                  {dailyCoveragePercent !== null ? formatPercent(dailyCoveragePercent) : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.avgPerPercent')}</div>
                <div className="mt-1 text-base font-bold tabular-nums text-stone-900 dark:text-stone-100">
                  {formatDetailedDuration(secondsPerPercent)}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.avgPerThousandWords')}</div>
                <div className="mt-1 text-base font-bold tabular-nums text-stone-900 dark:text-stone-100">
                  {formatDetailedDuration(secondsPerThousandWords)}
                </div>
              </div>
            </div>

            {/* Bottom Estimate Sentence */}
            <div className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500 dark:border-stone-800/80 dark:text-stone-400">
              {currentRound?.status === 'finished' || coverage >= 1 ? (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {_('readingData.completedHint')}
                </span>
              ) : remainingDays !== null && estimates.remainingSeconds !== null ? (
                <span>
                  {_('readingData.estimatePrefix')}
                  <strong className="mx-1 font-semibold text-blue-600 dark:text-blue-400">{remainingDays}</strong>
                  {_('readingData.estimateDaysUnit')}
                  {_('readingData.estimateTimePrefix')}
                  <strong className="mx-1 font-semibold text-blue-600 dark:text-blue-400">
                    {formatDuration(estimates.remainingSeconds, _)}
                  </strong>
                </span>
              ) : (
                <span>{_('readingData.estimateNeedMore')}</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-stone-200/80 bg-white p-5 shadow-xs dark:border-stone-800 dark:bg-stone-900">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.duration')}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                {formatDuration(totalSeconds, _)}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.days')}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                {String(readingDays)}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.words')}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                {totalWordsDisplay}
              </div>
            </div>
            <div>
              <div className="text-xs text-stone-500 dark:text-stone-400">{_('readingData.startDate')}</div>
              <div className="mt-1 text-xl font-bold tabular-nums text-stone-900 dark:text-stone-50">
                {earliestDate ? earliestDate.replace(/-/g, '.') : '—'}
              </div>
            </div>
          </div>
        </div>
      )}
    <section className={card}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          {_('readingData.calendar')}
        </h3>
        {selectedDate && (
          <button
            type="button"
            onClick={() => changeDate(null)}
            className="text-xs font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            {_('readingData.clearDate', { date: selectedDate })}
          </button>
        )}
      </div>

      {/* Horizontal Multi-Month Scrollable Track / Single-Month Adaptive Grid */}
      {(() => {
        const isSingleMonth = calendarItems.length === 1
        return (
          <>
            <div
              className={
                isSingleMonth
                  ? 'w-full'
                  : 'flex gap-6 overflow-x-auto pb-3 pt-1 scrollbar-thin'
              }
            >
              {calendarItems.map((item) => {
                if (item.isGap) {
                  return (
                    <div
                      key={item.key}
                      className="flex shrink-0 items-center justify-center px-2 text-xs text-stone-400 dark:text-stone-600"
                    >
                      <div className="flex flex-col items-center gap-1 border-x border-dashed border-stone-200 px-3 py-6 dark:border-stone-800">
                        <span className="text-[10px]">···</span>
                        <span className="text-[11px] whitespace-nowrap">
                          {_('readingData.monthGap', { n: item.gapCount ?? 0 })}
                        </span>
                        <span className="text-[10px]">···</span>
                      </div>
                    </div>
                  )
                }

                const { month: itemMonth, label, year, monthNum } = item
                const daysInMonth = new Date(year!, monthNum!, 0).getDate()
                const firstWeekday = (new Date(`${itemMonth}-01T12:00:00`).getDay() + 6) % 7

                return (
                  <div
                    key={itemMonth}
                    className={isSingleMonth ? 'w-full' : 'min-w-[216px] shrink-0'}
                  >
                    <div className="mb-2.5 flex items-center justify-between">
                      <span
                        className={
                          isSingleMonth
                            ? 'text-sm font-semibold text-stone-700 dark:text-stone-200'
                            : 'text-xs font-semibold text-stone-700 dark:text-stone-200'
                        }
                      >
                        {label}
                      </span>
                    </div>
                    <div
                      className={`mb-2 grid grid-cols-7 text-center text-stone-400 dark:text-stone-500 ${
                        isSingleMonth
                          ? 'text-xs font-medium'
                          : 'gap-1 text-[10px]'
                      }`}
                    >
                      <span>一</span>
                      <span>二</span>
                      <span>三</span>
                      <span>四</span>
                      <span>五</span>
                      <span>六</span>
                      <span>日</span>
                    </div>
                    <div
                      className={`grid grid-cols-7 ${
                        isSingleMonth ? 'gap-y-2 sm:gap-y-3' : 'gap-1'
                      }`}
                    >
                      {Array.from({ length: firstWeekday }, (_blank, i) => (
                        <span
                          key={`blank-${i}`}
                          className={
                            isSingleMonth
                              ? 'mx-auto flex h-9 w-9 sm:h-10 sm:w-10'
                              : 'h-7 w-7'
                          }
                        />
                      ))}
                      {Array.from({ length: daysInMonth }, (_day, i) => {
                        const dayNum = i + 1
                        const date = `${itemMonth}-${String(dayNum).padStart(2, '0')}`
                        const seconds = distribution.days.get(date) ?? 0
                        const isReadingDay = seconds >= 60
                        const isStart = date === earliestDate
                        const isEnd = Boolean(endDate && date === endDate)
                        const isCrossDay = crossDayDates.has(date)

                        let cellClass = 'text-stone-400 dark:text-stone-600 font-normal'
                        if (isStart) {
                          cellClass = 'bg-teal-500 text-white font-bold shadow-xs'
                        } else if (isEnd) {
                          cellClass = 'bg-amber-500 text-white font-bold shadow-xs'
                        } else if (isReadingDay) {
                          cellClass = 'bg-blue-600 text-white font-medium'
                        }

                        return (
                          <div
                            key={date}
                            aria-label={String(dayNum)}
                            title={
                              isStart
                                ? `${date} (开始日期) · ${formatDuration(seconds, _)}`
                                : isEnd
                                  ? `${date} (完读日期) · ${formatDuration(seconds, _)}`
                                  : isReadingDay
                                    ? `${date} · ${formatDuration(seconds, _)}`
                                    : date
                            }
                            className={`relative flex items-center justify-center rounded-lg tabular-nums cursor-default select-none transition-all ${
                              isSingleMonth
                                ? 'mx-auto h-9 w-9 text-xs sm:h-10 sm:w-10 sm:rounded-xl sm:text-sm'
                                : 'h-7 w-7 text-xs'
                            } ${cellClass}`}
                          >
                            {isStart ? 'S' : isEnd ? 'E' : dayNum}
                            {isCrossDay && !isStart && !isEnd && (
                              <span
                                className={`absolute text-amber-300 ${
                                  isSingleMonth
                                    ? '-top-0.5 -right-0.5 text-[9px] sm:text-[10px]'
                                    : '-top-0.5 -right-0.5 text-[8px]'
                                }`}
                              >
                                ✦
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="mt-5 flex flex-wrap items-center gap-6 border-t border-stone-100 pt-3 text-xs text-stone-500 dark:border-stone-800/80 dark:text-stone-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-teal-500 text-[10px] font-bold text-white">
                  S
                </span>
                {_('readingData.legendStart')}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-amber-500 text-[10px] font-bold text-white">
                  E
                </span>
                {_('readingData.legendEnd')}
              </span>
              <span className="flex items-center gap-1 text-amber-500 dark:text-amber-400">
                ✦ {_('readingData.legendCrossDay')}
              </span>
            </div>
          </>
        )
      })()}
    </section>
    <BookReadingTrendChart
      points={dailyTrendPoints}
      className={card}
    />
    <HourDistributionView
      bars={hourBars}
      prefix="本书"
      emptyText="本书暂无阅读时段记录"
      className={card}
    />
    <section className={card}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">{_('reader.detailRecords')}</h3>
        <button
          type="button"
          onClick={() => setAddRecordOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-stone-200/90 bg-white px-3 text-xs font-medium text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {_('reader.detailAdd')}
        </button>
      </div>

      {!groups.length && <p className="py-5 text-center text-sm text-stone-500">{_('readingData.noRecords')}</p>}

      <div className="flex flex-col gap-3">
        {visibleGroups.map(([date, records]) => {
          const legacySec = includeLegacy ? (ledger?.legacyDaily ?? []).find((day) => day.date === date)?.durationSeconds : undefined
          return (
            <div key={date} className="flex flex-col gap-2.5">
              {legacySec !== undefined && legacySec > 0 && (
                <div className="rounded-xl border border-dashed border-stone-200/80 px-3.5 py-2 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
                  {date} · {_('readingData.legacyDuration', { duration: formatDuration(legacySec, _) })}
                </div>
              )}
              {records.map((session) => (
                <ReadingSessionCard
                  key={session.id}
                  session={session}
                  totalWordCount={currentRound?.wordCount ?? ledger?.legacyWordCount ?? undefined}
                  onEdit={(s) => setEditingSession(s)}
                  onDelete={(s) => setDeletingSession(s)}
                  variant="default"
                />
              ))}
            </div>
          )
        })}
      </div>

      {recordLimit < totalRows && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setRecordLimit((count) => count + 50)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200/90 bg-white px-4 py-2 text-xs font-medium text-stone-600 shadow-2xs transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-100 cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
            <span>{_('reader.sessionLoadMore')}</span>
          </button>
        </div>
      )}
    </section>

    {addRecordOpen && (
      <AddRecordDialog
        bookId={bookId}
        variant="default"
        onClose={() => setAddRecordOpen(false)}
      />
    )}
    {editingSession && (
      <AddRecordDialog
        bookId={bookId}
        variant="default"
        editingSession={editingSession}
        onClose={() => setEditingSession(null)}
      />
    )}
    {deletingSession && (
      <ConfirmDialog
        title={_('settings.confirmDeleteTitle')}
        message={_('reader.sessionDeleteConfirm')}
        confirmLabel={_('reader.sessionDelete')}
        errorFallback="reader.sessionActionFailed"
        confirmDisabled={deletingBusy}
        onClose={() => { if (!deletingBusy) setDeletingSession(null) }}
        onConfirm={async () => {
          setDeletingBusy(true)
          try {
            await deleteMutation.mutateAsync(deletingSession.id)
            setDeletingSession(null)
          } finally {
            setDeletingBusy(false)
          }
        }}
      />
    )}

    </div>
  )
}
