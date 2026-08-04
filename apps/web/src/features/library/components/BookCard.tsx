import { memo } from 'react'

import type { BookListItem } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import SmartMenu from '@/components/ui/SmartMenu'

import BookCover from './BookCover'
import { useContextMenu } from './use-context-menu'
import { ContextMenuContent } from './BookContextMenu'

interface BookCardProps {
  book: BookListItem
  selected?: boolean
  selectionActive?: boolean
  coverMode?: boolean
  onToggleSelect?: (id: string, shiftKey?: boolean) => void
  onDelete?: (book: BookListItem) => void
  onShowDetails?: (book: BookListItem) => void
  onRestore?: (book: BookListItem) => void
  onPermanentDelete?: (book: BookListItem) => void
}

const MENU_W = 184
const MENU_H = 250

const BookCard = memo(function BookCard({ book, selected = false, selectionActive = false, coverMode = false, onToggleSelect, onDelete, onShowDetails, onRestore, onPermanentDelete }: BookCardProps) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const trashCard = Boolean(onRestore && onPermanentDelete)
  const showMenu = !trashCard
  const selectable = !!onToggleSelect

  function handleContextMenu(e: React.MouseEvent) {
    if (!showMenu) return
    e.preventDefault()
    e.stopPropagation()
    menu.openFromEvent(e)
  }

  function handleClick(e: React.MouseEvent) {
    if (!selectable) return
    if (e.ctrlKey || e.metaKey || selectionActive) {
      e.preventDefault()
      e.stopPropagation()
      onToggleSelect(book.id, e.shiftKey)
    }
  }

  function handleMenuClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    menu.openFromButton()
  }

  return (
    <article
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={`group relative flex min-w-0 flex-col gap-1.5 ${selectable ? 'cursor-pointer' : ''}`}
    >
      <div className="relative rounded-xl transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-stone-900/10 dark:group-hover:shadow-black/40">
        <BookCover book={book} />
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-stone-900/10 dark:ring-white/10" />
        {!selectionActive && book.pinnedAt && (
          <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
              </svg>
            </span>
          </div>
        )}
        {selected && (
          <div className="absolute inset-0 z-10 rounded-xl bg-stone-900/20 ring-2 ring-stone-900 dark:bg-black/40 dark:ring-stone-100" />
        )}
        {selectable && selectionActive && (
          <div className={`absolute left-1.5 top-1.5 z-20 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors ${
            selected
              ? 'border-stone-900 bg-stone-900 dark:border-stone-100 dark:bg-stone-100'
              : 'border-white/80 bg-black/25 backdrop-blur-sm'
          }`}>
            {selected && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-stone-900">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        )}
        {!coverMode && book.progress != null && book.progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-xl bg-black/25 backdrop-blur-sm">
            <div className="h-full rounded-b-xl bg-white/95 transition-all" style={{ width: `${book.progress}%` }} />
          </div>
        )}
        {showMenu && (
          <div className={`absolute right-1.5 top-1.5 z-10 transition-opacity duration-150 ${menu.open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <button
              ref={menu.btnRef}
              type="button"
              onClick={handleMenuClick}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
              aria-label={_('library.moreActions')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </div>
        )}
        {trashCard && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2.5 rounded-b-xl bg-gradient-to-t from-black/70 via-black/40 to-transparent p-2.5 pt-8 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <button
              type="button"
              aria-label={_('library.restore')}
              title={_('library.restore')}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRestore?.(book)
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-stone-700 backdrop-blur-sm transition-colors hover:bg-white hover:text-emerald-600"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
            <button
              type="button"
              aria-label={_('library.permanentDelete')}
              title={_('library.permanentDelete')}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onPermanentDelete?.(book)
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-stone-700 backdrop-blur-sm transition-colors hover:bg-red-500 hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {!coverMode && (
        <div className="min-w-0 px-0.5">
          <h3 className="truncate font-serif text-[13px] font-medium leading-snug text-stone-900 dark:text-stone-100">
            {book.title}
          </h3>
          {book.author && (
            <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{book.author}</p>
          )}
        </div>
      )}

      {showMenu && menu.open && (
        <SmartMenu
          innerRef={menu.menuRef}
          position={menu.position(MENU_W, MENU_H)}
          width={MENU_W}
          onClose={menu.close}
        >
          <ContextMenuContent book={book} onShowDetails={onShowDetails} onDelete={onDelete} onClose={menu.close} />
        </SmartMenu>
      )}
    </article>
  )
})

export default BookCard
