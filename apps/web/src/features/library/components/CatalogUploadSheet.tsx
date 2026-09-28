import { useMemo } from 'react'

import { catalogUploadFields } from '../catalog-upload'
import type { UploadTarget } from '../hooks'
import UploadSheet from './UploadSheet'

interface CatalogUploadSheetProps {
  open: boolean
  libraryId: string
  /** The category in context: uploads land here, the way a private upload lands on its shelf. */
  categoryId?: string | null
  onClose: () => void
}

/**
 * Uploading into a shared library, through the private library's own window and
 * queue: same dropzone, same size limit, same per-file progress, same duplicate
 * notice, same retry. Only the destination differs, and that is the target.
 *
 * A file becomes a new work in the library. Filing it as a new version of an
 * existing work is a real operation, and it gets a real UI when it is designed -
 * not a dropdown bolted onto this window.
 */
export default function CatalogUploadSheet({ open, libraryId, categoryId, onClose }: CatalogUploadSheetProps) {
  // Memoized because the upload queue keys its scheduler and its settlement
  // effect on the target's identity; a fresh object each render would restart
  // both. The category rides along for the same reason: switching categories
  // mid-queue re-targets the remaining files, which is the honest behavior.
  const target = useMemo<UploadTarget>(() => ({
    url: `/libraries/${libraryId}/books`,
    fields: () => catalogUploadFields(categoryId),
    invalidateKeys: [
      ['libraries', libraryId, 'catalog'],
      ['libraries', libraryId, 'categories'],
      ['libraries', libraryId, 'tags'],
    ],
  }), [libraryId, categoryId])

  if (!open) return null

  return <UploadSheet open onClose={onClose} target={target} />
}
