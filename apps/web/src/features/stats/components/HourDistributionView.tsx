import { useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

export interface HourBarItem {
  hour: number
  seconds: number
  days: number
}

export interface HourDistributionViewProps {
  bars: HourBarItem[]
  title?: string
  prefix?: string
  emptyText?: string
  isLoading?: boolean
  className?: string
  errorNode?: React.ReactNode
}

const TOTAL_ROWS = 12
const X_AXIS_HOURS = [0, 4, 8, 12, 16, 20]

function getTimeOfDay(hour: number): string {
  if (hour >= 0 && hour < 6) return '凌晨'
  if (hour >= 6 && hour < 9) return '清晨'
  if (hour >= 9 && hour < 12) return '上午'
  if (hour >= 12 && hour < 14) return '中午'
  if (hour >= 14 && hour < 18) return '下午'
  return '晚上'
}

interface ScaleTick {
  label: string
  positionClass: string
}

interface ScaleConfig {
  scaleMaxSeconds: number
  ticks: ScaleTick[]
}

function getThreeSegmentScale(maxSeconds: number): ScaleConfig {
  let stepSeconds: number

  if (maxSeconds <= 0) {
    stepSeconds = 3600 // 1h -> max 3h (3h, 2h, 1h, 0h)
  } else if (maxSeconds <= 1800) {
    stepSeconds = 600 // 10m -> max 30m (30m, 20m, 10m, 0h)
  } else if (maxSeconds <= 3600) {
    stepSeconds = 1200 // 20m -> max 1h (1h, 40m, 20m, 0h)
  } else if (maxSeconds <= 10800) {
    stepSeconds = 3600 // 1h -> max 3h (3h, 2h, 1h, 0h)
  } else if (maxSeconds <= 21600) {
    stepSeconds = 7200 // 2h -> max 6h (6h, 4h, 2h, 0h)
  } else if (maxSeconds <= 43200) {
    stepSeconds = 14400 // 4h -> max 12h (12h, 8h, 4h, 0h)
  } else if (maxSeconds <= 86400) {
    stepSeconds = 28800 // 8h -> max 24h (24h, 16h, 8h, 0h)
  } else {
    const stepHours = Math.ceil(maxSeconds / (3 * 3600) / 4) * 4
    stepSeconds = stepHours * 3600
  }

  const formatTick = (sec: number) => {
    if (sec <= 0) return '0h'
    const h = sec / 3600
    if (Number.isInteger(h)) return `${h}h`
    const m = Math.round(sec / 60)
    return `${m}m`
  }

  const scaleMaxSeconds = stepSeconds * 3

  return {
    scaleMaxSeconds,
    ticks: [
      { label: formatTick(scaleMaxSeconds), positionClass: 'top-0 -translate-y-1/2' },
      { label: formatTick(stepSeconds * 2), positionClass: 'top-[33.33%] -translate-y-1/2' },
      { label: formatTick(stepSeconds), positionClass: 'top-[66.67%] -translate-y-1/2' },
      { label: '0h', positionClass: 'bottom-0 translate-y-1/2' },
    ],
  }
}

function formatHourBubbleDuration(seconds: number): string {
  if (seconds <= 0) return '0 秒'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  }
  if (m > 0) {
    return s > 0 ? `${m} 分钟 ${s} 秒` : `${m} 分钟`
  }
  return `${s} 秒`
}

export default function HourDistributionView({
  bars,
  title,
  prefix,
  emptyText,
  isLoading = false,
  className,
  errorNode,
}: HourDistributionViewProps) {
  const _ = useTranslation()
  const [selectedHour, setSelectedHour] = useState<number | null>(null)
  const [hoveredHour, setHoveredHour] = useState<number | null>(null)

  const maxSeconds = Math.max(0, ...bars.map((b) => b.seconds))
  const peak = bars.length > 0 && maxSeconds > 0
    ? bars.reduce((a, b) => (b.seconds > a.seconds ? b : a))
    : null
  const scale = getThreeSegmentScale(maxSeconds)

  const activeHour = hoveredHour ?? selectedHour
  const activeBar = activeHour !== null ? bars[activeHour] : null


  function handleChartMouseLeave() {
    setHoveredHour(null)
    setSelectedHour(null)
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-6 dark:border-stone-800 dark:bg-stone-900',
        className,
      )}
      aria-busy={isLoading}
    >
      {errorNode}

      {/* 标题 */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          {title ?? _('stats.hourDistribution')}
        </h2>
      </div>

      {/* 图表主区域：items-start 确保 Y 轴与方块矩阵严格顶部对齐，修复纵坐标错位 */}
      <div
        onMouseLeave={handleChartMouseLeave}
        className="relative mt-3 flex items-start gap-2.5 sm:mt-4"
      >
        {/* Y 轴刻度（均分三段，四个刻度：3/3, 2/3, 1/3, 0h） */}
        <div className="relative h-[142px] w-7 shrink-0 select-none text-right text-[11px] font-medium tabular-nums text-stone-400 dark:text-stone-500">
          {scale.ticks.map((tick) => (
            <span key={tick.label} className={cn('absolute right-0', tick.positionClass)}>
              {tick.label}
            </span>
          ))}
        </div>

        {/* 24 列矩阵与 X 轴容器 */}
        <div className="relative min-w-0 flex-1">
          {/* 矩阵容器：高度严格为 142px */}
          <div className="relative h-[142px] cursor-pointer">
            {/* 固定高度气泡浮层：位于方块矩阵正上方，严格水平居中跟随 */}
            {activeBar && (
              <div
                className="pointer-events-none absolute bottom-[calc(100%+6px)] z-30 flex flex-col items-center rounded-2xl border border-stone-200/90 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur-xs transition-all dark:border-stone-700/80 dark:bg-stone-900/95"
                style={{
                  left: `${((activeBar.hour + 0.5) / 24) * 100}%`,
                  transform: 'translateX(-50%)',
                }}
              >
                <span className="text-sm font-bold tracking-tight tabular-nums text-stone-900 sm:text-base dark:text-stone-100 whitespace-nowrap">
                  {formatHourBubbleDuration(activeBar.seconds)}
                </span>
                <span className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400 whitespace-nowrap">
                  {getTimeOfDay(activeBar.hour)} {activeBar.hour}:00 ~ {activeBar.hour + 1}:00
                </span>
                <span className="mt-0.5 text-[10px] text-stone-400 dark:text-stone-500 whitespace-nowrap">
                  {activeBar.days > 0 ? `总计 ${activeBar.days} 天` : activeBar.seconds > 0 ? '1 天' : '暂无阅读'}
                </span>
              </div>
            )}

            <div className="grid h-full w-full grid-cols-24 gap-[2px] sm:gap-[3px]">
              {bars.map((b) => {
                const filledBlocks = b.seconds > 0
                  ? Math.max(1, Math.min(TOTAL_ROWS, Math.round((b.seconds / scale.scaleMaxSeconds) * TOTAL_ROWS)))
                  : 0
                const isActive = activeHour === b.hour

                return (
                  <button
                    key={b.hour}
                    type="button"
                    aria-label={`${String(b.hour).padStart(2, '0')}:00: ${formatDuration(b.seconds, _)}`}
                    aria-pressed={selectedHour === b.hour}
                    onClick={() => setSelectedHour((current) => (current === b.hour ? null : b.hour))}
                    onMouseEnter={() => setHoveredHour(b.hour)}
                    className="flex h-full w-full cursor-pointer flex-col-reverse gap-[2px] rounded-[2px] focus-visible:outline-2 focus-visible:outline-stone-400 dark:focus-visible:outline-stone-500"
                  >
                    {Array.from({ length: TOTAL_ROWS }, (_, i) => {
                      const row = i + 1
                      const isFilled = row <= filledBlocks

                      let cellColor = 'bg-stone-100/90 dark:bg-stone-800/40'
                      if (isFilled) {
                        cellColor = isActive
                          ? 'bg-blue-600 shadow-2xs dark:bg-blue-400'
                          : 'bg-blue-500/85 hover:bg-blue-500 dark:bg-blue-500/70'
                      } else if (isActive) {
                        cellColor = 'bg-stone-200/70 dark:bg-stone-700/60'
                      }

                      return (
                        <span
                          key={row}
                          className={cn(
                            'h-[10px] w-full rounded-[2px] transition-colors',
                            cellColor,
                            isLoading && 'animate-pulse bg-stone-200/60 dark:bg-stone-800',
                          )}
                        />
                      )
                    })}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="relative mt-2.5 grid grid-cols-24 text-[10px] tabular-nums text-stone-400 sm:text-[11px] dark:text-stone-500">
            {X_AXIS_HOURS.map((hour) => {
              const label = String(hour)
              return (
                <span
                  key={hour}
                  className="col-span-4 select-none text-left font-medium"
                >
                  {label}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {/* 底部洞察卡片：锁定显示当前周期/书籍最常阅读时段 */}
      <div className="mt-3.5 rounded-xl bg-stone-50/80 px-3.5 py-2 text-xs leading-relaxed text-stone-600 transition-all sm:px-4 sm:py-2.5 sm:text-[13px] dark:bg-stone-800/40 dark:text-stone-300">
        {isLoading ? (
          <div className="h-4 w-48 animate-pulse rounded bg-stone-200/70 dark:bg-stone-700" />
        ) : maxSeconds === 0 ? (
          <p className="text-stone-400 dark:text-stone-500">
            {emptyText ?? _('stats.emptyHourly', { defaultValue: '所选周期内暂无阅读时段记录' })}
          </p>
        ) : peak ? (
          <p>
            <span>{prefix ? `${prefix}最常阅读时段为 ` : '最常阅读时段为 '}</span>
            <span className="font-semibold text-stone-900 dark:text-stone-100">
              {getTimeOfDay(peak.hour)} {peak.hour}:00 ～ {peak.hour + 1}:00
            </span>
            {peak.days && peak.days > 0 ? <span>，共 {peak.days} 天</span> : null}
            <span>，累计 {formatDuration(peak.seconds, _)}。</span>
          </p>
        ) : null}
      </div>
    </section>
  )
}
