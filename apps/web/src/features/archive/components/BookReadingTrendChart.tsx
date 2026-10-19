import { useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface TrendPoint {
  date: string // YYYY-MM-DD
  seconds: number
  progressPercent: number // e.g. 27.6
}

export interface BookReadingTrendChartProps {
  points: TrendPoint[]
  className?: string
}

/**
 * 使用 Fritsch-Carlson 单调三次样条插值（Monotone Cubic Spline，类似 d3.curveMonotoneX）
 * 消除普通 Catmull-Rom 或三次样条在水平段/局部极值处的龙格现象，彻底杜绝向下凹出底部基准线（bottomY）或向上超出天花板。
 */
function getSmoothSplinePath(
  coords: Array<{ x: number; y: number }>,
  bottomY?: number,
  topY?: number,
): string {
  const n = coords.length
  if (n === 0) return ''
  if (n === 1) return `M ${coords[0].x},${coords[0].y}`
  if (n === 2) {
    return `M ${coords[0].x},${coords[0].y} L ${coords[1].x},${coords[1].y}`
  }

  // 1. 计算相邻两点间的割线斜率
  const deltas: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = coords[i + 1].x - coords[i].x
    const dy = coords[i + 1].y - coords[i].y
    deltas.push(dx !== 0 ? dy / dx : 0)
  }

  // 2. 初始化各节点切线斜率（局部极值处强制置零以消除波折）
  const m: number[] = new Array(n).fill(0)
  m[0] = deltas[0]
  m[n - 1] = deltas[n - 2]
  for (let i = 1; i < n - 1; i++) {
    const dPrev = deltas[i - 1]
    const dCur = deltas[i]
    if (dPrev * dCur <= 0) {
      m[i] = 0
    } else {
      m[i] = (dPrev + dCur) / 2
    }
  }

  // 3. Fritsch-Carlson 单调性约束修正
  for (let i = 0; i < n - 1; i++) {
    const delta = deltas[i]
    if (delta === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const alpha = m[i] / delta
    const beta = m[i + 1] / delta
    if (alpha < 0) m[i] = 0
    if (beta < 0) m[i + 1] = 0

    const dist = alpha * alpha + beta * beta
    if (dist > 9) {
      const tau = 3 / Math.sqrt(dist)
      m[i] = tau * alpha * delta
      m[i + 1] = tau * beta * delta
    }
  }

  // 4. 构造三次贝塞尔控制点并进行绝对边界防护
  let d = `M ${coords[0].x},${coords[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const p1 = coords[i]
    const p2 = coords[i + 1]
    const dx = p2.x - p1.x

    let cp1x = p1.x + dx / 3
    let cp1y = p1.y + (m[i] * dx) / 3
    let cp2x = p2.x - dx / 3
    let cp2y = p2.y - (m[i + 1] * dx) / 3

    if (bottomY !== undefined) {
      cp1y = Math.min(bottomY, cp1y)
      cp2y = Math.min(bottomY, cp2y)
    }
    if (topY !== undefined) {
      cp1y = Math.max(topY, cp1y)
      cp2y = Math.max(topY, cp2y)
    }

    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x},${p2.y}`
  }

  return d
}

function getAreaPath(coords: Array<{ x: number; y: number }>, bottomY: number, topY?: number): string {
  if (coords.length === 0) return ''
  const spline = getSmoothSplinePath(coords, bottomY, topY)
  const first = coords[0]
  const last = coords[coords.length - 1]
  return `${spline} L ${last.x},${bottomY} L ${first.x},${bottomY} Z`
}

function formatXAxisDate(dateStr: string, prevDateStr: string | null): string {
  const [y, m, d] = dateStr.split('-')
  const shortYear = y.slice(2)
  if (!prevDateStr) {
    return `${shortYear}/${m}/${d}`
  }
  const [prevY, prevM] = prevDateStr.split('-')
  if (y !== prevY || m !== prevM) {
    return `${shortYear}/${m}/${d}`
  }
  return `${m}/${d}`
}

function formatFullDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${y} 年 ${m} 月 ${d} 日`
}

function formatCardValue(seconds: number, mode: 'time' | 'progress', progressPercent: number): string {
  if (mode === 'progress') {
    return `${progressPercent}%`
  }
  const totalMin = Math.round(seconds / 60)
  if (totalMin < 60) {
    return `${totalMin} 分`
  }
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m > 0 ? `${h} 时 ${m} 分` : `${h} 时`
}

function getTimeScale(maxMinutes: number) {
  let yMax: number
  let step: number
  if (maxMinutes <= 60) {
    yMax = 60
    step = 20
  } else if (maxMinutes <= 120) {
    yMax = 120
    step = 30
  } else if (maxMinutes <= 200) {
    yMax = 200
    step = 40
  } else if (maxMinutes <= 300) {
    yMax = 300
    step = 50
  } else if (maxMinutes <= 600) {
    yMax = 600
    step = 100
  } else {
    step = Math.ceil(maxMinutes / 5 / 60) * 60
    yMax = step * 5
  }
  const ticks: number[] = []
  for (let v = 0; v <= yMax; v += step) ticks.push(v)
  return { yMax, ticks }
}

function getProgressScale(maxProgress: number) {
  let yMax: number
  let step: number
  if (maxProgress <= 10) {
    yMax = 10
    step = 2
  } else if (maxProgress <= 30) {
    yMax = 30
    step = 10
  } else if (maxProgress <= 50) {
    yMax = 50
    step = 10
  } else if (maxProgress <= 70) {
    yMax = 70
    step = 10
  } else if (maxProgress <= 100) {
    yMax = 100
    step = 20
  } else {
    step = Math.ceil(maxProgress / 5 / 10) * 10
    yMax = step * 5
  }
  const ticks: number[] = []
  for (let v = 0; v <= yMax; v += step) ticks.push(v)
  return { yMax, ticks }
}

const Y_AXIS_WIDTH = 44

export default function BookReadingTrendChart({
  points,
  className,
}: BookReadingTrendChartProps) {
  const [mode, setMode] = useState<'time' | 'progress'>('time')
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(560)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollStart, setScrollStart] = useState(0)
  const [dragMoved, setDragMoved] = useState(false)

  // 动态测量容器可用宽度，确保 100% 撑满卡片右侧全部空间
  useEffect(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const parent = el.parentElement
    const updateWidth = () => {
      const available = parent ? parent.clientWidth - Y_AXIS_WIDTH : el.clientWidth
      if (available > 0) {
        setContainerWidth(available)
      }
    }
    updateWidth()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateWidth)
    if (parent) observer.observe(parent)
    else observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 寻找历史上读得最多的一天
  const peakDay = useMemo(() => {
    if (!points.length) return null
    return points.reduce((prev, cur) => (cur.seconds > prev.seconds ? cur : prev))
  }, [points])

  const peakSubtitle = useMemo(() => {
    if (!peakDay || peakDay.seconds <= 0) return null
    const [y, m, d] = peakDay.date.split('-')
    const h = Math.floor(peakDay.seconds / 3600)
    const min = Math.floor((peakDay.seconds % 3600) / 60)
    const durText = h > 0 ? (min > 0 ? `${h} 时 ${min} 分` : `${h} 时`) : `${Math.max(1, min)} 分`
    return {
      dateText: `${y} 年 ${m} 月 ${d} 日`,
      durText,
    }
  }, [peakDay])

  // 计算数值与坐标轴刻度
  const maxVal = useMemo(() => {
    if (!points.length) return 1
    if (mode === 'time') {
      return Math.max(1, ...points.map((p) => Math.round(p.seconds / 60)))
    }
    return Math.max(1, ...points.map((p) => p.progressPercent))
  }, [points, mode])

  const scale = useMemo(() => {
    return mode === 'time' ? getTimeScale(maxVal) : getProgressScale(maxVal)
  }, [maxVal, mode])

  // 图表几何尺寸（高度紧凑匀称，彻底消除上方大段空隙）
  const plotHeight = 190
  const paddingTop = 36
  const bottomY = paddingTop + plotHeight
  const svgHeight = bottomY + 54 // 留出下方 -45 度旋转的日期空间
  const pointSpacing = 68
  const chartMargin = 36 // 紧凑边距，不浪费任何横向空间
  const neededWidth = points.length > 1 ? (points.length - 1) * pointSpacing + chartMargin * 2 : containerWidth
  const contentWidth = Math.max(containerWidth, neededWidth)
  const canScroll = neededWidth > containerWidth

  // 自动在挂载或数据更新后滚到最右侧（最新日期）
  useEffect(() => {
    if (scrollRef.current && canScroll) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [points.length, mode, canScroll])

  // 鼠标拖拽横向滚动
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current || !canScroll) return
    setIsDragging(true)
    setDragMoved(false)
    setStartX(e.pageX - scrollRef.current.offsetLeft)
    setScrollStart(scrollRef.current.scrollLeft)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!scrollRef.current) return

    if (isDragging) {
      e.preventDefault()
      const x = e.pageX - scrollRef.current.offsetLeft
      const walk = (x - startX) * 1.5
      if (Math.abs(walk) > 3) setDragMoved(true)
      scrollRef.current.scrollLeft = scrollStart - walk
      return
    }

    // 根据鼠标横坐标 X 实时吸附到距离最近的节点
    if (coords.length > 0) {
      const rect = scrollRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left + scrollRef.current.scrollLeft

      let closestIdx = 0
      let minDist = Infinity
      for (let i = 0; i < coords.length; i++) {
        const dist = Math.abs(coords[i].x - mouseX)
        if (dist < minDist) {
          minDist = dist
          closestIdx = i
        }
      }
      setActiveIdx(closestIdx)
    }
  }

  const handleMouseUpOrLeave = () => {
    setIsDragging(false)
    setTimeout(() => setDragMoved(false), 50)
  }

  const coords = useMemo(() => {
    if (points.length === 0) return []
    const usableWidth = contentWidth - chartMargin * 2
    return points.map((p, i) => {
      const x = points.length === 1 ? contentWidth / 2 : chartMargin + (i / (points.length - 1)) * usableWidth
      const val = mode === 'time' ? Math.round(p.seconds / 60) : p.progressPercent
      const y = bottomY - (val / scale.yMax) * plotHeight
      return { x, y, val, point: p, index: i }
    })
  }, [points, contentWidth, chartMargin, mode, scale.yMax, bottomY, plotHeight])

  const activePoint = activeIdx !== null ? coords[activeIdx] : null

  return (
    <section
      className={cn(
        'rounded-3xl border border-stone-200/80 bg-white p-5 shadow-xs dark:border-stone-800 dark:bg-stone-900',
        className,
      )}
    >
      {/* 头部：标题与切换胶囊 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
          阅读趋势图
        </h3>
        <div className="flex items-center rounded-full bg-stone-100 p-0.5 dark:bg-stone-800">
          <button
            type="button"
            onClick={() => {
              setMode('time')
              setActiveIdx(null)
            }}
            className={cn(
              'rounded-full px-3.5 py-1 text-xs font-medium transition-all cursor-pointer',
              mode === 'time'
                ? 'bg-blue-600 text-white shadow-xs font-semibold'
                : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
            )}
          >
            时间
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('progress')
              setActiveIdx(null)
            }}
            className={cn(
              'rounded-full px-3.5 py-1 text-xs font-medium transition-all cursor-pointer',
              mode === 'progress'
                ? 'bg-blue-600 text-white shadow-xs font-semibold'
                : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
            )}
          >
            进度
          </button>
        </div>
      </div>

      {/* 副标题：高亮历史上读得最多的一天 */}
      <div className="mt-1 text-xs sm:text-sm text-stone-500 dark:text-stone-400">
        {peakSubtitle ? (
          <p>
            <span>{peakSubtitle.dateText} 这一天读了 </span>
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              {peakSubtitle.durText}
            </span>
            <span>，这一天格外努力！</span>
          </p>
        ) : (
          <p>暂无阅读记录</p>
        )}
      </div>

      {/* 图表主区域：无内层多余轮廓线与纵轴线，左侧固定 Y 轴刻度，右侧横向拖拽平滑滚动 */}
      <div className="relative mt-5 flex">
        {/* 左侧固定 Y 轴：无纵向边框线 */}
        <div
          className="relative z-10 w-11 shrink-0 select-none bg-transparent"
          style={{ height: svgHeight }}
        >
          {/* Y 轴单位标签：时间 / 进度 */}
          <span
            className="absolute left-1 text-[11px] font-medium text-stone-400 dark:text-stone-500"
            style={{ top: '8px' }}
          >
            {mode === 'time' ? '时间' : '进度'}
          </span>

          {/* 各刻度数值：与 SVG 水平线使用完全相同的 y 坐标并 -translate-y-1/2 垂直居中对齐 */}
          {scale.ticks.map((tick) => {
            const y = bottomY - (tick / scale.yMax) * plotHeight
            return (
              <span
                key={tick}
                className="absolute right-2 -translate-y-1/2 text-xs font-medium tabular-nums text-stone-400 dark:text-stone-500"
                style={{ top: `${y}px` }}
              >
                {tick}
              </span>
            )
          })}
        </div>

        {/* 右侧折线图容器 */}
        <div
          ref={scrollRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={() => {
            handleMouseUpOrLeave()
            setActiveIdx(null)
          }}
          className={cn(
            'relative min-w-0 flex-1 w-full select-none',
            canScroll ? 'overflow-x-auto scrollbar-thin' : 'overflow-visible',
            canScroll && isDragging ? 'cursor-grabbing' : 'cursor-default',
          )}
        >
          {/* 悬停详细气泡：严格 100% 居中对齐节点，未溢出滚动时无裁剪，文字全量可见 */}
          {activePoint && (
            <div
              className="pointer-events-none absolute z-30 flex flex-col items-center rounded-2xl border border-stone-200/90 bg-white/95 px-3.5 py-1.5 shadow-lg backdrop-blur-xs transition-transform duration-75 ease-out dark:border-stone-700/80 dark:bg-stone-900/95"
              style={{
                left: `${activePoint.x}px`,
                top: `${Math.max(8, activePoint.y - 84)}px`,
                transform: 'translateX(-50%)',
              }}
            >
              <span className="text-base font-bold tabular-nums text-stone-900 dark:text-stone-100 whitespace-nowrap">
                {formatCardValue(activePoint.point.seconds, mode, activePoint.point.progressPercent)}
              </span>
              <span className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400 whitespace-nowrap">
                {formatFullDate(activePoint.point.date)}
              </span>
            </div>
          )}

          {points.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-stone-400">
              本书暂无阅读趋势数据
            </div>
          ) : (
            <svg
              width={contentWidth}
              height={svgHeight}
              className="block overflow-visible"
            >
              <defs>
                <linearGradient id="reading-trend-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* 水平刻度参考线：与左侧 Y 轴完全贯通对齐 */}
              {scale.ticks.map((tick) => {
                const y = bottomY - (tick / scale.yMax) * plotHeight
                return (
                  <line
                    key={tick}
                    x1="0"
                    y1={y}
                    x2={contentWidth}
                    y2={y}
                    className="stroke-stone-200/60 dark:stroke-stone-800/80"
                    strokeWidth="1"
                  />
                )
              })}

              {/* 面积渐变填充 */}
              {coords.length >= 2 && (
                <path
                  d={getAreaPath(coords, bottomY, paddingTop)}
                  fill="url(#reading-trend-gradient)"
                />
              )}

              {/* 平滑贝塞尔折线（单调三次样条，绝对杜绝凹出底部） */}
              {coords.length >= 2 && (
                <path
                  d={getSmoothSplinePath(coords, bottomY, paddingTop)}
                  fill="none"
                  className="stroke-blue-500"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* 悬停时的垂直指引线：从节点向下延伸到底部基准线，不超出节点 */}
              {activePoint && (
                <line
                  x1={activePoint.x}
                  y1={activePoint.y}
                  x2={activePoint.x}
                  y2={bottomY}
                  className="stroke-blue-500"
                  strokeWidth="1.5"
                />
              )}

              {/* 每个打卡节点的同心圆与数值 */}
              {coords.map((c, i) => {
                const isSelected = activeIdx === i
                const prevDate = i > 0 ? coords[i - 1].point.date : null
                const label = formatXAxisDate(c.point.date, prevDate)
                return (
                  <g key={c.point.date}>
                    {/* 数值标签 */}
                    <text
                      x={c.x}
                      y={c.y - 10}
                      textAnchor="middle"
                      className="fill-stone-700 text-xs font-bold tabular-nums pointer-events-none dark:fill-stone-200"
                    >
                      {mode === 'time' ? c.val : Number(c.val.toFixed(1))}
                    </text>

                    {/* 节点外圆与内圆 */}
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={isSelected ? '7' : '5.5'}
                      className="fill-white stroke-blue-500 transition-all pointer-events-none dark:fill-stone-900"
                      strokeWidth={isSelected ? '3.5' : '3'}
                    />
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={isSelected ? '3.5' : '2.5'}
                      className="fill-blue-500 transition-all pointer-events-none"
                    />

                    {/* X 轴日期倾斜标签 */}
                    <g transform={`translate(${c.x}, ${bottomY + 12}) rotate(-45)`}>
                      <text
                        x="0"
                        y="0"
                        textAnchor="end"
                        className="fill-stone-500 text-[10px] font-medium tracking-tight select-none pointer-events-none dark:fill-stone-400"
                      >
                        {label}
                      </text>
                    </g>
                  </g>
                )
              })}

              {/* 全高垂直悬停热区矩形：平滑捕获横向鼠标移动，无缝切换节点 */}
              {coords.map((c, i) => {
                const prevX = i > 0 ? (coords[i - 1].x + c.x) / 2 : 0
                const nextX = i < coords.length - 1 ? (c.x + coords[i + 1].x) / 2 : contentWidth
                const bandX = prevX
                const bandWidth = nextX - prevX

                return (
                  <rect
                    key={`hit-${c.point.date}`}
                    x={bandX}
                    y={0}
                    width={bandWidth}
                    height={svgHeight}
                    fill="transparent"
                    onClick={() => {
                      if (!dragMoved) setActiveIdx(activeIdx === i ? null : i)
                    }}
                  />
                )
              })}
            </svg>
          )}
        </div>
      </div>
    </section>
  )
}
