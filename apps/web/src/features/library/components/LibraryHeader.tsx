import { useEffect, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { Button } from '@/components/ui/Button'

import type { LibrarySearch } from '@/routes/index'

import ViewMenu from './ViewMenu'

interface LibraryHeaderProps {
  navSearch: (patch: Partial<LibrarySearch>) => void
  view: string
  query: string
  sortBy: string
  sortOrder: string
  format: string | null
  readStatus: string | null
  onUploadClick: () => void
  trash?: boolean
  trashCount?: number
  onEmptyTrash?: () => void
  selectionActive?: boolean
  onToggleSelectMode?: () => void
  onOpenNavigation?: () => void
  title?: string
  bookCount?: number
  onResetMetadataFilter?: () => void
}

export default function LibraryHeader({ navSearch, view, query, sortBy, sortOrder, format, readStatus, onUploadClick, trash = false, trashCount = 0, onEmptyTrash, selectionActive = false, onToggleSelectMode, onOpenNavigation, title, bookCount, onResetMetadataFilter }: LibraryHeaderProps) {
  const _ = useTranslation()
  const [searchInput, setSearchInput] = useState(query)

  // Sync the input when the URL query changes externally (e.g. cleared filters)
  useEffect(() => {
    setSearchInput(query)
  }, [query])

  // Debounce navigation so each keystroke does not re-render the whole tree
  useEffect(() => {
    if (searchInput === query) return
    const id = setTimeout(() => navSearch({ q: searchInput || undefined }), 250)
    return () => clearTimeout(id)
  }, [searchInput, query, navSearch])

  return (
    <header className="mb-6 md:mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3 md:items-end md:gap-x-6 md:gap-y-4">
        <div className="flex w-full min-w-0 items-center gap-2 md:w-auto md:flex-none">
          {onOpenNavigation && (
            <button
              type="button"
              aria-label={_('library.openNavigation')}
              title={_('library.openNavigation')}
              onClick={onOpenNavigation}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-700 dark:hover:text-stone-100 md:hidden"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-serif text-2xl font-semibold text-stone-900 dark:text-stone-50">
              {title ?? _('library.allBooks')}
            </h1>
            {(bookCount !== undefined || onResetMetadataFilter) && (
              <div className="mt-1 flex items-center gap-4">
                {bookCount !== undefined && (
                  <p className="text-xs tabular-nums text-stone-400 dark:text-stone-500">
                    {_('library.bookCount', { count: bookCount })}
                  </p>
                )}
                {onResetMetadataFilter && (
                  <button
                    type="button"
                    onClick={onResetMetadataFilter}
                    className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                    {_('library.resetFilter')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-1 flex-wrap items-center justify-end gap-2 md:w-auto">
          {!trash && (
            <div className="relative min-w-0 flex-1 sm:min-w-48 sm:max-w-72 md:max-w-80">
              <svg
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
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
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={_('library.searchPlaceholder')}
                className="h-10 w-full appearance-none rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-sm text-stone-700 outline-none transition-all placeholder:text-stone-400 focus:border-stone-400 focus:ring-4 focus:ring-stone-900/5 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-600 dark:focus:ring-white/5"
              />
            </div>
          )}

          {onToggleSelectMode && (
            <button
              type="button"
              aria-label={_('library.selectMode')}
              aria-pressed={selectionActive}
              title={_('library.selectMode')}
              onClick={onToggleSelectMode}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
                selectionActive
                  ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                  : 'border-stone-200 bg-white text-stone-400 hover:border-stone-300 hover:text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </button>
          )}

          {!trash && (
            <ViewMenu
              navSearch={navSearch}
              view={view}
              sortBy={sortBy}
              sortOrder={sortOrder}
              format={format}
              readStatus={readStatus}
            />
          )}

          {trash ? (
            trashCount > 0 && (
              <button
                type="button"
                aria-label={_('library.emptyTrash')}
                title={_('library.emptyTrash')}
                onClick={onEmptyTrash}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-red-200 bg-white text-red-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-red-900/50 dark:bg-stone-900 dark:text-red-400 dark:hover:border-red-800 dark:hover:bg-red-950/40 dark:hover:text-red-300"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </button>
            )
          ) : (
            <Button onClick={onUploadClick}>{_('library.upload')}</Button>
          )}
        </div>
      </div>
    </header>
  )
}
