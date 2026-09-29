import { useDraggable } from '@dnd-kit/core'
import { Link } from '@tanstack/react-router'

import type { CatalogBook } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { formatAuthorList } from '@/lib/utils'

import { catalogWorkRow, rowCover } from '../book-row'
import type { BookDragPayload } from '../dnd'
import { useLibraryCategories, useUpdateCatalogBook } from '../hooks'

import BookCover from './BookCover'
import HiddenIndicator from './HiddenIndicator'
import CatalogWorkMenu from './CatalogWorkMenu'
import ListItemInfo from './ListItemInfo'
import { SelectionCheck } from './RowChrome'
import { PinIcon } from './UnpinButton'
import { useContextMenu } from './use-context-menu'

interface CatalogListRowProps {
  work: CatalogBook
  canManage: boolean
  canCollect: boolean
  selected: boolean
  selectionActive: boolean
  selection: Set<string>
  dragJustEndedRef: React.MutableRefObject<boolean>
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onShowDetails: (work: CatalogBook) => void
}

/**
 * A shared library's row in list view: the same row chrome, the same
 * click-to-read link and the same menu as a private book's list row, but the
 * data is a work, not a book. A plain click reads its first version, the way
 * a private row reads its book; the detail dialog stays one menu item away.
 */
export default function CatalogListRow({
  work, canManage, canCollect, selected, selectionActive, selection, dragJustEndedRef, onToggleSelect, onShowDetails,
}: CatalogListRowProps) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const updateWork = useUpdateCatalogBook()
  const row = catalogWorkRow(work)
  const first = work.versions[0]
  const isPinned = Boolean(work.pinnedAt)
  // A work's category is the shelf column of this row; the name resolves
  // through the same cached taxonomy query the sidebar reads.
  const { data: categoriesData } = useLibraryCategories(work.libraryId)
  const categoryName = work.categoryId
    ? (categoriesData?.data ?? []).find((c) => c.id === work.categoryId)?.name
    : undefined
  const bookIds = selectionActive && selected ? Array.from(selection) : [work.id]
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `book:${work.id}`,
    data: { bookIds } satisfies BookDragPayload,
    disabled: !canManage,
  })

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    menu.openFromEvent(e)
  }

  const body = (
    <>
      <div ref={setNodeRef} className="shrink-0">
        <BookCover book={rowCover(row)} coverSrc={row.coverSrc} size="sm" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-serif text-sm font-medium text-stone-900 dark:text-stone-100">
            {work.title}
          </span>
          {(work.hidden || (work.versions.length === 1 && first?.status === 'unlisted')) && <HiddenIndicator kind="work" overlay />}
          {work.versions.length > 1 && work.versions.some((version) => version.status === 'unlisted') && <HiddenIndicator kind="versions" overlay />}
          {isPinned && (
            canManage ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  updateWork.mutate({
                    libraryId: work.libraryId,
                    libraryBookId: work.id,
                    patch: { pinned: false },
                  })
                }}
                className="shrink-0 rounded-md p-1 text-stone-400 transition-all hover:bg-stone-200/70 hover:text-stone-700 md:opacity-0 md:group-hover:opacity-100 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                aria-label={_('library.unpin')}
                title={_('library.unpin')}
              >
                <PinIcon size={11} />
              </button>
            ) : (
              <span
                className="shrink-0 rounded-md p-1 text-stone-400 md:opacity-0 md:group-hover:opacity-100 dark:text-stone-500 cursor-default"
                aria-label={_('library.pin')}
                title={_('library.pin')}
              >
                <PinIcon size={11} />
              </span>
            )
          )}
        </div>
        {work.author && (
          <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{formatAuthorList(work.authors, work.author)}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <ListItemInfo
          book={{
            progress: null,
            lastReadAt: null,
            shelfName: categoryName ?? null,
            tags: work.tags.map((t) => t.name),
            size: first?.size ?? 0,
            createdAt: work.createdAt,
          }}
        />
        {row.format && (
          <span className="rounded border border-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:border-stone-700 dark:text-stone-500">
            {row.format}
          </span>
        )}
      </div>
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
    </>
  )

  return (
    <div
      {...listeners}
      {...attributes}
      onContextMenu={handleContextMenu}
      className={isDragging ? 'select-none opacity-60' : 'select-none'}
    >
      {first ? (
        <Link
          to="/books/$id"
          params={{ id: first.bookVersionId }}
          onClick={(e) => {
            if (dragJustEndedRef.current) {
              e.preventDefault()
              return
            }
            if (selectionActive) {
              e.preventDefault()
              onToggleSelect(work.id, e.shiftKey)
              return
            }
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              e.preventDefault()
              onToggleSelect(work.id, e.shiftKey)
              return
            }
            if (work.hidden || first.status === 'unlisted') {
              // Managers keep reading hidden works like delisted ones; only
              // ordinary readers fall through to the detail dialog.
              if (canManage) return
              e.preventDefault()
              onShowDetails(work)
            }
          }}
          className={`group flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-white hover:shadow-sm dark:hover:bg-stone-900 ${selectionActive ? 'cursor-pointer' : ''} ${selected ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700' : ''}`}
        >
          {body}
        </Link>
      ) : (
        <div
          className={`group flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-white hover:shadow-sm dark:hover:bg-stone-900 ${selectionActive ? 'cursor-pointer' : ''} ${selected ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700' : ''}`}
        >
          {body}
        </div>
      )}
      {menu.open && (
        <CatalogWorkMenu
          innerRef={menu.menuRef}
          triggerRef={menu.btnRef}
          position={menu.position(184, 300)}
          width={184}
          onClose={menu.close}
          work={work}
          canManage={canManage}
          canCollect={canCollect && first?.collected !== true}
          canDownload={canCollect && (canManage || first?.status === 'published')}
          onShowDetails={() => { menu.close(); onShowDetails(work) }}
        />
      )}
    </div>
  )
}
