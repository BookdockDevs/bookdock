import { useMemo } from 'react'

import type { UploadTarget } from '../hooks'
import UploadSheet from './UploadSheet'

interface CatalogUploadSheetProps {
  open: boolean
  libraryId: string
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
export default function CatalogUploadSheet({ open, libraryId, onClose }: CatalogUploadSheetProps) {
  // Memoized because the upload queue keys its scheduler and its settlement
  // effect on the target's identity; a fresh object each render would restart
  // both.
  const target = useMemo<UploadTarget>(() => ({
    url: `/libraries/${libraryId}/books`,
    invalidateKeys: [
      ['libraries', libraryId, 'catalog'],
      ['libraries', libraryId, 'categories'],
      ['libraries', libraryId, 'tags'],
    ],
  }), [libraryId])

  if (!open) return null

  return <UploadSheet open onClose={onClose} target={target} />
}
