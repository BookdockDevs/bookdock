import type { ReactNode } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { cn, formatAuthorList } from '@/lib/utils'

import type { GridCardField } from '@/stores/ui.store'

import type { BookRow } from '../book-row'
import { rowCover } from '../book-row'
import BookCover from './BookCover'
import { CoverRing, SelectedRing, SelectionCheckOverlay } from './RowChrome'

const DEFAULT_CARD_FIELDS: GridCardField[] = ['title', 'author', 'progress']

/**
 * The card a book list is made of, whichever library it belongs to.
 *
 * A private library's card and a shared library's card are the same picture of
 * the same thing - a cover, a title, an author, a progress figure if the reader
 * has one - and they were two components that had drifted: different hover, a
 * different select marker, and a shared library's row deciding for itself which
 * fields to show. The row's data decides, not the component: a field the row
 * does not have is not drawn, so a catalog work shows no progress for the same
 * reason a private book at 0% shows none.
 *
 * What a row can do beyond look (pin, trash, delete, a context menu) arrives as
 * slots, because those belong to a book someone owns.
 */
interface BookCardShellProps {
  row: BookRow
  gridCardFields?: GridCardField[]
  /** The trash list shows no cover text; a card normally does. */
  coverText?: boolean
  selected?: boolean
  selectionActive?: boolean
  onToggleSelect?: (id: string, shiftKey?: boolean) => void
  /**
   * Absent on a shared library's row: only books someone owns can be pinned, and
   * the affordance carries its own mutation, so it arrives as a node.
   */
  pinAffordance?: ReactNode
  trashCard?: boolean
  onRestore?: () => void
  onPermanentDelete?: () => void
  /** Rendered under the cover, absolutely positioned (the trash pills). */
  coverOverlay?: ReactNode
  /** Bottom-left badge on the cover (the hidden mark lives here, not below the card). */
  coverBadge?: ReactNode
  /** Rendered under the title (a collected card whose source is gone says so). */
  infoFooter?: ReactNode
  /** The overflow menu, anchored by the row that owns it. */
  menu?: ReactNode
  onContextMenu?: (e: React.MouseEvent) => void
  className?: string
}

export default function BookCardShell({
  row,
  gridCardFields,
  coverText = true,
  selected = false,
  selectionActive = false,
  onToggleSelect,
  pinAffordance,
  trashCard = false,
  onRestore,
  onPermanentDelete,
  coverOverlay,
  coverBadge,
  infoFooter,
  menu,
  onContextMenu,
  className,
}: BookCardShellProps) {
  const _ = useTranslation()
  const selectable = !!onToggleSelect
  const showMenu = !!menu && !trashCard

  function handleClick(e: React.MouseEvent) {
    if (!selectable) return
    if (e.ctrlKey || e.metaKey || selectionActive) {
      e.preventDefault()
      e.stopPropagation()
      onToggleSelect!(row.id, e.shiftKey)
    }
  }

  const activeFields = gridCardFields ?? (coverText ? DEFAULT_CARD_FIELDS : [])
  const showTitle = activeFields.includes('title')
  const authorText = formatAuthorList(row.authors, row.author ?? '')
  const showAuthor = activeFields.includes('author') && Boolean(authorText)
  const showProgress = activeFields.includes('progress') && !trashCard && row.progress != null && row.progress > 0
  const progressText = showProgress ? `${Math.min(100, Math.round(row.progress!))}%` : null
  const hasSubtitle = showAuthor || Boolean(progressText)
  const hasCardInfo = showTitle || hasSubtitle || !!infoFooter

  return (
    <article
      onClick={handleClick}
      onContextMenu={onContextMenu}
      className={cn(
        'group relative flex min-w-0 select-none flex-col gap-1.5',
        selectable && 'cursor-pointer',
        className,
      )}
    >
      <div
        className={cn(
          'relative rounded-xl transition-all duration-200 ease-out',
          selectionActive ? '' : 'group-hover:-translate-y-1.5 group-hover:shadow-xl group-hover:shadow-stone-900/15 dark:group-hover:shadow-black/50',
        )}
      >
        <div className={cn('rounded-xl', trashCard && 'opacity-80 grayscale-[60%]')}>
          <BookCover book={rowCover(row)} coverSrc={row.coverSrc ?? undefined} />
        </div>
        <CoverRing />
        {!selectionActive && pinAffordance}
        {selected && <SelectedRing />}
        {selectable && selectionActive && <SelectionCheckOverlay selected={selected} />}
        {showMenu && <div className="absolute right-1.5 top-1.5 z-10 transition-opacity duration-150 opacity-100 md:opacity-0 md:group-hover:opacity-100">{menu}</div>}
        {coverOverlay}
        {coverBadge && (
          <div className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1">
            {coverBadge}
          </div>
        )}
        {trashCard && !selectionActive && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-2.5 rounded-b-xl bg-gradient-to-t from-black/75 via-black/45 to-transparent p-2.5 pt-8 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100">
            <OverlayAction
              label={_('library.restore')}
              icon={<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />}
              hover="hover:text-emerald-600 dark:hover:text-emerald-400"
              onClick={() => onRestore?.()}
            />
            <OverlayAction
              label={_('library.permanentDelete')}
              icon={<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />}
              hover="hover:text-red-600 hover:bg-red-500 hover:text-white dark:hover:bg-red-600 dark:hover:text-white"
              onClick={() => onPermanentDelete?.()}
            />
          </div>
        )}
      </div>
      {hasCardInfo && (
        <div className="min-w-0 px-0.5">
          {showTitle && (
            <h3 className="truncate font-serif text-[13px] font-medium leading-snug text-stone-900 dark:text-stone-100">
              {row.title}
            </h3>
          )}
          {hasSubtitle && (
            <p className="mt-0.5 flex items-center truncate text-xs text-stone-500 dark:text-stone-400">
              {showAuthor && <span className="truncate">{authorText}</span>}
              {showAuthor && progressText && <span className="mx-1 shrink-0 text-stone-300 dark:text-stone-600">·</span>}
              {progressText && (
                <span className="shrink-0 font-medium font-mono text-[11px] text-stone-500 dark:text-stone-400">
                  {progressText}
                </span>
              )}
            </p>
          )}
          {infoFooter}
        </div>
      )}
    </article>
  )
}

function OverlayAction({ label, icon, hover, onClick }: { label: string; icon: ReactNode; hover: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-stone-700 shadow-md backdrop-blur-sm transition-all hover:scale-105 hover:bg-white active:scale-95 dark:bg-stone-800/95 dark:text-stone-200',
        hover,
      )}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
    </button>
  )
}
