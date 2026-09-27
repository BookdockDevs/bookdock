import { useState } from 'react'

import type { CatalogBook, Library } from '@bookdock/shared'


import { useTranslation } from '@/hooks/useTranslation'
import type { GridCardField } from '@/stores/ui.store'

import { catalogWorkRow } from '../book-row'

import BookCardShell from './BookCardShell'
import CatalogVersionList from './CatalogVersionList'
import { useContextMenu } from './use-context-menu'
import CatalogWorkMenu from './CatalogWorkMenu'

/**
 * A work in a shared library, drawn by the same card as a private book.
 *
 * What the card shows is the work - cover, title, author - and nothing about
 * reading, because a work belongs to nobody: no progress, no read status, no
 * pin. Its versions live in the work's detail dialog, which is where a reader
 * chooses one to read, the same place a private book's detail shows what is
 * known about it.
 */
interface CatalogCardProps {
  book: CatalogBook
  library: Library
  canManage: boolean
  canCollect: boolean
  moveCandidates: CatalogBook[]
  gridCardFields?: GridCardField[]
  selected?: boolean
  selectionActive?: boolean
  onToggleSelect?: (id: string, shiftKey?: boolean) => void
  onShowDetails: (book: CatalogBook) => void
  /** Opens the work's detail dialog; versions are chosen inside it. */
  onOpen: (book: CatalogBook) => void
  /** Curators see the versions inline; everyone else reads them in the dialog. */
  showVersionsInline?: boolean
}

export default function CatalogCard({
  book, library, canManage, canCollect, moveCandidates, gridCardFields,
  selected = false, selectionActive = false, onToggleSelect, onShowDetails, onOpen, showVersionsInline = false,
}: CatalogCardProps) {
  const _ = useTranslation()
  const menu = useContextMenu()
  const [versionsOpen, setVersionsOpen] = useState(false)
  const versionsVisible = versionsOpen && showVersionsInline

  return (
    <div className="flex flex-col gap-2">
      <BookCardShell
        row={catalogWorkRow(book)}
        gridCardFields={gridCardFields}
        selected={selected}
        selectionActive={selectionActive}
        onToggleSelect={onToggleSelect}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          menu.openFromEvent(e)
        }}
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
          position={menu.position(184, 210)}
          width={184}
          onClose={menu.close}
          work={book}
          canManage={canManage}
          onShowDetails={() => { menu.close(); onShowDetails(book) }}
          onOpenVersions={() => {
            menu.close()
            if (showVersionsInline) setVersionsOpen((v) => !v)
            else onOpen(book)
          }}
        />
      )}
      {versionsVisible && (
        <ul className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-800">
          <CatalogVersionList
            work={book}
            library={library}
            canManage={canManage}
            canCollect={canCollect}
            moveCandidates={moveCandidates}
          />
        </ul>
      )}
    </div>
  )
}
