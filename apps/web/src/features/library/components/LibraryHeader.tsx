import { useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

import { useLibraryState, type LibraryView } from '../state/library-state'

interface LibraryHeaderProps {
  onUploadClick: () => void
  trash?: boolean
  trashCount?: number
  onEmptyTrash?: () => void
}

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'createdAt-desc', label: t().library.sortBy.newest },
  { value: 'createdAt-asc', label: t().library.sortBy.oldest },
  { value: 'title-asc', label: t().library.sortBy.titleAsc },
  { value: 'title-desc', label: t().library.sortBy.titleDesc },
  { value: 'author-asc', label: t().library.sortBy.authorAsc },
  { value: 'size-asc', label: t().library.sortBy.sizeAsc },
  { value: 'size-desc', label: t().library.sortBy.sizeDesc },
]

export default function LibraryHeader({ onUploadClick, trash = false, trashCount = 0, onEmptyTrash }: LibraryHeaderProps) {
  const { view, setView, search, setSearch } = useLibraryState()

  return (
    <div className="mb-8 flex items-center justify-between gap-4">
      <div className="relative min-w-0 flex-1 max-w-md">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t().library.searchPlaceholder}
          className="h-9 w-full appearance-none rounded-lg border border-stone-200 bg-white pl-9 pr-3 text-sm text-stone-700 outline-none placeholder:text-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <ViewToggle current={view} onChange={setView} />

        <FilterPanel />

        {trash ? (
          trashCount > 0 && (
            <Button variant="danger" onClick={onEmptyTrash}>{t().library.emptyTrash}</Button>
          )
        ) : (
          <Button onClick={onUploadClick}>{t().library.upload}</Button>
        )}
      </div>
    </div>
  )
}

function FilterPanel() {
  const { sortBy, sortOrder, setSort, format, setFormat } = useLibraryState()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const isActive = Boolean(format) || sortBy !== 'createdAt' || sortOrder !== 'desc'

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const formatOptions: { value: '' | 'epub' | 'txt'; label: string }[] = [
    { value: '', label: t().library.formatAll },
    { value: 'epub', label: 'EPUB' },
    { value: 'txt', label: 'TXT' },
  ]

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        aria-label={t().library.filter}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
          open
            ? 'border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100'
            : 'border-stone-200 text-stone-400 hover:text-stone-700 dark:border-stone-800 dark:hover:text-stone-200',
        )}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        {isActive && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-20 w-52 rounded-xl border border-stone-200 bg-white p-3 shadow-lg dark:border-stone-700 dark:bg-stone-900">
          <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-stone-400">
            {t().library.format}
          </div>
          <div className="mb-3 flex gap-1">
            {formatOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFormat(opt.value === '' ? null : opt.value)}
                className={cn(
                  'h-7 flex-1 rounded-md text-xs transition-colors',
                  (format ?? '') === opt.value
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-stone-400">
            {t().library.sort}
          </div>
          <div className="flex flex-col">
            {SORT_OPTIONS.map((opt) => {
              const active = `${sortBy}-${sortOrder}` === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    const [by, order] = opt.value.split('-')
                    setSort(by, order)
                  }}
                  className={cn(
                    'rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                    active
                      ? 'font-medium text-stone-900 dark:text-stone-100'
                      : 'text-stone-500 hover:bg-stone-50 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-200',
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function ViewToggle({ current, onChange }: { current: LibraryView; onChange: (v: LibraryView) => void }) {
  const base = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors'
  const active = 'border-stone-300 bg-stone-100 text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100'
  const idle = 'border-stone-200 text-stone-400 hover:text-stone-700 dark:border-stone-800 dark:hover:text-stone-200'
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="网格视图"
        className={`${base} ${current === 'grid' ? active : idle}`}
        onClick={() => onChange('grid')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="列表视图"
        className={`${base} ${current === 'list' ? active : idle}`}
        onClick={() => onChange('list')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      </button>
    </div>
  )
}