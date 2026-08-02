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
  title?: string
  bookCount?: number
}

export default function LibraryHeader({ navSearch, view, query, sortBy, sortOrder, format, readStatus, onUploadClick, trash = false, trashCount = 0, onEmptyTrash, selectionActive = false, onToggleSelectMode, title, bookCount }: LibraryHeaderProps) {
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
    <header className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-2xl font-semibold text-stone-900 dark:text-stone-50">
            {title ?? _('library.allBooks')}
          </h1>
          {bookCount !== undefined && (
            <p className="mt-1 text-xs tabular-nums text-stone-400 dark:text-stone-500">
              {_('library.bookCount', { count: bookCount })}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative min-w-40 flex-1 sm:max-w-64">
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

          {!trash && onToggleSelectMode && (
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

          <ViewMenu
            navSearch={navSearch}
            view={view}
            sortBy={sortBy}
            sortOrder={sortOrder}
            format={format}
            readStatus={readStatus}
          />

          {trash ? (
            trashCount > 0 && (
              <Button variant="danger" onClick={onEmptyTrash}>{_('library.emptyTrash')}</Button>
            )
          ) : (
            <Button onClick={onUploadClick}>{_('library.upload')}</Button>
          )}
        </div>
      </div>
    </header>
  )
}
