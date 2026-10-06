import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { toggleRevealHidden } from '@/lib/reveal-hidden'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { GRID_CARD_FIELDS, type GridCardField } from '@bookdock/shared'

import {
  useUiStore,
  LIST_INFO_ITEMS,
  LIBRARY_PAGE_SIZES,
  type CoverFit,
  type ListInfoItem,
} from '@/stores/ui.store'
import { useAuthStore } from '@/stores/auth.store'
import { cn } from '@/lib/utils'

import type { LibrarySearch } from '@/routes/index'
import type { BookFormat, BookSortPrefField, ReadStatus } from '@bookdock/shared'

import { useLibraryPrefs, useUpdateLibraryPrefs } from '../hooks'

interface ViewMenuProps {
  navSearch: (patch: Partial<LibrarySearch>) => void
  view: string
  sortBy: string
  sortOrder: string
  format: string | null
  readStatus: string | null
  trash?: boolean
  /**
   * A shared library's catalog is the same list, minus the dimensions that only
   * exist for books someone owns: per-user read status, progress and last-read
   * sorting. Offering them there would be a filter the server cannot honour.
   */
  catalogMode?: boolean
  canSwitchCategoryScope?: boolean
  categoryScope?: LibrarySearch['categoryScope']
  defaultTab?: 'sortFilter' | 'viewLayout'
}

const COLUMN_OPTIONS = ['auto', '2', '3', '4', '6', '8'] as const

const SORT_FIELDS: { field: string; defaultOrder: 'asc' | 'desc'; labelKey: string }[] = [
  { field: 'lastReadAt', defaultOrder: 'desc', labelKey: 'library.sortBy.lastRead' },
  { field: 'createdAt', defaultOrder: 'desc', labelKey: 'library.sortBy.createdAt' },
  { field: 'progress', defaultOrder: 'desc', labelKey: 'library.sortBy.progress' },
  { field: 'title', defaultOrder: 'asc', labelKey: 'library.sortBy.title' },
  { field: 'author', defaultOrder: 'asc', labelKey: 'library.sortBy.author' },
  { field: 'size', defaultOrder: 'desc', labelKey: 'library.sortBy.size' },
]

/** The same list without the two per-user keys; see catalogMode. */
const CATALOG_SORT_FIELDS: { field: string; defaultOrder: 'asc' | 'desc'; labelKey: string }[] = [
  { field: 'createdAt', defaultOrder: 'desc', labelKey: 'library.sortBy.createdAt' },
  { field: 'title', defaultOrder: 'asc', labelKey: 'library.sortBy.title' },
  { field: 'author', defaultOrder: 'asc', labelKey: 'library.sortBy.author' },
  { field: 'size', defaultOrder: 'desc', labelKey: 'library.sortBy.size' },
]

const TRASH_SORT_FIELDS: { field: string; defaultOrder: 'asc' | 'desc'; labelKey: string }[] = [
  { field: 'deletedAt', defaultOrder: 'desc', labelKey: 'library.sortBy.deletedAt' },
  { field: 'title', defaultOrder: 'asc', labelKey: 'library.sortBy.title' },
  { field: 'author', defaultOrder: 'asc', labelKey: 'library.sortBy.author' },
  { field: 'size', defaultOrder: 'desc', labelKey: 'library.sortBy.size' },
]

const STATUS_FILTER_KEYS: Record<ReadStatus, string> = {
  wishlist: 'library.readStatusWishlist',
  reading: 'library.readStatusReading',
  idle: 'library.readStatusIdle',
  finished: 'library.readStatusFinished',
  abandoned: 'library.readStatusAbandoned',
}

const COVER_FITS: { value: CoverFit; labelKey: string }[] = [
  { value: 'crop', labelKey: 'library.coverFitCrop' },
  { value: 'full', labelKey: 'library.coverFitFull' },
]

const GRID_CARD_FIELD_LABEL_KEYS: Record<GridCardField, string> = {
  title: 'library.gridCardTitle',
  author: 'library.gridCardAuthor',
  progress: 'library.gridCardProgress',
}
const CATALOG_GRID_CARD_FIELDS: GridCardField[] = ['title', 'author']
const DEFAULT_GRID_CARD_FIELDS: GridCardField[] = ['title', 'author', 'progress']

const LIST_INFO_LABEL_KEYS: Record<ListInfoItem, string> = {
  progress: 'library.sortBy.progress',
  size: 'library.sortBy.size',
  lastRead: 'library.sortBy.lastRead',
  shelf: 'library.shelves',
  tags: 'library.tags',
  createdAt: 'library.sortBy.createdAt',
}

export default function ViewMenu({
  navSearch,
  view,
  sortBy,
  sortOrder,
  format,
  readStatus,
  trash = false,
  catalogMode = false,
  canSwitchCategoryScope = false,
  categoryScope,
  defaultTab = 'sortFilter',
}: ViewMenuProps) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const [isNarrow, setIsNarrow] = useState(false)
  const [menuTop, setMenuTop] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const coverFit = useUiStore((s) => s.coverFit)
  const gridColumns = useUiStore((s) => s.gridColumns)
  const libraryPageSize = useUiStore((s) => s.libraryPageSize)
  const listInfoItems = useUiStore((s) => s.listInfoItems)
  const setCoverFit = useUiStore((s) => s.setCoverFit)
  const setGridColumns = useUiStore((s) => s.setGridColumns)
  const setLibraryPageSize = useUiStore((s) => s.setLibraryPageSize)
  const setListInfoItems = useUiStore((s) => s.setListInfoItems)
  const setSortBy = useUiStore((s) => s.setSortBy)
  const setSortOrder = useUiStore((s) => s.setSortOrder)
  const setView = useUiStore((s) => s.setView)
  const revealHidden = useUiStore((s) => s.revealHidden)
  const user = useAuthStore((s) => s.user)
  const isGuest = !user
  const updateLibraryPrefs = useUpdateLibraryPrefs()
  const libraryPrefs = useLibraryPrefs()
  const gridCardFields = libraryPrefs?.gridCardFields ?? DEFAULT_GRID_CARD_FIELDS

  // Non-guest defaults live in per-user server settings (N-06); guests cannot
  // persist them, so they keep the device-local ui.store layer.
  function persistSort(field: string, dir: 'asc' | 'desc') {
    if (isGuest) {
      setSortBy(field)
      setSortOrder(dir)
    } else {
      updateLibraryPrefs.mutate({ bookSort: { field: field as BookSortPrefField, dir } })
    }
  }

  function persistView(v: 'grid' | 'list') {
    if (isGuest) setView(v)
    else updateLibraryPrefs.mutate({ view: v })
  }

  // Private-vault reveal (device-local, placeholder for the future vault
  // entry): a standing preference like view mode, not a filter — no menu
  // indicator, no reset. The taxonomy/book queries keep stable keys and read
  // the flag at fetch time, so the toggle invalidates them explicitly.
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const update = () => setIsNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open || !isNarrow) return
    const update = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (rect) setMenuTop(rect.bottom + 8)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, isNarrow])

  const isFilterActive = Boolean(format) || Boolean(readStatus)
  function handleSort(field: string, defaultOrder: 'asc' | 'desc') {
    // Trash sorting is ephemeral: it must not overwrite the library-wide preference
    if (sortBy === field) {
      const next = sortOrder === 'asc' ? 'desc' : 'asc'
      if (!trash) persistSort(field, next)
      navSearch({ sortOrder: next })
    } else {
      if (!trash) persistSort(field, defaultOrder)
      navSearch({ sortBy: field, sortOrder: defaultOrder })
    }
  }

  const sortFields = trash ? TRASH_SORT_FIELDS : (catalogMode ? CATALOG_SORT_FIELDS : SORT_FIELDS)
  const availableGridCardFields = catalogMode ? CATALOG_GRID_CARD_FIELDS : GRID_CARD_FIELDS

  // A shared library's row is a work: it has no reading state, but it does have
  // a category, tags, a size and a date it was added. Offering exactly the
  // columns a row can fill is what keeps this menu the same menu in both
  // libraries; progress and last-read stay private-only for lack of data.
  const CATALOG_LIST_INFO: ListInfoItem[] = ['shelf', 'tags', 'size', 'createdAt']
  const availableListInfo = catalogMode ? CATALOG_LIST_INFO : LIST_INFO_ITEMS

  const viewOptions: { value: 'grid' | 'list'; label: string; icon: ReactNode }[] = [
    {
      value: 'grid',
      label: _('library.viewGrid'),
      icon: (
        <>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
      ),
    },
    {
      value: 'list',
      label: _('library.viewList'),
      icon: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
    },
  ]

  const [activeTab, setActiveTab] = useState<'sortFilter' | 'viewLayout'>(defaultTab)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        ref={buttonRef}
        aria-label={_('library.viewMenu')}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors',
          open
            ? 'border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100'
            : 'border-stone-200 bg-white text-stone-400 hover:border-stone-300 hover:text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 dark:hover:text-stone-200',
        )}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2.2" />
          <circle cx="10" cy="17" r="2.2" />
        </svg>
        {isFilterActive && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        )}
      </button>

      {open && (
        <div
          className={cn(
            'z-30 rounded-2xl border border-stone-200/80 bg-white/95 p-3 shadow-2xl shadow-stone-900/10 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/95',
            isNarrow
              ? 'fixed right-3 max-h-[75dvh] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto custom-scrollbar [scrollbar-gutter:stable]'
              : 'absolute right-0 top-11 w-80',
          )}
          style={isNarrow && menuTop !== null ? { top: menuTop } : undefined}
        >
          {/* Top Bar with Tab Capsule and Quick Reset */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex flex-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
              <button
                type="button"
                onClick={() => setActiveTab('sortFilter')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all',
                  activeTab === 'sortFilter'
                    ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
                )}
              >
                <span>{_('library.tabSortFilter')}</span>
                {isFilterActive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('viewLayout')}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all',
                  activeTab === 'viewLayout'
                    ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
                )}
              >
                <span>{_('library.tabViewAppearance')}</span>
              </button>
            </div>
            {isFilterActive && activeTab === 'sortFilter' && (
              <button
                type="button"
                onClick={() => navSearch({ format: undefined, status: undefined })}
                aria-label={_('library.resetFilter')}
                title={_('library.resetFilter')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-stone-100/80 text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                <span className="sr-only">{_('library.resetFilter')}</span>
              </button>
            )}
          </div>

          {activeTab === 'sortFilter' && (
            <div>
              {/* Sort Fields */}
              <div className="mb-3">
                <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                  {_('library.sort')}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {sortFields.map((opt) => {
                    const active = sortBy === opt.field
                    return (
                      <button
                        key={opt.field}
                        type="button"
                        aria-pressed={active}
                        onClick={() => handleSort(opt.field, opt.defaultOrder)}
                        className={cn(
                          'flex h-7 items-center justify-center gap-1 rounded-lg text-xs font-medium transition-all',
                          active
                            ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                            : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                        )}
                      >
                        <span>{_(opt.labelKey)}</span>
                        {active && (
                          <span className="text-[10px] opacity-80" aria-hidden>
                            {sortOrder === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {!trash && (
                <>
                  {/* Format Filter */}
                  <div className="mb-3">
                    <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                      {_('library.format')}
                    </div>
                    <div className="flex gap-1.5">
                      {(['', 'epub', 'txt'] as const).map((f) => {
                        const active = (format ?? '') === f
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => navSearch({ format: f === '' ? undefined : (f as BookFormat) })}
                            className={cn(
                              'flex h-7 flex-1 items-center justify-center rounded-lg text-xs font-medium transition-all',
                              active
                                ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                                : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                            )}
                          >
                            {f === '' ? _('library.formatAll') : f === 'epub' ? 'EPUB' : 'TXT'}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Read Status Filter */}
                  {!catalogMode && (
                    <div>
                      <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                        {_('library.readStatusLabel')}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['', 'wishlist', 'reading', 'finished', 'idle', 'abandoned'] as const).map((s) => {
                          const active = (readStatus ?? '') === s
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => navSearch({ status: s === '' ? undefined : (s as ReadStatus) })}
                              className={cn(
                                'flex h-7 items-center justify-center rounded-lg text-xs font-medium transition-all',
                                active
                                  ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                                  : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                              )}
                            >
                              {s === '' ? _('library.readStatusAll') : _(STATUS_FILTER_KEYS[s])}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Both scope and hidden-content preferences stay outside filter indicators and reset. */}
                  {(catalogMode ? canSwitchCategoryScope : !isGuest) && (
                    <div className="mt-3 border-t border-stone-100 pt-3 dark:border-stone-800">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={catalogMode ? categoryScope !== 'direct' : revealHidden}
                        onClick={() => {
                          if (catalogMode) navSearch({ categoryScope: categoryScope === 'direct' ? 'subtree' : 'direct' })
                          else void toggleRevealHidden().catch((error) => notify.error(getUserErrorNotification(error)))
                        }}
                        className="flex w-full items-center justify-between gap-2 px-1 py-1 text-left"
                      >
                        <span className="truncate text-xs font-medium text-stone-600 dark:text-stone-300">{_(catalogMode ? 'library.includeSubcategories' : 'library.showHiddenContent')}</span>
                        <span className={cn(
                          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                          (catalogMode ? categoryScope !== 'direct' : revealHidden) ? 'bg-stone-900 dark:bg-stone-100' : 'bg-stone-300 dark:bg-stone-700',
                        )}>
                          <span className={cn(
                            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all dark:bg-stone-900',
                            (catalogMode ? categoryScope !== 'direct' : revealHidden) ? 'left-[18px]' : 'left-0.5',
                          )} />
                        </span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === 'viewLayout' && (
            <div>
              {/* View Mode (Grid vs List) */}
              <div className="mb-3">
                <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                  {_('library.view')}
                </div>
                <div className="flex gap-1.5">
                  {viewOptions.map((opt) => {
                    const active = view === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          persistView(opt.value)
                          navSearch({ view: opt.value })
                        }}
                        className={cn(
                          'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all',
                          active
                            ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                            : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                        )}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {opt.icon}
                        </svg>
                        <span>{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {view === 'grid' && (
                <>
                  {/* Columns */}
                  <div className="mb-3">
                    <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                      {_('library.columns')}
                    </div>
                    <div className="flex gap-1">
                      {COLUMN_OPTIONS.map((val) => {
                        const active = gridColumns === val
                        return (
                          <button
                            key={val}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setGridColumns(val)}
                            className={cn(
                              'flex h-7 items-center justify-center rounded-lg text-xs transition-all',
                              val === 'auto' ? 'px-2 shrink-0 font-medium' : 'flex-1 font-mono font-medium',
                              active
                                ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                                : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                            )}
                          >
                            {val === 'auto' ? _('library.columnsAuto') : val}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Page Size (Grid) */}
                  {!trash && (
                    <div className="mb-3">
                      <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                        {_('library.pageSize')}
                      </div>
                      <div className="flex gap-1">
                        {LIBRARY_PAGE_SIZES.map((size) => {
                          const active = libraryPageSize === size
                          return (
                            <button
                              key={size}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setLibraryPageSize(size)}
                              className={cn(
                                'flex h-7 flex-1 items-center justify-center rounded-lg font-mono text-xs font-medium transition-all',
                                active
                                  ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                                  : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                              )}
                            >
                              {size}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Cover Fit */}
                  <div className="mb-3">
                    <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                      {_('library.coverFit')}
                    </div>
                    <div className="flex gap-1">
                      {COVER_FITS.map((opt) => {
                        const active = coverFit === opt.value
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setCoverFit(opt.value)}
                            className={cn(
                              'flex h-7 flex-1 items-center justify-center rounded-lg text-xs font-medium transition-all',
                              active
                                ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                                : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                            )}
                          >
                            {_(opt.labelKey)}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Card Info Fields */}
                  {!trash && (
                    <div className="mb-1">
                      <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                        {_('library.gridCardFields')}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {availableGridCardFields.map((field) => {
                          const active = gridCardFields.includes(field)
                          return (
                            <button
                              key={field}
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                updateLibraryPrefs.mutate({
                                  gridCardFields: active
                                    ? gridCardFields.filter((f) => f !== field)
                                    : [...gridCardFields, field],
                                })
                              }
                              className={cn(
                                'flex h-7 items-center justify-center rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                                active
                                  ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                                  : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                              )}
                            >
                              {_(GRID_CARD_FIELD_LABEL_KEYS[field])}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {view === 'list' && !trash && (
                <>
                  {(!catalogMode || availableListInfo.length > 0) && (
                    <div className="mb-3">
                      <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                        {_('library.listInfo')}
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {availableListInfo.map((item) => {
                          const active = listInfoItems.includes(item)
                          return (
                            <button
                              key={item}
                              type="button"
                              aria-pressed={active}
                              onClick={() =>
                                setListInfoItems(
                                  active
                                    ? listInfoItems.filter((v) => v !== item)
                                    : [...listInfoItems, item],
                                )
                              }
                              className={cn(
                                'flex h-7 items-center justify-center rounded-lg text-xs font-medium transition-all whitespace-nowrap',
                                active
                                  ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                                  : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                              )}
                            >
                              {_(catalogMode && item === 'shelf' ? 'library.categories' : LIST_INFO_LABEL_KEYS[item])}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="mb-1">
                    <div className="mb-1.5 px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                      {_('library.pageSize')}
                    </div>
                    <div className="flex gap-1">
                      {LIBRARY_PAGE_SIZES.map((size) => {
                        const active = libraryPageSize === size
                        return (
                          <button
                            key={size}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setLibraryPageSize(size)}
                            className={cn(
                              'flex h-7 flex-1 items-center justify-center rounded-lg font-mono text-xs font-medium transition-all',
                              active
                                ? 'bg-stone-900 text-white shadow-xs dark:bg-stone-100 dark:text-stone-900'
                                : 'bg-stone-100/80 text-stone-600 hover:bg-stone-200/70 hover:text-stone-900 dark:bg-stone-800/70 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                            )}
                          >
                            {size}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
