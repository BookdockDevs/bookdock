import { useState } from 'react'

import type { CatalogBook, GridCardField } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import { catalogWorkRow } from '../book-row'

import BookCardShell from './BookCardShell'
import HiddenIndicator from './HiddenIndicator'
import { useContextMenu } from './use-context-menu'
import CatalogWorkMenu from './CatalogWorkMenu'
import DeleteVersionsDialog from './DeleteVersionsDialog'
import { PinIcon } from './UnpinButton'
import { useUpdateCatalogBook } from '../hooks'

/**
 * A work in a shared library, drawn by the same card as a private book.
 *
 * What the card shows is the work - cover, title, author - and nothing about
 * reading, because a work belongs to nobody: no progress, no read status, no
 * personal pin. Its versions live in the work's detail dialog, which is where
 * a reader chooses one to read, the same place a private book's detail shows
 * what is known about it. A manager's pin is the library's, not the reader's.
 */
interface CatalogCardProps {
  book: CatalogBook
  canManage: boolean
  canCollect: boolean
  gridCardFields?: GridCardField[]
  selected?: boolean
  selectionActive?: boolean
  onToggleSelect?: (id: string, shiftKey?: boolean) => void
  onShowDetails: (book: CatalogBook) => void
}

export default function CatalogCard({
  book, canManage, canCollect, gridCardFields,
  selected = false, selectionActive = false, onToggleSelect, onShowDetails,
}: CatalogCardProps) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const updateWork = useUpdateCatalogBook()
  // The version-delete dialog lives here (outside the menu subtree): closing
  // the menu unmounts everything inside it, so menu-owned dialog state dies
  // with the menu and the confirm never fires.
  const [deleteOpen, setDeleteOpen] = useState(false)
  const first = book.versions[0]
  const isPinned = Boolean(book.pinnedAt)
  const hasHiddenVersions = book.versions.length > 1 && book.versions.some((version) => version.status === 'unlisted')
  // Badging follows the effective flag so taxonomy-hidden works carry the
  // mark; management (menu labels, click-through) stays on the direct flag.
  const isEffectivelyHidden = book.hidden || book.effectiveHidden === true

  return (
    <>
      <BookCardShell
        row={catalogWorkRow(book)}
        gridCardFields={gridCardFields}
        selected={selected}
        selectionActive={selectionActive}
        onToggleSelect={onToggleSelect}
        pinAffordance={isPinned ? (
          <div className="absolute left-1.5 top-1.5 z-10 transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100">
            {canManage ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  updateWork.mutate({
                    libraryId: book.libraryId,
                    libraryBookId: book.id,
                    patch: { pinned: false },
                  })
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
                aria-label={_('library.unpin')}
                title={_('library.unpin')}
              >
                <PinIcon size={12} />
              </button>
            ) : (
              <div
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm cursor-default"
                aria-label={_('library.pin')}
                title={_('library.pin')}
              >
                <PinIcon size={12} />
              </div>
            )}
          </div>
        ) : undefined}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          menu.openFromEvent(e)
        }}
        coverBadge={(isEffectivelyHidden || hasHiddenVersions) ? (
          <>
            {isEffectivelyHidden && <HiddenIndicator kind="work" overlay />}
            {hasHiddenVersions && <HiddenIndicator kind="versions" overlay />}
          </>
        ) : undefined}
        menu={(
          <button
            ref={menu.btnRef}
            type="button"
            aria-label={_('library.moreActions')}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              menu.toggleFromButton()
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        )}
      />
      {menu.open && (
        <CatalogWorkMenu
          innerRef={menu.menuRef}
          triggerRef={menu.btnRef}
          position={menu.position(184, 300)}
          width={184}
          onClose={menu.close}
          work={book}
          canManage={canManage}
          canCollect={canCollect && first?.collected !== true}
          canDownload={canCollect && (canManage || book.versions[0]?.status === 'published')}
          onShowDetails={() => { menu.close(); onShowDetails(book) }}
          onDeleteRequest={() => { menu.close(); setDeleteOpen(true) }}
        />
      )}
      {deleteOpen && (
        <DeleteVersionsDialog
          work={book}
          libraryId={book.libraryId}
          preselectedIds={book.versions.map((v) => v.id)}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => setDeleteOpen(false)}
        />
      )}
    </>
  )
}
