import { useRef, useState } from 'react'

import {
  parseArchiveRecordTypes,
  type ArchiveBooksQuery,
  type ArchiveRecordType,
  type ReadStatus,
} from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { computeFromAnchor, PADDING, type SmartPosition } from '@/lib/position'
import { cn } from '@/lib/utils'

import type { ArchiveSidebarParams } from './ArchiveSidebar'

interface SortDimension {
  id: string
  labelKey: string
  descSort: ArchiveBooksQuery['sort']
  ascSort: ArchiveBooksQuery['sort']
  defaultOrder: 'desc' | 'asc'
}

const SORT_DIMENSIONS: SortDimension[] = [
  { id: 'time', labelKey: 'archive.sortRecent', descSort: 'recent', ascSort: 'earliest', defaultOrder: 'desc' },
  { id: 'reading-time', labelKey: 'archive.sortReadingTime', descSort: 'reading-time', ascSort: 'reading-time-asc', defaultOrder: 'desc' },
  { id: 'notes', labelKey: 'archive.sortMost', descSort: 'most', ascSort: 'fewest', defaultOrder: 'desc' },
  { id: 'title', labelKey: 'library.sortBy.title', descSort: 'title-desc', ascSort: 'title-asc', defaultOrder: 'asc' },
]

const TYPE_ITEMS: Array<{ key: ArchiveRecordType; labelKey: string }> = [
  { key: 'highlight', labelKey: 'archive.typeHighlight' },
  { key: 'bookmark', labelKey: 'archive.typeBookmark' },
  { key: 'idea', labelKey: 'archive.typeIdea' },
  { key: 'review', labelKey: 'archive.typeReview' },
]

const READ_STATUS_KEYS: Record<ReadStatus, string> = {
  wishlist: 'library.readStatusWishlist',
  reading: 'library.readStatusReading',
  finished: 'library.readStatusFinished',
  idle: 'library.readStatusIdle',
  abandoned: 'library.readStatusAbandoned',
}

interface ArchiveFilterMenuProps {
  params: ArchiveSidebarParams
  onChange: (patch: Partial<ArchiveSidebarParams>) => void
}

export default function ArchiveFilterMenu({ params, onChange }: ArchiveFilterMenuProps) {
  const _ = useTranslation()
  const [menu, setMenu] = useState<SmartPosition | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selectedTypes = parseArchiveRecordTypes(params.type)
  const isAllTypesActive = selectedTypes.length === 0

  const hasTypeFilter = selectedTypes.length > 0
  const hasStatusFilter = Boolean(params.readStatus)
  const hasTagFilter = Boolean(params.tag)
  // 筛选计数仅统计实际的数据过滤条件（记录类型、阅读状态、标签），排序属于常驻视图排布，不计入筛选数
  const activeFilterCount = (hasTypeFilter ? selectedTypes.length : 0) + (hasStatusFilter ? 1 : 0) + (hasTagFilter ? 1 : 0)
  const isFilterActive = activeFilterCount > 0

  const menuWidth = 280
  const estimatedHeight = 360

  function toggle() {
    const anchor = anchorRef.current
    if (!anchor) return
    if (menu) {
      setMenu(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    const position = computeFromAnchor(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      menuWidth,
      estimatedHeight,
    )
    setMenu({
      ...position,
      left: Math.max(PADDING, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - PADDING)),
    })
  }

  // 重置筛选：对齐首页逻辑，仅清空过滤条件，绝不重置用户的排序方式
  function handleReset() {
    onChange({
      type: 'all',
      readStatus: undefined,
      tag: undefined,
    })
    setMenu(null)
  }

  function handleSortClick(dim: SortDimension) {
    const isCurrentDim = params.sort === dim.descSort || params.sort === dim.ascSort
    if (!isCurrentDim) {
      onChange({ sort: dim.defaultOrder === 'asc' ? dim.ascSort : dim.descSort })
    } else {
      const nextSort = params.sort === dim.descSort ? dim.ascSort : dim.descSort
      onChange({ sort: nextSort })
    }
  }

  function handleTypeClick(typeKey: ArchiveRecordType) {
    if (isAllTypesActive) {
      onChange({ type: typeKey })
      return
    }
    if (selectedTypes.includes(typeKey)) {
      const next = selectedTypes.filter((k) => k !== typeKey)
      onChange({ type: next.length === 0 ? 'all' : next.join(',') })
    } else {
      const next = [...selectedTypes, typeKey]
      if (next.length === TYPE_ITEMS.length) {
        onChange({ type: 'all' })
      } else {
        onChange({ type: next.join(',') })
      }
    }
  }

  // 阅读状态对齐首页：单选互斥模式（全部 / 想读 / 在读 / 读完 / 闲置 / 弃读）
  function handleStatusClick(statusKey: ReadStatus | '') {
    onChange({ readStatus: statusKey === '' ? undefined : statusKey })
  }

  return (
    <div ref={anchorRef} className="shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        aria-label={_('library.tabSortFilter', { defaultValue: '筛选与排序' })}
        title={_('library.tabSortFilter', { defaultValue: '筛选与排序' })}
        className={cn(
          'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors cursor-pointer select-none',
          menu !== null
            ? 'border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100'
            : isFilterActive
              ? 'border-stone-300/90 bg-stone-50 text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100'
              : 'border-stone-200/90 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-800 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:text-stone-200',
        )}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2.2" />
          <circle cx="10" cy="17" r="2.2" />
        </svg>
        {isFilterActive && (
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        )}
      </button>

      {menu && (
        <SmartMenu
          innerRef={menuRef}
          triggerRef={anchorRef}
          position={menu}
          onClose={() => setMenu(null)}
          width={menuWidth}
          className="rounded-2xl border border-stone-200/80 bg-white/95 p-3 shadow-2xl shadow-stone-900/10 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/95"
        >
          <div role="menu" aria-label={_('library.tabSortFilter', { defaultValue: '筛选' })} className="flex flex-col gap-3">
            {/* 顶栏：标题与重置筛选按钮（仅在存在激活筛选时出现，且仅重置筛选，不改变排序） */}
            <div className="flex items-center justify-between pb-0.5">
              <span className="px-1 text-xs font-semibold text-stone-900 dark:text-stone-100">
                {_('library.tabSortFilter', { defaultValue: '筛选' })}
              </span>
              {isFilterActive && (
                <button
                  type="button"
                  onClick={handleReset}
                  aria-label={_('library.resetFilter', { defaultValue: '重置筛选' })}
                  title={_('library.resetFilter', { defaultValue: '重置筛选' })}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span className="sr-only">{_('library.resetFilter', { defaultValue: '重置筛选' })}</span>
                </button>
              )}
            </div>

            {/* 1. 排序 (2x2 网格，带方向翻转箭头) */}
            <div>
              <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                {_('library.sort', { defaultValue: '排序' })}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {SORT_DIMENSIONS.map((dim) => {
                  const active = params.sort === dim.descSort || params.sort === dim.ascSort
                  const isAsc = params.sort === dim.ascSort
                  return (
                    <button
                      key={dim.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => handleSortClick(dim)}
                      className={cn(
                        'flex h-7 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium transition-all cursor-pointer select-none',
                        active
                          ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                          : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                      )}
                    >
                      <span className="truncate">{_(dim.labelKey)}</span>
                      {active && (
                        <span className="text-[10px] opacity-80" aria-hidden>
                          {isAsc ? '↑' : '↓'}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 2. 记录类型 (方案 A 多选，全部为互斥主控) */}
            <div>
              <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                {_('archive.recordType', { defaultValue: '记录类型' })}
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isAllTypesActive}
                  onClick={() => onChange({ type: 'all' })}
                  className={cn(
                    'flex h-7 items-center justify-center rounded-lg text-xs font-medium transition-all cursor-pointer select-none',
                    isAllTypesActive
                      ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                      : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                  )}
                >
                  {_('archive.typeAll', { defaultValue: '全部' })}
                </button>
                {TYPE_ITEMS.map((t) => {
                  const active = selectedTypes.includes(t.key)
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={active}
                      onClick={() => handleTypeClick(t.key)}
                      className={cn(
                        'flex h-7 items-center justify-center rounded-lg text-xs font-medium transition-all cursor-pointer select-none',
                        active
                          ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                          : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                      )}
                    >
                      {_(t.labelKey)}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 3. 阅读状态 (3x2 网格，单选互斥，对齐首页) */}
            <div>
              <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                {_('library.readStatusLabel', { defaultValue: '阅读状态' })}
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['', 'wishlist', 'reading', 'finished', 'idle', 'abandoned'] as const).map((s) => {
                  const active = (params.readStatus ?? '') === s
                  return (
                    <button
                      key={s}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => handleStatusClick(s as ReadStatus | '')}
                      className={cn(
                        'flex h-7 items-center justify-center rounded-lg text-xs font-medium transition-all cursor-pointer select-none',
                        active
                          ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                          : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                      )}
                    >
                      {s === '' ? _('library.readStatusAll', { defaultValue: '全部' }) : _(READ_STATUS_KEYS[s])}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 4. 如果当前有选中的标签，提供显示和一键清除 */}
            {params.tag && (
              <div className="flex items-center justify-between rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                <span className="truncate">标签: {params.tag}</span>
                <button
                  type="button"
                  onClick={() => onChange({ tag: undefined })}
                  className="font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 cursor-pointer"
                >
                  清除
                </button>
              </div>
            )}
          </div>
        </SmartMenu>
      )}
    </div>
  )
}
