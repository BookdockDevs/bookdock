import { useEffect, useMemo, useRef } from 'react'

import { useReadingDaily } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { formatMonthShort } from '@/lib/format-date'
import { cn } from '@/lib/utils'

import { heatmapWeeks } from '../date-utils'

interface YearHeatmapProps {
  year?: number
  selectedDate: string | null
  onSelectDate: (date: string) => void
}

// 书香暖珀色系 (温润人文感，告别冷峻绿格子)
function levelClass(seconds: number, max: number): string {
  if (seconds <= 0 || max <= 0) return 'bg-stone-100 hover:bg-stone-200 dark:bg-stone-800/60 dark:hover:bg-stone-700'
  const ratio = seconds / max
  if (ratio <= 0.25) return 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/70 dark:hover:bg-amber-900'
  if (ratio <= 0.5) return 'bg-amber-300 hover:bg-amber-400 dark:bg-amber-700/80 dark:hover:bg-amber-600'
  if (ratio <= 0.75) return 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-500 dark:hover:bg-amber-400'
  return 'bg-amber-700 hover:bg-amber-800 dark:bg-amber-400 dark:hover:bg-amber-300'
}

export default function YearHeatmap({ year = new Date().getFullYear(), selectedDate, onSelectDate }: YearHeatmapProps) {
  const _ = useTranslation()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dailyQuery = useReadingDaily(`${year}-01-01`, `${year}-12-31`)
  const { data } = dailyQuery
  const secondsByDate = useMemo(() => new Map((data?.data ?? []).map((i) => [i.date, i.durationSeconds])), [data])
  const max = Math.max(0, ...secondsByDate.values())
  const weeks = useMemo(() => heatmapWeeks(year), [year])

  // Extract month label positions
  const monthLabels = useMemo(() => {
    const labels: { weekIndex: number; name: string }[] = []
    let prevMonth = -1
    weeks.forEach((week, wIdx) => {
      const firstValid = week.find((d) => d !== null)
      if (firstValid) {
        const m = Number(firstValid.slice(5, 7)) - 1
        if (m !== prevMonth) {
          const d = new Date(year, m, 1)
          const name = formatMonthShort(d)
          labels.push({ weekIndex: wIdx, name })
          prevMonth = m
        }
      }
    })
    return labels
  }, [weeks, year])

  // 小屏或窄容器下产生较大幅度横向溢出时，当前年份默认定位到最右侧（最新月份与记录）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const isCurrentYear = year === new Date().getFullYear()
    if (isCurrentYear && el.scrollWidth - el.clientWidth > 24) {
      el.scrollLeft = el.scrollWidth - el.clientWidth
    }
  }, [year])

  if (dailyQuery.isError) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5 dark:border-stone-800 dark:bg-stone-900">
        <QueryErrorState isRetrying={dailyQuery.isFetching} onRetry={dailyQuery.refetch} />
      </section>
    )
  }

  const isHeatmapLoading = dailyQuery.isLoading && !data

  return (
    <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          <span>{_('stats.yearHeatmap')}</span>
          <span className="font-normal tabular-nums text-stone-400 dark:text-stone-500"> · {year}</span>
        </h2>
        {selectedDate && (
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {selectedDate} · <span className="font-medium text-stone-700 dark:text-stone-200">{formatDuration(secondsByDate.get(selectedDate) ?? 0, _)}</span>
          </span>
        )}
      </div>

      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <div className="flex flex-col w-fit mx-auto">
          {/* Month labels: 左侧 sticky 占位，与下方网格起点严格 1:1 对齐 */}
          <div className="mb-1.5 flex gap-1.5 h-4 text-[10px] text-stone-400 select-none dark:text-stone-500">
            <div className="sticky left-0 z-10 w-4 shrink-0 bg-white dark:bg-stone-900" />
            <div className="relative flex-1">
              {monthLabels.map((m) => (
                <span
                  key={m.weekIndex}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${(m.weekIndex / weeks.length) * 100}%` }}
                >
                  {m.name}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-1.5">
            {/* Weekday labels: sticky 钉在左侧，发生横向滚动时坐标也永不消失 */}
            <div className="sticky left-0 z-10 grid w-4 shrink-0 grid-rows-7 gap-[2px] py-[0.5px] text-right text-[9px] text-stone-400 select-none bg-white dark:bg-stone-900">
              <span className="h-[10px] leading-[10px]">{_('stats.weekdayMon')}</span>
              <span className="h-[10px]" />
              <span className="h-[10px] leading-[10px]">{_('stats.weekdayWed')}</span>
              <span className="h-[10px]" />
              <span className="h-[10px] leading-[10px]">{_('stats.weekdayFri')}</span>
              <span className="h-[10px]" />
              <span className="h-[10px]" />
            </div>

            {/* Heatmap cells: 10px 标准紧凑格子 + 2px 间隙，53 周总宽 ~634px，正常电脑桌面窗口从容通览 1~12 月整年无需滚动 */}
            <div className={cn('grid grid-flow-col grid-rows-7 gap-[2px]', isHeatmapLoading && 'animate-pulse')}>
              {weeks.flat().map((date, i) =>
                date === null ? (
                  <div key={`pad-${i}`} className="h-[10px] w-[10px]" />
                ) : (
                  <button
                    key={date}
                    type="button"
                    data-testid={`heat-${date}`}
                    title={`${date}: ${formatDuration(secondsByDate.get(date) ?? 0, _)}`}
                    onClick={() => onSelectDate(selectedDate === date ? '' : date)}
                    className={cn(
                      'relative h-[10px] w-[10px] rounded-[2px] transition-transform hover:scale-125 hover:z-20 focus:outline-hidden cursor-pointer',
                      isHeatmapLoading ? 'bg-stone-200/50 dark:bg-stone-800/80' : levelClass(secondsByDate.get(date) ?? 0, max),
                      selectedDate === date && 'z-10 ring-2 ring-amber-500 ring-offset-1 dark:ring-offset-stone-900',
                    )}
                  />
                ),
              )}
            </div>
          </div>

          {/* Legend: 紧贴热力图块右下角，精准对齐第 53 周最后一列 */}
          <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-stone-400 select-none dark:text-stone-500">
            <span>{_('stats.heatmapLess')}</span>
            <div className="flex items-center gap-[2px]">
              <div className="h-2.5 w-2.5 rounded-[2px] bg-stone-100 dark:bg-stone-800/60" />
              <div className="h-2.5 w-2.5 rounded-[2px] bg-amber-100 dark:bg-amber-950/70" />
              <div className="h-2.5 w-2.5 rounded-[2px] bg-amber-300 dark:bg-amber-700/80" />
              <div className="h-2.5 w-2.5 rounded-[2px] bg-amber-500 dark:bg-amber-500" />
              <div className="h-2.5 w-2.5 rounded-[2px] bg-amber-700 dark:bg-amber-400" />
            </div>
            <span>{_('stats.heatmapMore')}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
