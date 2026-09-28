import { memo } from 'react'

import type { BookListItem } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import SmartMenu from '@/components/ui/SmartMenu'

import { privateBookRow } from '../book-row'
import BookCardShell from './BookCardShell'
import { useContextMenu } from './use-context-menu'
import { ContextMenuContent } from './BookContextMenu'
import TrashInfo from './TrashInfo'
import UnpinButton, { PinIcon } from './UnpinButton'

import type { GridCardField } from '@/stores/ui.store'

interface BookCardProps {
  book: BookListItem
  selected?: boolean
  selectionActive?: boolean
  gridCardFields?: GridCardField[]
  coverText?: boolean
  readOnly?: boolean
  onToggleSelect?: (id: string, shiftKey?: boolean) => void
  onDelete?: (book: BookListItem) => void
  onPublish?: (book: BookListItem) => void
  onShowDetails?: (book: BookListItem) => void
  onRestore?: (book: BookListItem) => void
  onPermanentDelete?: (book: BookListItem) => void
}

const MENU_W = 184
const MENU_H = 300

/**
 * A book the reader owns. This is the shared card plus the things only a book
 * someone owns can do: be pinned, be trashed and restored, be deleted, and open
 * the context menu whose actions all address that ownership.
 */
const BookCard = memo(function BookCard({ book, selected = false, selectionActive = false, gridCardFields, coverText = true, readOnly = false, onToggleSelect, onDelete, onPublish, onShowDetails, onRestore, onPermanentDelete }: BookCardProps) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const trashCard = Boolean(onRestore && onPermanentDelete)
  const showMenu = !trashCard

  function handleContextMenu(e: React.MouseEvent) {
    if (!showMenu) return
    e.preventDefault()
    e.stopPropagation()
    menu.openFromEvent(e)
  }

  function handleMenuClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    menu.toggleFromButton()
  }

  return (
    <>
      <BookCardShell
        row={privateBookRow(book)}
        gridCardFields={gridCardFields}
        coverText={coverText}
        selected={selected}
        selectionActive={selectionActive}
        onToggleSelect={onToggleSelect}
        pinAffordance={book.pinnedAt ? (
          <div className="absolute left-1.5 top-1.5 z-10 transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100">
            <UnpinButton
              bookId={book.id}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
            >
              <PinIcon size={12} />
            </UnpinButton>
          </div>
        ) : undefined}
        trashCard={trashCard}
        onRestore={onRestore ? () => onRestore(book) : undefined}
        onPermanentDelete={onPermanentDelete ? () => onPermanentDelete(book) : undefined}
        onContextMenu={handleContextMenu}
        coverOverlay={trashCard ? (
          <div className="pointer-events-none absolute right-1.5 top-1.5 z-10">
            <TrashInfo book={book} variant="pill" />
          </div>
        ) : undefined}
        infoFooter={book.sourceUnavailable ? (
          /* 7.7: a collected card whose source is gone says so here; the
             reader is the authority, this just avoids a dead click. */
          <p className="mt-0.5 truncate text-[11px] text-amber-600 dark:text-amber-400">
            {_('library.sourceUnavailable')}
          </p>
        ) : undefined}
        menu={showMenu ? (
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
        ) : undefined}
      />
      {showMenu && menu.open && (
        <SmartMenu
          triggerRef={menu.btnRef}
          innerRef={menu.menuRef}
          position={menu.position(MENU_W, MENU_H)}
          width={MENU_W}
          onClose={menu.close}
        >
          <ContextMenuContent book={book} readOnly={readOnly} onShowDetails={onShowDetails} onPublish={onPublish} onDelete={onDelete} onClose={menu.close} />
        </SmartMenu>
      )}
    </>
  )
})

export default BookCard
