import { useDraggable } from '@dnd-kit/core'

import type { CatalogBook } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import { catalogWorkRow, rowCover } from '../book-row'
import type { BookDragPayload } from '../dnd'

import BookCover from './BookCover'
import { SelectionCheck } from './RowChrome'

interface CatalogListRowProps {
  work: CatalogBook
  canManage: boolean
  selected: boolean
  selectionActive: boolean
  selection: Set<string>
  dragJustEndedRef: React.MutableRefObject<boolean>
  onToggleSelect: (id: string, shiftKey?: boolean) => void
  onShowDetails: (work: CatalogBook) => void
}

/**
 * A shared library's row in list view: the same row chrome as a private
 * book's list row, but the data is a work, not a book. A plain click opens
 * the work's detail (the versions are chosen there); there is no single
 * reader target the way a private row has one. Dragging a selected row
 * carries the whole selection, exactly like a private row does.
 */
export default function CatalogListRow({
  work, canManage, selected, selectionActive, selection, dragJustEndedRef, onToggleSelect, onShowDetails,
}: CatalogListRowProps) {
  const _ = useTranslation()
  const row = catalogWorkRow(work)
  const bookIds = selectionActive && selected ? Array.from(selection) : [work.id]
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `book:${work.id}`,
    data: { bookIds } satisfies BookDragPayload,
    disabled: !canManage,
  })

  return (
    <div
      {...listeners}
      {...attributes}
      className={isDragging ? 'select-none opacity-60' : 'select-none'}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (dragJustEndedRef.current) {
            e.preventDefault()
            return
          }
          if (selectionActive || e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault()
            onToggleSelect(work.id, e.shiftKey)
            return
          }
          onShowDetails(work)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onShowDetails(work)
        }}
        className={`group flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-white hover:shadow-sm dark:hover:bg-stone-900 ${selectionActive ? 'cursor-pointer' : ''} ${selected ? 'bg-white shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700' : ''}`}
      >
        <div ref={setNodeRef} className="shrink-0">
          <BookCover book={rowCover(row)} coverSrc={row.coverSrc} size="sm" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-serif text-sm font-medium text-stone-900 dark:text-stone-100">
            {work.title}
          </div>
          {work.author && (
            <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{work.author}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="whitespace-nowrap text-xs text-stone-400 dark:text-stone-500">
            {work.versions.length <= 1
              ? _('library.catalogSingleVersion')
              : _('library.catalogVersionCount', { count: work.versions.length })}
          </span>
          {row.format && (
            <span className="rounded border border-stone-200/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:border-stone-700 dark:text-stone-500">
              {row.format}
            </span>
          )}
        </div>
        {selectionActive && <SelectionCheck selected={selected} />}
      </div>
    </div>
  )
}
