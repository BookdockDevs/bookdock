import { useEffect, useRef, useState } from 'react'

import { localDateString, useReadingByTag } from '@/api/hooks/reading-records'
import { resolveArchiveScope } from '@/features/archive/archive-scope'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import type { DayRange, StatsPeriod } from '../date-utils'

interface TagDistributionProps {
  date: string | null
  period: StatsPeriod
  range: DayRange
  selectedTag?: string | null
  onSelectTag?: (tag: string) => void
}

export type TagChartMode = 'bar' | 'donut' | 'wordcloud' | 'treemap' | 'radar'

interface ModeOption {
  key: TagChartMode
  label: string
  icon: React.ReactNode
}

export default function TagDistribution({ date, period, range, selectedTag, onSelectTag }: TagDistributionProps) {
  const _ = useTranslation()
  const { from, to } = resolveArchiveScope({ period, anchor: localDateString(range.from), date: date ?? undefined }).query
  const query = useReadingByTag(from, to)
  const items = query.data?.data ?? []

  const [mode, setMode] = useState<TagChartMode>('bar')
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isMenuOpen])

  const maxCount = Math.max(1, ...items.map((item) => item.bookCount ?? 1))

  const modeOptions: ModeOption[] = [
    {
      key: 'bar',
      label: '柱状图',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20V10" />
          <path d="M18 20V4" />
          <path d="M6 20v-4" />
        </svg>
      ),
    },
    {
      key: 'donut',
      label: '环形图',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      ),
    },
    {
      key: 'wordcloud',
      label: '词云',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      ),
    },
    {
      key: 'treemap',
      label: '矩形树图',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="7" height="7" x="3" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="3" rx="1" />
          <rect width="7" height="7" x="14" y="14" rx="1" />
          <rect width="7" height="7" x="3" y="14" rx="1" />
        </svg>
      ),
    },
    {
      key: 'radar',
      label: '雷达图',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      ),
    },
  ]

  return (
    <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      {/* 头部：标题与视图模式切换 */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
          <span>{_('stats.tagDistribution')}</span>
          {items.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {items.length}
            </span>
          )}
        </h2>

        {/* 视图模式切换按钮（支持柱状图、环形图、词云、矩形树图、雷达图） */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="切换图表展示方式"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
            title="切换展示方式"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 7h12m0 0l-4-4m4 4l-4 4" />
              <path d="M16 17H4m0 0l4-4m-4 4l4 4" />
            </svg>
          </button>

          {isMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-1.5 w-40 rounded-2xl border border-stone-200/90 bg-white/95 p-1.5 shadow-lg backdrop-blur-md dark:border-stone-700/80 dark:bg-stone-900/95"
            >
              {modeOptions.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMode(opt.key)
                    setIsMenuOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition-colors',
                    mode === opt.key
                      ? 'bg-blue-50/80 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
                      : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800/70',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {mode === opt.key && <span className="font-bold">✓</span>}
                    <span>{opt.label}</span>
                  </span>
                  <span className="opacity-70">{opt.icon}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {query.isError ? (
        <QueryErrorState isRetrying={query.isFetching} onRetry={() => void query.refetch()} />
      ) : query.isPending ? (
        <div className="rounded-2xl border border-stone-100 bg-stone-50/50 p-4 dark:border-stone-800/80 dark:bg-stone-900/40">
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 w-full animate-pulse rounded-full bg-stone-200/70 dark:bg-stone-800" />
            ))}
          </div>
        </div>
      ) : !items.length ? (
        <p className="py-8 text-center text-sm text-stone-400 dark:text-stone-500">
          {_('stats.emptyTags')}
        </p>
      ) : (
        <div className="rounded-2xl border border-stone-100 bg-stone-50/40 p-3 sm:p-4 dark:border-stone-800/80 dark:bg-stone-900/30">
          {mode === 'bar' ? (
            /* 柱状图展示：数量圆圈徽标 + 胶囊条 */
            <ul className="flex flex-col gap-2.5">
              {items.map((item) => {
                const count = item.bookCount ?? 1
                const barPercent = Math.max(30, (count / maxCount) * 100)
                const isSelected = selectedTag === item.name

                return (
                  <li key={item.tagId} className="w-full">
                    <div
                      role="meter"
                      aria-label={item.name}
                      aria-valuemin={0}
                      aria-valuemax={maxCount}
                      aria-valuenow={count}
                      tabIndex={0}
                      title={isSelected ? '取消标签筛选' : `按标签「${item.name}」筛选`}
                      onClick={() => onSelectTag?.(isSelected ? '' : item.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelectTag?.(isSelected ? '' : item.name)
                        }
                      }}
                      className={cn(
                        'group flex h-10 items-center gap-2.5 rounded-full py-1 pl-1.5 pr-4 text-white shadow-2xs transition-all text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
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
          ) : (
            /* 未来视图模式占位 */
            <div className="py-8 text-center text-xs text-stone-400 dark:text-stone-500">
              <span>{modeOptions.find((o) => o.key === mode)?.label}功能扩展中</span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
