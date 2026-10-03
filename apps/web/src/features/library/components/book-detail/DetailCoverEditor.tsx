import { useEffect, useLayoutEffect, useRef } from 'react'

import type { BookListItem, CoverPaletteId } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useRemoveCatalogVersionCover, useRemoveCover, useUpdateBook, useUploadCatalogVersionCover, useUploadCover } from '../../hooks'
import type { CoverSource } from '../BookCover'
import BookCoverEditor from './BookCoverEditor'

interface DetailCoverEditorProps {
  book: CoverSource & { source?: BookListItem['source'] }
  catalog?: { libraryId: string; libraryBookId: string; versionLinkId: string; hasVersionCover: boolean }
  coverPaletteId: CoverPaletteId | null
  active: boolean
  onActiveChange: (active: boolean) => void
}

export default function DetailCoverEditor({ book, coverPaletteId, active, onActiveChange, catalog }: DetailCoverEditorProps) {
  const _ = useTranslation()
  const catalogUpload = useUploadCatalogVersionCover()
  const catalogRemove = useRemoveCatalogVersionCover()
  const ref = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false)
  const upload = useUploadCover()
  const remove = useRemoveCover()
  const update = useUpdateBook()
  const saving = upload.isPending || remove.isPending || update.isPending || catalogUpload.isPending || catalogRemove.isPending

  useLayoutEffect(() => {
    if (active) ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    else if (restoreFocus.current) ref.current?.focus()
    restoreFocus.current = false
  }, [active])

  useEffect(() => {
    if (!active) return
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || ref.current?.contains(target) || target.closest('[data-smart-menu="true"]')) return
      onActiveChange(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[data-smart-menu="true"]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      restoreFocus.current = true
      onActiveChange(false)
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape, true)
    }
  }, [active, onActiveChange])

  return (
    <div ref={ref} tabIndex={-1} className="relative" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onActiveChange(true) }}>
      <BookCoverEditor
        book={book}
        coverRemovalPending={false}
        pendingCoverFile={null}
        coverPreviewUrl={null}
        saving={saving}
        coverPaletteId={coverPaletteId}
        toolbarPinned
        toolbarVisible={active}
        fullWidth
        allowPalette={!catalog && !book.source}
        canRemove={catalog ? catalog.hasVersionCover : undefined}
        removeLabel={catalog ? _('library.removeVersionCover') : undefined}
        onCoverFile={(file) => {
          if (!file || saving) return
          if (catalog) catalogUpload.mutate({ ...catalog, file }, {
            onSuccess: () => notify.success({ key: 'toast.bookCoverUpdated' }),
            onError: (error) => notify.error(getUserErrorNotification(error, 'toast.updateBookCoverFailed')),
          })
          else upload.mutate({ bookId: book.id, file })
        }}
        onRemoveCover={() => {
          if (saving) return
          if (catalog) catalogRemove.mutate(catalog, {
            onSuccess: () => notify.success({ key: 'toast.bookCoverRemoved' }),
            onError: (error) => notify.error(getUserErrorNotification(error, 'toast.removeBookCoverFailed')),
          })
          else remove.mutate(book.id)
        }}
        onPaletteChange={(id) => { if (!saving && id !== coverPaletteId) update.mutate({ bookId: book.id, coverPaletteId: id }) }}
      />
    </div>
  )
}
