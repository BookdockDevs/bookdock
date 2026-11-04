import { useEffect, useRef, useState } from 'react'

import { localDateString, useReadingByTag } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { resolveArchiveScope } from '@/features/archive/archive-scope'
import { useTranslation } from '@/hooks/useTranslation'

import type { DayRange, StatsPeriod } from '../date-utils'
import ChartModeMenuList from './ChartModeMenu'
import TaxonomyCharts, { type ChartDisplayMode, type TaxonomyItem } from './TaxonomyCharts'

interface TagDistributionProps {
  date: string | null
  period: StatsPeriod
  range: DayRange
  selectedTag?: string | null
  onSelectTag?: (tag: string) => void
}

const TAG_CHART_MODE_KEY = 'bd-stats-tag-chart-mode'
const VALID_MODES: ChartDisplayMode[] = ['bar', 'donut', 'wordcloud', 'treemap', 'radar']

function getInitialTagMode(): ChartDisplayMode {
  if (typeof window === 'undefined') return 'bar'
  try {
    const saved = localStorage.getItem(TAG_CHART_MODE_KEY)
    if (saved && (VALID_MODES as string[]).includes(saved)) {
      return saved as ChartDisplayMode
    }
  } catch {
    // ignore
  }
  return 'bar'
}

export default function TagDistribution({ date, period, range, selectedTag, onSelectTag }: TagDistributionProps) {
  const _ = useTranslation()
  const { from, to } = resolveArchiveScope({ period, anchor: localDateString(range.from), date: date ?? undefined }).query
  const query = useReadingByTag(from, to)
  const items = query.data?.data ?? []

  const [mode, setMode] = useState<ChartDisplayMode>(getInitialTagMode)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  function handleModeChange(newMode: ChartDisplayMode) {
    setMode(newMode)
    setMenuOpen(false)
    try {
      localStorage.setItem(TAG_CHART_MODE_KEY, newMode)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const taxonomyItems: TaxonomyItem[] = items.map((item) => ({
    id: item.tagId,
    name: item.name,
    count: item.bookCount ?? 1,
    durationSeconds: item.durationSeconds,
  }))

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

        {/* 图表展示方式切换菜单 (通过 relative/absolute 紧贴触发按钮，滚动时绝不脱节) */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="切换图表展示方式"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-300 cursor-pointer"
            title="切换展示方式"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 7h12m0 0l-4-4m4 4l-4 4" />
              <path d="M16 17H4m0 0l4-4m-4 4l4 4" />
            </svg>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1.5 z-30 w-40 rounded-xl border border-stone-200/80 bg-white/95 p-1 shadow-xl backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95 animate-in fade-in zoom-in-95 duration-100"
            >
              <ChartModeMenuList
                currentMode={mode}
                onSelect={handleModeChange}
              />
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
          <TaxonomyCharts
            items={taxonomyItems}
            mode={mode}
            selectedName={selectedTag}
            onSelectName={onSelectTag}
            emptyText={_('stats.emptyTags')}
          />
        </div>
      )}
    </section>
  )
}
