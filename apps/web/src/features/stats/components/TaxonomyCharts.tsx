import { useMemo, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

export type ChartDisplayMode = 'bar' | 'donut' | 'wordcloud' | 'treemap' | 'radar'

export interface TaxonomyItem {
  id: string
  name: string
  count: number
  durationSeconds?: number
}

interface TaxonomyChartsProps {
  items: TaxonomyItem[]
  mode: ChartDisplayMode
  selectedName?: string | null
  onSelectName?: (name: string) => void
  emptyText?: string
}

// 鲜亮明快、参考图 2、图 4 原型的柔和调色板
const VIBRANT_PALETTE = [
  '#FF6B6B', // 珊瑚红 (历史 7)
  '#FF9F68', // 暖橙 (唐朝 5)
  '#FDC841', // 暖黄 (同人 4)
  '#48B2FE', // 天蓝 (架空 3)
  '#4ED59E', // 薄荷绿 (都市 2)
  '#9B98E8', // 薰衣草紫 (玄幻 2)
  '#60A5FA', // 湖蓝 (兵王 2)
  '#B7E646', // 嫩绿 (两晋 1)
  '#F472B6', // 樱花粉
  '#2DD4BF', // 碧青
  '#A78BFA', // 浅紫
  '#FB7185', // 玫瑰红
]

function getColor(index: number): string {
  return VIBRANT_PALETTE[index % VIBRANT_PALETTE.length]!
}

/* =========================================================================
   1. 柱状图 (Bar Chart)
   ========================================================================= */
function BarChartView({
  items,
  maxCount,
  selectedName,
  onSelectName,
}: {
  items: TaxonomyItem[]
  maxCount: number
  selectedName?: string | null
  onSelectName?: (name: string) => void
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => {
        const count = item.count || 1
        const barPercent = Math.max(28, (count / maxCount) * 100)
        const isSelected = selectedName === item.name

        return (
          <li key={item.id} className="w-full">
            <div
              role="meter"
              aria-label={item.name}
              aria-valuemin={0}
              aria-valuemax={maxCount}
              aria-valuenow={count}
              tabIndex={0}
              title={isSelected ? `取消「${item.name}」筛选` : `按「${item.name}」筛选`}
              onClick={() => onSelectName?.(isSelected ? '' : item.name)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectName?.(isSelected ? '' : item.name)
                }
              }}
              className={cn(
                'group flex h-10 items-center gap-2.5 rounded-full py-1 pl-1.5 pr-4 text-white shadow-2xs transition-all text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 hover:brightness-105 hover:shadow-xs',
                isSelected
                  ? 'bg-blue-600 ring-2 ring-blue-500 ring-offset-2 shadow-md dark:bg-blue-500 dark:ring-blue-400 dark:ring-offset-stone-900'
                  : 'bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500',
              )}
              style={{ width: `${barPercent}%` }}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold tabular-nums text-blue-600 shadow-2xs dark:bg-stone-100 dark:text-blue-600">
                {count}
              </div>
              <span className="truncate text-sm font-medium tracking-tight text-white select-none flex items-center gap-1.5">
                {item.name}
                {isSelected && <span className="text-xs font-bold opacity-90">✓</span>}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* =========================================================================
   2. 环形图 (Donut Chart - 双向动态外扩联动 + 绝对几何居中 + 优雅无丑陋系统原生标题)
   ========================================================================= */
function DonutChartView({
  items,
  totalCount,
  selectedName,
  onSelectName,
}: {
  items: TaxonomyItem[]
  totalCount: number
  selectedName?: string | null
  onSelectName?: (name: string) => void
}) {
  const _ = useTranslation()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const size = 250
  const cx = size / 2
  const cy = size / 2
  const baseOuterR = 86
  const baseInnerR = 54

  // 计算扇区几何区间
  const slicesData = useMemo(() => {
    let currentAngle = -Math.PI / 2
    return items.map((item, i) => {
      const ratio = (item.count || 1) / totalCount
      const angle = ratio * 2 * Math.PI
      const a0 = currentAngle
      const a1 = currentAngle + angle
      currentAngle = a1

      return {
        item,
        a0,
        a1,
        color: getColor(i),
        ratioPercent: Math.round(ratio * 100),
      }
    })
  }, [items, totalCount])

  // 根据当前 hover 状态动态生成 SVG 路径（悬停项半径向外扩张浮起，其余微缩淡化）
  const slices = useMemo(() => {
    return slicesData.map((s, i) => {
      const isHovered = hoveredIndex === i
      const isAnyHovered = hoveredIndex !== null

      const outerR = isHovered ? baseOuterR + 7 : isAnyHovered ? baseOuterR - 2 : baseOuterR
      const innerR = isHovered ? baseInnerR - 2 : isAnyHovered ? baseInnerR + 1 : baseInnerR

      // 当只有一个分类或占比达 100% 时，采用同心复合子路径绘制，无内部连线与白色切口
      if (s.a1 - s.a0 >= 2 * Math.PI - 0.001) {
        const midA = s.a0 + Math.PI

        const ox1 = cx + outerR * Math.cos(s.a0)
        const oy1 = cy + outerR * Math.sin(s.a0)
        const oxMid = cx + outerR * Math.cos(midA)
        const oyMid = cy + outerR * Math.sin(midA)

        const ix1 = cx + innerR * Math.cos(s.a0)
        const iy1 = cy + innerR * Math.sin(s.a0)
        const ixMid = cx + innerR * Math.cos(midA)
        const iyMid = cy + innerR * Math.sin(midA)

        // 外圆顺时针，内圆逆时针，使用 M 断开子路径，彻底杜绝 L 连线产生的白色缝隙
        const pathData = `M ${ox1} ${oy1} A ${outerR} ${outerR} 0 1 1 ${oxMid} ${oyMid} A ${outerR} ${outerR} 0 1 1 ${ox1} ${oy1} M ${ix1} ${iy1} A ${innerR} ${innerR} 0 1 0 ${ixMid} ${iyMid} A ${innerR} ${innerR} 0 1 0 ${ix1} ${iy1} Z`
        return {
          ...s,
          pathData,
          isHovered,
        }
      }

      const x1 = cx + outerR * Math.cos(s.a0)
      const y1 = cy + outerR * Math.sin(s.a0)
      const x2 = cx + outerR * Math.cos(s.a1)
      const y2 = cy + outerR * Math.sin(s.a1)
      const x3 = cx + innerR * Math.cos(s.a1)
      const y3 = cy + innerR * Math.sin(s.a1)
      const x4 = cx + innerR * Math.cos(s.a0)
      const y4 = cy + innerR * Math.sin(s.a0)

      const largeArc = s.a1 - s.a0 > Math.PI ? 1 : 0
      const pathData = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`

      return {
        ...s,
        pathData,
        isHovered,
      }
    })
  }, [slicesData, hoveredIndex, cx, cy, baseOuterR, baseInnerR])

  const activeSlice = hoveredIndex !== null ? slices[hoveredIndex] : null

  return (
    <div className="flex flex-col items-center py-2 select-none">
      {/* 居中大圆环容器 */}
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
          {slices.map((slice, i) => {
            const isHovered = hoveredIndex === i
            const isSelected = selectedName === slice.item.name
            const isAnyHovered = hoveredIndex !== null

            return (
              <path
                key={slice.item.id || i}
                d={slice.pathData}
                fill={slice.color}
                stroke={slices.length > 1 ? 'var(--bd-bg, #ffffff)' : 'none'}
                strokeWidth={slices.length > 1 ? 2 : 0}
                className={cn(
                  'transition-all duration-200 cursor-pointer ease-out',
                  isHovered
                    ? 'opacity-100 brightness-105 filter drop-shadow-md'
                    : isAnyHovered
                      ? 'opacity-35 hover:opacity-100'
                      : 'opacity-95 hover:opacity-100',
                  isSelected && 'ring-2 ring-blue-500',
                )}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => onSelectName?.(isSelected ? '' : slice.item.name)}
              />
            )
          })}
        </svg>

        {/* 正中心数值：采用原生 HTML Flex 盒，完美绝对几何垂直+水平居中 */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center select-none px-4">
          {activeSlice ? (
            <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-150">
              <span className="max-w-[90px] truncate text-xs font-medium text-stone-500 dark:text-stone-400">
                {activeSlice.item.name}
              </span>
              <div className="mt-0.5 flex items-baseline justify-center gap-0.5">
                <span className="text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
                  {activeSlice.item.count}
                </span>
                <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {_('stats.booksUnit', { n: '' }).trim()}
                </span>
              </div>
              <span className="mt-1 inline-flex items-center rounded-full bg-stone-100 px-1.5 py-0.2 text-[10px] font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                {activeSlice.ratioPercent}%
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <span className="text-xs font-medium text-stone-400 dark:text-stone-500">
                {_('stats.total') || '总计'}
              </span>
              <div className="mt-0.5 flex items-baseline justify-center gap-0.5">
                <span className="text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
                  {totalCount}
                </span>
                <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {_('stats.booksUnit', { n: '' }).trim()}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部紧凑图例区：小圆角色块 + 标签名 + 数量（双向联动高亮） */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 max-w-lg w-full px-2">
        {items.map((item, i) => {
          const isSelected = selectedName === item.name
          const isHovered = hoveredIndex === i
          const color = getColor(i)
          return (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={() => onSelectName?.(isSelected ? '' : item.name)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-all cursor-pointer text-left',
                isHovered
                  ? 'bg-stone-100 dark:bg-stone-800 ring-1 ring-stone-200 dark:ring-stone-700 font-semibold'
                  : 'hover:bg-stone-50 dark:hover:bg-stone-850',
                isSelected ? 'font-bold opacity-100' : 'text-stone-700 dark:text-stone-300',
              )}
            >
              <span
                className="h-2.5 w-3.5 shrink-0 rounded-[3px] shadow-2xs"
                style={{ backgroundColor: color }}
              />
              <span className="truncate flex-1">{item.name}</span>
              <span className="tabular-nums font-semibold text-stone-900 dark:text-stone-100">
                {item.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* =========================================================================
   3. 词云 (Word Cloud - 多尺度极坐标径向放缩星云算法，彻底告别死板水平排)
   ========================================================================= */
interface CloudToken {
  id: string
  name: string
  count: number
  color: string
  xPct: number
  yPct: number
  fontSize: number
  fontWeight: string
  opacity: number
}

interface BBox {
  left: number
  top: number
  right: number
  bottom: number
}

function boxesIntersect(a: BBox, b: BBox, pad = 6): boolean {
  return !(
    a.right + pad < b.left ||
    a.left - pad > b.right ||
    a.bottom + pad < b.top ||
    a.top - pad > b.bottom
  )
}

function measureTokenBox(name: string, fontSize: number): { w: number; h: number } {
  let charLen = 0
  for (let i = 0; i < name.length; i++) {
    charLen += name.charCodeAt(i) > 255 ? 1 : 0.6
  }
  const w = charLen * fontSize + 10
  const h = fontSize + 6
  return { w, h }
}

function WordCloudView({
  items,
  selectedName,
  onSelectName,
}: {
  items: TaxonomyItem[]
  maxCount?: number
  selectedName?: string | null
  onSelectName?: (name: string) => void
}) {
  const _ = useTranslation()
  const [hoveredName, setHoveredName] = useState<string | null>(null)
  const totalCount = useMemo(() => items.reduce((s, it) => s + (it.count || 1), 0), [items])

  // 严密 AABB 包围盒碰撞检测 + 黄金角阿基米德螺线星云算法 (100% 不穿模，中心绝对扎实)
  const tokens = useMemo(() => {
    if (!items.length) return []
    const sorted = [...items].sort((a, b) => (b.count || 0) - (a.count || 0))

    // 逻辑画布尺寸 (中心 280, 125)
    const W = 560
    const H = 250
    const cx = W / 2
    const cy = H / 2

    // 1. 生成候选变体列表（按视觉字阶从大到小排列）
    interface Candidate {
      id: string
      name: string
      count: number
      color: string
      fontSize: number
      fontWeight: string
      opacity: number
      w: number
      h: number
      isCenter?: boolean
    }

    const rawCandidates: Candidate[] = []
    let keyIdx = 0

    // (1) 核心主星 (Top 1 稳居正中心，Top 2~3 紧密环绕)
    sorted.forEach((it, i) => {
      let fontSize = 16
      let fontWeight = 'font-semibold'
      let opacity = 0.85
      if (i === 0) {
        fontSize = 28
        fontWeight = 'font-bold'
        opacity = 1
      } else if (i === 1) {
        fontSize = 22
        fontWeight = 'font-bold'
        opacity = 0.95
      } else if (i === 2) {
        fontSize = 19
        fontWeight = 'font-bold'
        opacity = 0.9
      }
      const { w, h } = measureTokenBox(it.name, fontSize)
      rawCandidates.push({
        id: `hero-${keyIdx++}-${it.name}`,
        name: it.name,
        count: it.count,
        color: getColor(i),
        fontSize,
        fontWeight,
        opacity,
        w,
        h,
        isCenter: i === 0,
      })
    })

    // (2) 次级中星变体
    sorted.forEach((it, i) => {
      const fontSize = 14
      const { w, h } = measureTokenBox(it.name, fontSize)
      rawCandidates.push({
        id: `mid-${keyIdx++}-${it.name}`,
        name: it.name,
        count: it.count,
        color: getColor(i),
        fontSize,
        fontWeight: 'font-semibold',
        opacity: 0.68,
        w,
        h,
      })
    })

    // (3) 外围漫射微星尘变体 (向四周扩散充数)
    sorted.forEach((it, i) => {
      const dustCount = sorted.length <= 4 ? 2 : 1
      for (let s = 0; s < dustCount; s++) {
        const fontSize = 11
        const { w, h } = measureTokenBox(it.name, fontSize)
        rawCandidates.push({
          id: `dust-${keyIdx++}-${it.name}`,
          name: it.name,
          count: it.count,
          color: getColor(i),
          fontSize,
          fontWeight: 'font-normal',
          opacity: 0.28,
          w,
          h,
        })
      }
    })

    // 按字号由大到小排序，确保先排中心大星，再把小星塞入间隙
    rawCandidates.sort((a, b) => b.fontSize - a.fontSize)

    // 2. 空间螺旋探测与碰撞排斥
    const placedBoxes: BBox[] = []
    const placedTokens: CloudToken[] = []

    rawCandidates.forEach((cand, k) => {
      // Top 1 绝对精准居中，永不空心
      if (cand.isCenter) {
        const x = cx - cand.w / 2
        const y = cy - cand.h / 2
        const box: BBox = { left: x, top: y, right: x + cand.w, bottom: y + cand.h }
        placedBoxes.push(box)
        placedTokens.push({
          id: cand.id,
          name: cand.name,
          count: cand.count,
          color: cand.color,
          fontSize: cand.fontSize,
          fontWeight: cand.fontWeight,
          opacity: cand.opacity,
          xPct: ((x + cand.w / 2) / W) * 100,
          yPct: ((y + cand.h / 2) / H) * 100,
        })
        return
      }

      // 其余词沿黄金角螺旋线由内向外寻找无重叠空隙
      const startAngle = (k * 137.5) % 360
      let placed = false

      for (let step = 0; step < 260; step++) {
        const r = 16 + step * 2.6
        const deg = startAngle + step * 18
        const rad = (deg * Math.PI) / 180
        // X 轴按 1.45 展宽，形成符合视觉美感的横向椭圆星云
        const x = cx + r * Math.cos(rad) * 1.45 - cand.w / 2
        const y = cy + r * Math.sin(rad) * 0.82 - cand.h / 2

        // 画布边界检查
        if (x < 8 || x + cand.w > W - 8 || y < 10 || y + cand.h > H - 10) {
          continue
        }

        const candidateBox: BBox = {
          left: x,
          top: y,
          right: x + cand.w,
          bottom: y + cand.h,
        }

        // 碰撞检测：与所有已放置的词盒检查是否重叠
        const hasCollision = placedBoxes.some((b) => boxesIntersect(candidateBox, b, 6))
        if (!hasCollision) {
          placedBoxes.push(candidateBox)
          placedTokens.push({
            id: cand.id,
            name: cand.name,
            count: cand.count,
            color: cand.color,
            fontSize: cand.fontSize,
            fontWeight: cand.fontWeight,
            opacity: cand.opacity,
            xPct: ((x + cand.w / 2) / W) * 100,
            yPct: ((y + cand.h / 2) / H) * 100,
          })
          placed = true
          break
        }
      }

      // 若外圈微小尘埃未能找到无碰撞空位，则优雅丢弃该微尘，100% 坚守不穿模底线
      if (!placed && cand.fontSize >= 15) {
        // 关键大词若未放入，尝试直接在边缘安全位置兜底
        const x = Math.max(12, Math.min(W - cand.w - 12, cx + (k % 2 === 0 ? 120 : -120)))
        const y = Math.max(12, Math.min(H - cand.h - 12, cy + (k % 3 - 1) * 60))
        placedTokens.push({
          id: cand.id,
          name: cand.name,
          count: cand.count,
          color: cand.color,
          fontSize: cand.fontSize,
          fontWeight: cand.fontWeight,
          opacity: cand.opacity,
          xPct: ((x + cand.w / 2) / W) * 100,
          yPct: ((y + cand.h / 2) / H) * 100,
        })
      }
    })

    return placedTokens
  }, [items])

  const activeName = hoveredName ?? selectedName
  const activeItem = items.find((it) => it.name === activeName)

  return (
    <div className="flex flex-col items-center py-2 select-none">
      {/* 顶部桌面端轻量聚焦指示器 (仅在 Hover 时平滑展示) */}
      <div className="h-6 flex items-center justify-center">
        {activeItem && (
          <div className="inline-flex items-center gap-2 rounded-full bg-stone-900/90 px-3 py-0.5 text-xs text-white shadow-sm backdrop-blur-sm dark:bg-stone-100 dark:text-stone-900 animate-in fade-in duration-150">
            <span className="font-semibold">{activeItem.name}</span>
            <span className="opacity-80">·</span>
            <span>{_('stats.booksUnit', { n: activeItem.count })}</span>
            <span className="opacity-80">·</span>
            <span>{Math.round(((activeItem.count || 1) / totalCount) * 100)}%</span>
          </div>
        )}
      </div>

      {/* 极坐标多尺度星云画布：错落聚散，无机械水平横排 */}
      <div className="relative h-[250px] w-full max-w-[580px] overflow-hidden">
        {tokens.map((token) => {
          const isMatch = activeName === token.name
          const isOtherHovered = hoveredName !== null && hoveredName !== token.name

          return (
            <button
              key={token.id}
              type="button"
              onMouseEnter={() => setHoveredName(token.name)}
              onMouseLeave={() => setHoveredName(null)}
              onClick={() => onSelectName?.(selectedName === token.name ? '' : token.name)}
              style={{
                left: `${token.xPct}%`,
                top: `${token.yPct}%`,
                fontSize: `${token.fontSize}px`,
                color: token.color,
                opacity: isMatch ? 1 : isOtherHovered ? 0.12 : token.opacity,
              }}
              className={cn(
                token.fontWeight,
                'absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-200 cursor-pointer select-none leading-none tracking-tight whitespace-nowrap',
                isMatch && 'scale-120 font-bold brightness-110 drop-shadow-md z-20',
                isOtherHovered && 'blur-[0.4px]',
                !isMatch && 'hover:scale-105',
              )}
            >
              {token.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* =========================================================================
   4. 矩形树图 (Treemap - 基于 HTML/CSS 百分比盒模型，字形不失真 + 悬停 Tooltip 气泡)
   ========================================================================= */
interface TreemapNodePct {
  item: TaxonomyItem
  xPct: number
  yPct: number
  wPct: number
  hPct: number
  color: string
  ratioPercent: number
}

function computeTreemapPct(
  items: TaxonomyItem[],
  totalCount: number,
): TreemapNodePct[] {
  if (!items.length || totalCount <= 0) return []

  const nodes: TreemapNodePct[] = []
  const sorted = [...items].sort((a, b) => (b.count || 0) - (a.count || 0))

  function partition(
    list: TaxonomyItem[],
    x: number,
    y: number,
    w: number,
    h: number,
    offsetIndex: number,
  ) {
    if (!list.length) return
    if (list.length === 1) {
      const it = list[0]!
      nodes.push({
        item: it,
        xPct: x,
        yPct: y,
        wPct: w,
        hPct: h,
        color: getColor(offsetIndex),
        ratioPercent: Math.round(((it.count || 1) / totalCount) * 100),
      })
      return
    }

    const subTotal = list.reduce((s, it) => s + (it.count || 1), 0)
    let acc = 0
    let splitIdx = 0
    const half = subTotal / 2

    for (let i = 0; i < list.length; i++) {
      acc += list[i]!.count || 1
      if (acc >= half || i === list.length - 2) {
        splitIdx = i + 1
        break
      }
    }

    const firstGroup = list.slice(0, splitIdx)
    const secondGroup = list.slice(splitIdx)
    const firstWeight = firstGroup.reduce((s, it) => s + (it.count || 1), 0)
    const ratio = firstWeight / subTotal

    if (w >= h) {
      // 水平划分左右
      const w1 = w * ratio
      const w2 = w - w1
      partition(firstGroup, x, y, w1, h, offsetIndex)
      partition(secondGroup, x + w1, y, w2, h, offsetIndex + firstGroup.length)
    } else {
      // 垂直划分上下
      const h1 = h * ratio
      const h2 = h - h1
      partition(firstGroup, x, y, w, h1, offsetIndex)
      partition(secondGroup, x, y + h1, w, h2, offsetIndex + firstGroup.length)
    }
  }

  partition(sorted, 0, 0, 100, 100, 0)
  return nodes
}

function TreemapView({
  items,
  totalCount,
  selectedName,
  onSelectName,
}: {
  items: TaxonomyItem[]
  totalCount: number
  selectedName?: string | null
  onSelectName?: (name: string) => void
}) {
  const [hoveredNode, setHoveredNode] = useState<TreemapNodePct | null>(null)
  const nodes = useMemo(
    () => computeTreemapPct(items, totalCount),
    [items, totalCount],
  )

  return (
    <div className="w-full py-1">
      {/* 采用纯 HTML/CSS 绝对定位盒，文字字形绝对不失真/拉扁 */}
      <div className="relative h-[250px] sm:h-[280px] w-full overflow-hidden rounded-xl bg-stone-100 p-0.5 dark:bg-stone-850 shadow-2xs">
        {nodes.map((node) => {
          const isSelected = selectedName === node.item.name
          const isHovered = hoveredNode?.item.id === node.item.id

          // 面积保护：小方块自适应调整字体大小与间距
          const isCompact = node.wPct < 18 || node.hPct < 28

          return (
            <div
              key={node.item.id}
              style={{
                left: `${node.xPct}%`,
                top: `${node.yPct}%`,
                width: `${node.wPct}%`,
                height: `${node.hPct}%`,
                padding: '2px',
              }}
              className="absolute"
            >
              <button
                type="button"
                onMouseEnter={() => setHoveredNode(node)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => onSelectName?.(isSelected ? '' : node.item.name)}
                style={{ backgroundColor: node.color }}
                className={cn(
                  'group relative flex h-full w-full flex-col items-center justify-center rounded-lg p-1.5 text-white transition-all cursor-pointer select-none overflow-hidden',
                  isHovered ? 'brightness-110 z-10 shadow-md scale-[1.01]' : 'hover:brightness-105',
                  isSelected && 'ring-2 ring-white ring-offset-2 ring-offset-stone-900 drop-shadow-md',
                )}
              >
                <span className={cn('font-bold leading-none tabular-nums drop-shadow-xs', isCompact ? 'text-lg' : 'text-xl sm:text-2xl')}>
                  {node.item.count}
                </span>
                <span className={cn('truncate font-medium tracking-tight drop-shadow-xs max-w-full px-1', isCompact ? 'mt-1 text-[11px]' : 'mt-1.5 text-xs sm:text-sm')}>
                  {node.item.name}
                </span>

                {/* 悬停气泡 Tooltip */}
                {isHovered && (
                  <div className="pointer-events-none absolute inset-x-1 bottom-1 flex justify-center">
                    <span className="rounded-md bg-stone-900/90 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-xs backdrop-blur-xs">
                      {node.ratioPercent}%
                    </span>
                  </div>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* =========================================================================
   5. 雷达图 (Radar Chart - 顶点脉冲高亮 + 悬停 Tooltip 气泡 + 标签名称数量永不丢失)
   ========================================================================= */
function RadarChartView({
  items,
  maxCount,
  selectedName,
  onSelectName,
}: {
  items: TaxonomyItem[]
  maxCount: number
  selectedName?: string | null
  onSelectName?: (name: string) => void
}) {
  const _ = useTranslation()
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null)
  const totalCount = useMemo(() => items.reduce((s, it) => s + (it.count || 1), 0), [items])

  const width = 380
  const height = 300
  const cx = width / 2
  const cy = height / 2
  const maxR = 80 // 留出充足外周空间给标签
  const count = items.length

  const rings = [0.25, 0.5, 0.75, 1]

  // 计算顶点位置
  const vertices = useMemo(() => {
    return items.map((item, i) => {
      const angle = (i * 2 * Math.PI) / count - Math.PI / 2
      const ratio = Math.max(0.14, (item.count || 1) / maxCount)
      const r = ratio * maxR

      const x = cx + r * Math.cos(angle)
      const y = cy + r * Math.sin(angle)
      const axisX = cx + maxR * Math.cos(angle)
      const axisY = cy + maxR * Math.sin(angle)

      // 外部文字位置（向外留出 32px）
      const labelR = maxR + 32
      const lx = cx + labelR * Math.cos(angle)
      const ly = cy + labelR * Math.sin(angle)
      const ratioPercent = Math.round(((item.count || 1) / totalCount) * 100)

      return {
        item,
        angle,
        x,
        y,
        axisX,
        axisY,
        lx,
        ly,
        ratioPercent,
      }
    })
  }, [items, maxCount, count, cx, cy, maxR, totalCount])

  // 多边形路径
  const polygonPoints = vertices.map((v) => `${v.x},${v.y}`).join(' ')
  const activeVertex = hoveredPoint !== null ? vertices[hoveredPoint] : null

  return (
    <div className="flex flex-col items-center py-2 select-none">
      <div className="relative">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
          {/* 1. 同心圆底网格 */}
          {rings.map((ring, idx) => (
            <circle
              key={ring}
              cx={cx}
              cy={cy}
              r={ring * maxR}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray={idx === rings.length - 1 ? undefined : '3 3'}
              className="text-stone-200 dark:text-stone-700"
            />
          ))}

          {/* 2. 轴射线 (保持纯净一致的底层网格，悬停时不额外突出突兀的线束) */}
          {vertices.map((v, i) => (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={v.axisX}
              y2={v.axisY}
              stroke="currentColor"
              strokeWidth={1}
              className="text-stone-200 dark:text-stone-700"
            />
          ))}

          {/* 3. 数据覆盖多边形：采用书香暖珀琥珀面，告别科技蓝 */}
          <polygon
            points={polygonPoints}
            fill="#F59E0B"
            fillOpacity={hoveredPoint !== null ? 0.24 : 0.16}
            stroke="#D97706"
            strokeWidth={1.75}
            className="transition-all duration-300 dark:stroke-amber-400"
          />

          {/* 4. 数据顶点圆球 (水墨同心圆质感：白芯内环 + 柔和光晕，无刺眼脉冲) */}
          {vertices.map((v, i) => {
            const isSelected = selectedName === v.item.name
            const isHovered = hoveredPoint === i

            return (
              <g key={i} className="cursor-pointer" onClick={() => onSelectName?.(isSelected ? '' : v.item.name)}>
                {/* 悬停柔和发光光晕 */}
                {isHovered && (
                  <circle
                    cx={v.x}
                    cy={v.y}
                    r={10}
                    fill="#F59E0B"
                    fillOpacity={0.16}
                    className="transition-all duration-200"
                  />
                )}
                {/* 外层琥珀圈 */}
                <circle
                  cx={v.x}
                  cy={v.y}
                  r={isHovered ? 5.5 : isSelected ? 5 : 3.5}
                  fill="#D97706"
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  className="transition-all duration-200 dark:fill-amber-400 dark:stroke-stone-900"
                  onMouseEnter={() => setHoveredPoint(i)}
                  onMouseLeave={() => setHoveredPoint(null)}
                />
                {/* 悬停白芯内环 (White-core Ring) */}
                {isHovered && (
                  <circle
                    cx={v.x}
                    cy={v.y}
                    r={2}
                    className="fill-white dark:fill-stone-900 pointer-events-none"
                  />
                )}
              </g>
            )
          })}

          {/* 5. 外部标签：水墨景深聚焦 (当前悬停项加深聚焦，非悬停项优雅淡化褪后) */}
          {vertices.map((v, i) => {
            const isSelected = selectedName === v.item.name
            const isHovered = hoveredPoint === i
            const isAnyHovered = hoveredPoint !== null
            const cos = Math.cos(v.angle)
            const sin = Math.sin(v.angle)

            let anchor: 'start' | 'middle' | 'end' = 'middle'
            let dy = '0.3em'

            if (cos > 0.3) {
              anchor = 'start'
            } else if (cos < -0.3) {
              anchor = 'end'
            }

            if (sin < -0.7) {
              dy = '-0.6em'
            } else if (sin > 0.7) {
              dy = '1em'
            }

            return (
              <text
                key={i}
                x={v.lx}
                y={v.ly}
                textAnchor={anchor}
                dy={dy}
                onMouseEnter={() => setHoveredPoint(i)}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={() => onSelectName?.(isSelected ? '' : v.item.name)}
                className={cn(
                  'text-xs select-none cursor-pointer transition-all duration-200',
                  isHovered || isSelected
                    ? 'fill-stone-900 dark:fill-stone-50 font-bold opacity-100 drop-shadow-xs'
                    : isAnyHovered
                      ? 'fill-stone-400 dark:fill-stone-500 opacity-40 font-normal'
                      : 'fill-stone-600 dark:fill-stone-300 font-medium opacity-90 hover:fill-stone-900 dark:hover:fill-stone-100',
                )}
              >
                <tspan className={cn('transition-all', (isHovered || isSelected) && 'font-bold')}>
                  {v.item.name}
                </tspan>
                <tspan dx="5" className={cn('tabular-nums opacity-85', (isHovered || isSelected) ? 'font-bold' : 'font-medium')}>
                  {v.item.count}
                </tspan>
              </text>
            )
          })}
        </svg>

        {/* 6. 顶点悬停浮动气泡 Tooltip */}
        {activeVertex && (
          <div
            style={{
              left: `${activeVertex.x}px`,
              top: `${activeVertex.y - 28}px`,
              transform: 'translate(-50%, -100%)',
            }}
            className="pointer-events-none absolute z-20 flex items-center gap-1.5 rounded-full bg-stone-900/90 px-2.5 py-1 text-xs font-medium text-white shadow-md backdrop-blur-xs dark:bg-stone-100 dark:text-stone-900 animate-in fade-in zoom-in-95 duration-150"
          >
            <span className="font-semibold">{activeVertex.item.name}</span>
            <span className="opacity-75">·</span>
            <span>{_('stats.booksUnit', { n: activeVertex.item.count })}</span>
            <span className="opacity-75">·</span>
            <span className="text-amber-400 dark:text-amber-600 font-semibold">{activeVertex.ratioPercent}%</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* =========================================================================
   总导出组件
   ========================================================================= */
export default function TaxonomyCharts({
  items,
  mode,
  selectedName,
  onSelectName,
  emptyText = '暂无数据',
}: TaxonomyChartsProps) {
  const _ = useTranslation()

  if (!items.length) {
    return (
      <p className="py-8 text-center text-sm text-stone-400 dark:text-stone-500">
        {emptyText}
      </p>
    )
  }

  const totalCount = items.reduce((sum, item) => sum + (item.count || 1), 0)
  const maxCount = Math.max(1, ...items.map((item) => item.count || 1))

  switch (mode) {
    case 'bar':
      return (
        <BarChartView
          items={items}
          maxCount={maxCount}
          selectedName={selectedName}
          onSelectName={onSelectName}
        />
      )
    case 'donut':
      return (
        <DonutChartView
          items={items}
          totalCount={totalCount}
          selectedName={selectedName}
          onSelectName={onSelectName}
        />
      )
    case 'wordcloud':
      return (
        <WordCloudView
          items={items}
          maxCount={maxCount}
          selectedName={selectedName}
          onSelectName={onSelectName}
        />
      )
    case 'treemap':
      return (
        <TreemapView
          items={items}
          totalCount={totalCount}
          selectedName={selectedName}
          onSelectName={onSelectName}
        />
      )
    case 'radar':
      return (
        <RadarChartView
          items={items}
          maxCount={maxCount}
          selectedName={selectedName}
          onSelectName={onSelectName}
        />
      )
    default:
      return null
  }
}
