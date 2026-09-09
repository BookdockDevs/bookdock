import { useEffect, useRef, useState, type ReactNode } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { useUiStore, LIST_INFO_ITEMS, type CoverFit, type ListInfoItem, type RecentlyReadStyle } from '@/stores/ui.store'
import { cn } from '@/lib/utils'

import type { LibrarySearch } from '@/routes/index'
import type { BookFormat, ReadStatus } from '@bookdock/shared'

interface ViewMenuProps {
  navSearch: (patch: Partial<LibrarySearch>) => void
  view: string
  sortBy: string
  sortOrder: string
  format: string | null
  readStatus: string | null
}

const COLUMN_OPTIONS = ['auto', '2', '3', '4', '5', '6', '7', '8'] as const

const SORT_FIELDS: { field: string; defaultOrder: 'asc' | 'desc'; labelKey: string }[] = [
  { field: 'createdAt', defaultOrder: 'desc', labelKey: 'library.sortBy.createdAt' },
  { field: 'title', defaultOrder: 'asc', labelKey: 'library.sortBy.title' },
  { field: 'author', defaultOrder: 'asc', labelKey: 'library.sortBy.author' },
  { field: 'size', defaultOrder: 'desc', labelKey: 'library.sortBy.size' },
  { field: 'progress', defaultOrder: 'desc', labelKey: 'library.sortBy.progress' },
  { field: 'lastReadAt', defaultOrder: 'desc', labelKey: 'library.sortBy.lastRead' },
]

const menuDivider = <div className="mx-2 my-1.5 border-t border-stone-100 dark:border-stone-800" />

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

const RECENTLY_READ_STYLES: { value: RecentlyReadStyle; labelKey: string }[] = [
  { value: 'off', labelKey: 'library.recentlyReadOff' },
  { value: 'covers', labelKey: 'library.recentlyReadCovers' },
  { value: 'cards', labelKey: 'library.recentlyReadCards' },
]

const LIST_INFO_LABEL_KEYS: Record<ListInfoItem, string> = {
  progress: 'library.sortBy.progress',
  size: 'library.sortBy.size',
  lastRead: 'library.sortBy.lastRead',
  shelf: 'library.shelves',
  tags: 'library.tags',
  createdAt: 'library.sortBy.createdAt',
}

export default function ViewMenu({ navSearch, view, sortBy, sortOrder, format, readStatus }: ViewMenuProps) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const [isNarrow, setIsNarrow] = useState(false)
  const [menuTop, setMenuTop] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const coverText = useUiStore((s) => s.coverText)
  const coverFit = useUiStore((s) => s.coverFit)
  const gridColumns = useUiStore((s) => s.gridColumns)
  const recentlyReadStyle = useUiStore((s) => s.recentlyReadStyle)
  const listInfoItems = useUiStore((s) => s.listInfoItems)
  const setCoverText = useUiStore((s) => s.setCoverText)
  const setCoverFit = useUiStore((s) => s.setCoverFit)
  const setGridColumns = useUiStore((s) => s.setGridColumns)
  const setRecentlyReadStyle = useUiStore((s) => s.setRecentlyReadStyle)
  const setListInfoItems = useUiStore((s) => s.setListInfoItems)
  const setSortBy = useUiStore((s) => s.setSortBy)
  const setSortOrder = useUiStore((s) => s.setSortOrder)
  const setView = useUiStore((s) => s.setView)

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
    if (sortBy === field) {
      // Toggle direction; both the URL and the persisted preference update
      const next = sortOrder === 'asc' ? 'desc' : 'asc'
      setSortOrder(next)
      navSearch({ sortOrder: next })
    } else {
      setSortBy(field)
      setSortOrder(defaultOrder)
      navSearch({ sortBy: field, sortOrder: defaultOrder })
    }
  }

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
            'z-30 rounded-xl border border-stone-200/80 bg-white/95 p-1.5 shadow-xl shadow-stone-900/8 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95',
            isNarrow
              ? 'fixed right-3 max-h-[60dvh] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto'
              : 'absolute right-0 top-11 w-72',
          )}
          style={isNarrow && menuTop !== null ? { top: menuTop } : undefined}
        >
          <SectionLabel>{_('library.view')}</SectionLabel>
          <div className="mx-1 flex gap-1 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
            {viewOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setView(opt.value)
                  navSearch({ view: opt.value })
                }}
                className={cn(
                  'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs transition-colors',
                  view === opt.value
                    ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-700 dark:hover:text-stone-200',
                )}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {opt.icon}
                </svg>
                {opt.label}
              </button>
            ))}
          </div>

          <div className="px-2.5 pb-1 pt-1 text-[11px] text-stone-400 dark:text-stone-500">{_('library.showRecentShelf')}</div>
          <div className="mx-1 flex gap-1 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
            {RECENTLY_READ_STYLES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={recentlyReadStyle === opt.value}
                onClick={() => setRecentlyReadStyle(opt.value)}
                className={cn(
                  'h-7 flex-1 rounded-md text-xs transition-colors',
                  recentlyReadStyle === opt.value
                    ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-700 dark:hover:text-stone-200',
                )}
              >
                {_(opt.labelKey)}
              </button>
            ))}
          </div>
          {view === 'grid' && (
            <>
              <ToggleRow
                label={_('library.coverText')}
                checked={coverText}
                onChange={() => setCoverText(!coverText)}
              />
              <div className="px-2.5 pb-1 pt-1 text-[11px] text-stone-400 dark:text-stone-500">{_('library.coverFit')}</div>
              <div className="mx-1 mb-0.5 flex gap-1 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
                {COVER_FITS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={coverFit === opt.value}
                    onClick={() => setCoverFit(opt.value)}
                    className={cn(
                      'h-7 flex-1 rounded-md text-xs transition-colors',
                      coverFit === opt.value
                        ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                        : 'text-stone-500 hover:text-stone-700 dark:hover:text-stone-200',
                    )}
                  >
                    {_(opt.labelKey)}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <span className="text-[13px] text-stone-700 dark:text-stone-300">{_('library.columns')}</span>
                <select
                  value={gridColumns}
                  onChange={(e) => setGridColumns(e.target.value)}
                  className="h-7 rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-700 outline-none transition-colors hover:border-stone-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-stone-600"
                >
                  {COLUMN_OPTIONS.map((val) => (
                    <option key={val} value={val}>
                      {val === 'auto' ? _('library.columnsAuto') : val}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {view === 'list' && (
            <>
              <div className="px-2.5 pb-1 pt-1 text-[11px] text-stone-400 dark:text-stone-500">{_('library.listInfo')}</div>
              <div className="mx-1 mb-0.5 grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800">
                {LIST_INFO_ITEMS.map((item) => {
                  const active = listInfoItems.includes(item)
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setListInfoItems(
                        active
                          ? listInfoItems.filter((v) => v !== item)
                          : [...listInfoItems, item],
                      )}
                      className={cn(
                        'h-7 whitespace-nowrap rounded-md text-xs transition-colors',
                        active
                          ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                          : 'text-stone-500 hover:text-stone-700 dark:hover:text-stone-200',
                      )}
                    >
                      {_(LIST_INFO_LABEL_KEYS[item])}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {menuDivider}

          <SectionLabel>{_('library.sort')}</SectionLabel>
          <div className="mx-1 mb-0.5 grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800">
            {SORT_FIELDS.map((opt) => {
              const active = sortBy === opt.field
              return (
                <button
                  key={opt.field}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleSort(opt.field, opt.defaultOrder)}
                  className={cn(
                    'flex h-7 items-center justify-center gap-0.5 rounded-md text-xs transition-colors',
                    active
                      ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                      : 'text-stone-500 hover:text-stone-700 dark:hover:text-stone-200',
                  )}
                >
                  {_(opt.labelKey)}
                  {active && (
                    <span className="text-stone-400 dark:text-stone-500" aria-hidden>
                      {sortOrder === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {menuDivider}

          <SectionLabel>{_('library.filter')}</SectionLabel>
          <div className="mx-1 mb-1.5 flex gap-1 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800">
            {(['', 'epub', 'txt'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => navSearch({ format: f === '' ? undefined : f as BookFormat })}
                className={cn(
                  'h-7 flex-1 rounded-md text-xs transition-colors',
                  (format ?? '') === f
                    ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-700 dark:hover:text-stone-200',
                )}
              >
                {f === '' ? _('library.formatAll') : f === 'epub' ? 'EPUB' : 'TXT'}
              </button>
            ))}
          </div>
          <div className="mx-1 mb-0.5 grid grid-cols-4 gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800">
            {(['', 'wishlist', 'reading', 'finished', 'idle', 'abandoned'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => navSearch({ status: s === '' ? undefined : s as ReadStatus })}
                className={cn(
                  'h-7 whitespace-nowrap rounded-md text-xs transition-colors',
                  (readStatus ?? '') === s
                    ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                    : 'text-stone-500 hover:text-stone-700 dark:hover:text-stone-200',
                )}
              >
                {s === '' ? _('library.readStatusAll') : _(STATUS_FILTER_KEYS[s])}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500">
      {children}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between px-2.5 py-1.5">
      <span className="text-[13px] text-stone-700 dark:text-stone-300">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-stone-900 dark:bg-stone-100' : 'bg-stone-200 dark:bg-stone-700',
        )}
      >
        <span className={cn(
          'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform dark:bg-stone-900',
          checked && 'translate-x-4',
        )} />
      </button>
    </div>
  )
}
