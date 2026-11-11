import { useDraggable } from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'

import type { ClientLibraryBookView } from '@bookdock/shared'

import { catalogBookTarget } from '@/features/reading-data/catalog-navigation'
import { catalogSelectionKey } from '@/features/reading-data/catalog-selection'
import { isDeviceBook } from '@/features/reading-data/book-source'
import { useWarmReaderEntry } from '@/features/reading-data/reader-entry-prefetch'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { formatAuthorList } from '@/lib/utils'

import type { BookDragPayload } from '../dnd'
import { getHiddenCause } from '../hidden-status'
import BookCover from './BookCover'
import DeviceBookIndicator from './DeviceBookIndicator'
import HiddenIndicator from './HiddenIndicator'
import { ContextMenuContent } from './BookContextMenu'
import ListItemInfo from './ListItemInfo'
import { SelectionCheck } from './RowChrome'
import UnpinButton, { PinIcon } from './UnpinButton'
import { useContextMenu } from './use-context-menu'

interface ListItemWrapperProps {
  book: ClientLibraryBookView
  selection: Set<string>
  selectionActive: boolean
  dragJustEndedRef: React.MutableRefObject<boolean>
  readOnly: boolean
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onDelete?: (b: ClientLibraryBookView) => void
  onPublish?: (b: ClientLibraryBookView) => void
  onUploadToServer?: (b: ClientLibraryBookView) => void
  onFork?: (b: ClientLibraryBookView) => void
  onShowDetails: (b: ClientLibraryBookView) => void
}

/**
 * A private book's row in list view. Drag listeners span the row while the
 * cover thumbnail is the measuring node, so the preview follows the cursor.
 */
export default function ListItemWrapper({ book, selection, selectionActive, dragJustEndedRef, onToggleSelect, readOnly, onDelete, onPublish, onUploadToServer, onFork, onShowDetails }: ListItemWrapperProps) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const warmReader = useWarmReaderEntry()
  const selected = selection.has(catalogSelectionKey(book))
  const bookIds = selectionActive && selected ? Array.from(selection) : [catalogSelectionKey(book)]
  // The measuring node is the cover thumbnail (small rect), not the full-width
  // row: the drag overlay wrapper is sized from it, so the preview follows the
  // cursor and edge-clamping keeps it on screen. Listeners still span the row.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `book:${catalogSelectionKey(book)}`,
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
      {!selectionActive && isDeviceBook(book.ref) && <DeviceBookIndicator menuOpen={menu.open} />}
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
        {...catalogBookTarget(book)}
        onPointerEnter={() => warmReader({ bookId: book.id, isLocal: isDeviceBook(book.ref), prefetch: false })}
        onClick={(e) => {
          if (dragJustEndedRef.current) {
            e.preventDefault()
            return
          }
          if (!readOnly && selectionActive) {
            e.preventDefault()
            onToggleSelect(catalogSelectionKey(book), e.shiftKey)
            return
          }
          if (!readOnly && (e.ctrlKey || e.metaKey || e.shiftKey)) {
            e.preventDefault()
            onToggleSelect(catalogSelectionKey(book), e.shiftKey)
            return
          }
          warmReader({ bookId: book.id, isLocal: isDeviceBook(book.ref) })
        }}
        className={`group flex items-center gap-3.5 rounded-xl px-3 py-2.5 transition-all hover:bg-white hover:shadow-sm dark:hover:bg-stone-900 ${selectionActive && !readOnly ? 'cursor-pointer' : ''} ${menu.open && !selected ? 'bg-white shadow-sm dark:bg-stone-900' : ''} ${selected ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700' : ''}`}
      >
        <div ref={setNodeRef} className="shrink-0">
          <BookCover book={book} size="sm" />
        </div>
        <ListItemContent book={book} menuOpen={menu.open} />
        {meta}
        {selectionActive && !readOnly ? (
          <SelectionCheck selected={selected} />
        ) : (
          <div className={`flex w-7 shrink-0 items-center justify-center opacity-100 transition-opacity md:group-hover:opacity-100 ${menu.open ? 'md:opacity-100' : 'md:opacity-0'}`}>
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
          <ContextMenuContent book={book} readOnly={readOnly} onShowDetails={onShowDetails} onPublish={onPublish} onUploadToServer={onUploadToServer} onFork={onFork} onDelete={onDelete} onClose={menu.close} />
        </SmartMenu>
      )}
    </div>
  )
}

function ListItemContent({ book, menuOpen = false }: { book: ClientLibraryBookView; menuOpen?: boolean }) {
  const _ = useTranslation()
  const hiddenCause = getHiddenCause(book, 'shelf')
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate font-serif text-sm font-medium text-stone-900 dark:text-stone-100">
          {book.title}
        </span>
        {(book.hidden || book.effectiveHidden) && <HiddenIndicator kind="private" overlay title={hiddenCause ? _(hiddenCause.hintKey, hiddenCause.hintParams) : undefined} />}
        {book.pinnedAt && (
          <UnpinButton
            bookId={book.id}
            ref={book.ref}
            expectedVersion={book.clientVersion}
            className={`shrink-0 rounded-md p-1 text-stone-400 transition-all hover:bg-stone-200/70 hover:text-stone-700 md:group-hover:opacity-100 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200 ${menuOpen ? 'md:opacity-100' : 'md:opacity-0'}`}
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
