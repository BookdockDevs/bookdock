import { useMemo } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

import { useLibraryCategories, type UploadTarget } from '../hooks'
import { categoryPath } from '../taxonomy'
import UploadSheet from './UploadSheet'

interface CatalogUploadSheetProps {
  open: boolean
  libraryId: string
  /** The category in context: uploads land here, the way a private upload lands on its shelf. */
  categoryId?: string | null
  /**
   * Bind the upload to one existing work (P3): every file becomes a new
   * version of it instead of a new work. Category placement does not apply -
   * the work keeps its own.
   */
  libraryBookId?: string
  workTitle?: string
  nextVersionIndex?: number
  /** Fired with the new version link ids once the queue settles. */
  onUploadedVersion?: (versionLinkIds: string[]) => void
  onClose: () => void
}

/**
 * Uploading into a shared library, through the private library's own window and
 * queue: same dropzone, same size limit, same per-file progress, same duplicate
 * notice, same retry. Only the destination differs, and that is the target.
 *
 * A file becomes a new work in the library, unless a work is bound above - then
 * it becomes a new version of that work, with an optional per-file edition
 * label. Filing it as a new version of an existing work picked elsewhere is a
 * separate UI decision, not a dropdown bolted onto this window.
 */
export default function CatalogUploadSheet({
  open,
  libraryId,
  categoryId,
  libraryBookId,
  workTitle,
  nextVersionIndex,
  onUploadedVersion,
  onClose,
}: CatalogUploadSheetProps) {
  const _ = useTranslation()
  const categoriesQuery = useLibraryCategories(libraryId, { enabled: Boolean(open && categoryId && !libraryBookId) })
  const categories = categoriesQuery.data?.data ?? []
  const categoryName = !libraryBookId && categoryId
    ? categoryPath(categories, categoryId).map((node) => node.name).join(' / ')
    : undefined

  // Memoized because the upload queue keys its scheduler and its settlement
  // effect on the target's identity; a fresh object each render would restart
  // both. The destination follows the category of the upload entry point.
  const target = useMemo<UploadTarget>(() => ({
    url: `/libraries/${libraryId}/books`,
    fields: (item) => ({
      ...(libraryBookId
        ? { libraryBookId }
        : (categoryId ? { categoryId } : {})),
      ...(item.versionName?.trim() ? { name: item.versionName.trim() } : {}),
    }),
    // Bound-work uploads answer the new link id so the caller can select the
    // version it just added. It is not a readable book id: the in-detail flow
    // selects into the open dialog instead of navigating (see readable below).
    ...(libraryBookId
      ? { pickBookId: (body: unknown) => (body as { versionLinkId?: string } | null)?.versionLinkId }
      : {}),
    invalidateKeys: [
      ['libraries', libraryId, 'catalog'],
      ['libraries', libraryId, 'categories'],
      ['libraries', libraryId, 'tags'],
      ['books'],
      ['book'],
      ['batch-selection'],
    ],
  }), [libraryId, categoryId, libraryBookId])

  if (!open) return null

  const versionContextNote = libraryBookId
    ? (_('library.versionFallback', { n: nextVersionIndex ?? 2 }) as string)
    : undefined
  const versionContextTitle = libraryBookId && workTitle
    ? (_('library.uploadToWorkHint', { name: workTitle }) as string)
    : undefined

  return (
    <UploadSheet
      open
      onClose={onClose}
      libraryId={libraryId}
      shelfName={categoryName}
      isCategory
      target={target}
      versionNameMode={true}
      boundWork={Boolean(libraryBookId)}
      contextNote={versionContextNote}
      contextTitle={versionContextTitle}
      onUploaded={onUploadedVersion}
    />
  )
}
