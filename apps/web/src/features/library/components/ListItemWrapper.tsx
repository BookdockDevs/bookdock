import { useDraggable } from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'

import type { BookListItem } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { formatAuthorList } from '@/lib/utils'

import type { BookDragPayload } from '../dnd'
import BookCover from './BookCover'
import HiddenIndicator from './HiddenIndicator'
import { ContextMenuContent } from './BookContextMenu'
import ListItemInfo from './ListItemInfo'
import { SelectionCheck } from './RowChrome'
import UnpinButton, { PinIcon } from './UnpinButton'
import { useContextMenu } from './use-context-menu'

interface ListItemWrapperProps {
  book: BookListItem
  selection: Set<string>
  selectionActive: boolean
  dragJustEndedRef: React.MutableRefObject<boolean>
  readOnly: boolean
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onDelete?: (b: BookListItem) => void
  onPublish?: (b: BookListItem) => void
  onShowDetails: (b: BookListItem) => void
}

/**
 * A private book's row in list view. Drag listeners span the row while the
 * cover thumbnail is the measuring node, so the preview follows the cursor.
 */
export default function ListItemWrapper({ book, selection, selectionActive, dragJustEndedRef, onToggleSelect, readOnly, onDelete, onPublish, onShowDetails }: ListItemWrapperProps) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const selected = selection.has(book.id)
  const bookIds = selectionActive && selected ? Array.from(selection) : [book.id]
  // The measuring node is the cover thumbnail (small rect), not the full-width
  // row: the drag overlay wrapper is sized from it, so the preview follows the
  // cursor and edge-clamping keeps it on screen. Listeners still span the row.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `book:${book.id}`,
    data: { bookIds } satisfies BookDragPayload,
    disabled: readOnly,
  })

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    menu.openFromEvent(e)
  }

  const meta = (
    <div className="flex shrink-0 items-center gap-3">
      <ListItemInfo book={book} />
      <span className="rounded border border-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:border-stone-700 dark:text-stone-500">
        {book.format}
      </span>
    </div>
  )

  return (
    <div
      {...listeners}
      {...attributes}
      onContextMenu={handleContextMenu}
      className={isDragging ? 'select-none opacity-60' : 'select-none'}
    >
      <Link
        to="/books/$id"
        params={{ id: book.id }}
        onClick={(e) => {
          if (dragJustEndedRef.current) {
            e.preventDefault()
            return
          }
          if (selectionActive) {
            e.preventDefault()
            onToggleSelect(book.id, e.shiftKey)
            return
          }
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault()
            onToggleSelect(book.id, e.shiftKey)
          }
        }}
        className={`group flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-all hover:bg-white hover:shadow-sm dark:hover:bg-stone-900 ${selectionActive ? 'cursor-pointer' : ''} ${selected ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700' : ''}`}
      >
        <div ref={setNodeRef} className="shrink-0">
          <BookCover book={book} size="sm" />
        </div>
        <ListItemContent book={book} />
        {meta}
        {selectionActive ? (
          <SelectionCheck selected={selected} />
        ) : (
          <div className="flex w-7 shrink-0 items-center justify-center opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            <button
              ref={menu.btnRef}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                menu.toggleFromButton()
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-200"
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
      </Link>
      {menu.open && (
        <SmartMenu
          triggerRef={menu.btnRef}
          innerRef={menu.menuRef}
          position={menu.position(184, 300)}
          width={184}
          onClose={menu.close}
        >
          <ContextMenuContent book={book} readOnly={readOnly} onShowDetails={onShowDetails} onPublish={onPublish} onDelete={onDelete} onClose={menu.close} />
        </SmartMenu>
      )}
    </div>
  )
}

function ListItemContent({ book }: { book: BookListItem }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate font-serif text-sm font-medium text-stone-900 dark:text-stone-100">
          {book.title}
        </span>
        {(book.hidden || book.effectiveHidden) && <HiddenIndicator kind="private" overlay />}
        {book.pinnedAt && (
          <UnpinButton
            bookId={book.id}
            className="shrink-0 rounded-md p-1 text-stone-400 transition-all hover:bg-stone-200/70 hover:text-stone-700 md:opacity-0 md:group-hover:opacity-100 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
          >
            <PinIcon size={11} />
          </UnpinButton>
        )}
      </div>
      {book.author && (
        <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{formatAuthorList(book.authors, book.author)}</div>
      )}
    </div>
  )
}
