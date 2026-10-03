import type { LibrarySearch } from '@/routes/index'

/**
 * What a shared library's list can and cannot honour, in one place.
 *
 * A private library lists books the reader owns, so it can filter and sort by
 * their relationship to that reader: read status, progress, and last read. A
 * shared library lists works that belong to nobody, so those dimensions have
 * nothing to read.
 *
 * Author and series are *not* in that group. A work carries a curated author,
 * and its versions are real BookVersions whose parsed metadata declares a series
 * exactly as a private book's does - so both filters are honoured on both sides.
 * That was worth checking rather than assuming: an earlier version of this file
 * dropped `series` on the grounds that a catalog work has no series column, which
 * was true of the table and false of the data.
 *
 * The rule lives here rather than in the page so the list, the sidebar and the
 * URL correction cannot disagree about it.
 */

/** Sorts that describe a reader's relationship to a book they own. */
export const READING_STATE_SORTS = ['progress', 'lastReadAt', 'deletedAt']

/** The newest-first order a catalog falls back to, used when a sort is dropped. */
export const CATALOG_FALLBACK_SORT = 'createdAt'

/**
 * The URL changes needed to make a shared library's URL honest.
 *
 * A filter that is accepted and then quietly does nothing is worse than one that
 * is visibly absent, so a URL carrying dimensions this list cannot honour is
 * corrected rather than ignored. The three reading-state sorts become
 * newest-first, which is what the server would have used anyway; replacing the
 * sort key instead of clearing it matters because the reader's own sort
 * preference may be one of the three, and clearing would let it come straight
 * back.
 *
 * Returns an empty patch when the URL is already honest, so callers can treat
 * "no correction needed" as a no-op.
 */
export function libraryUrlCorrection(params: {
  readStatus: string | null
  sortBy: string
  sortOrder: string
}): Partial<LibrarySearch> {
  const patch: Partial<LibrarySearch> = {}
  if (params.readStatus) patch.status = undefined
  if (READING_STATE_SORTS.includes(params.sortBy)) {
    patch.sortBy = CATALOG_FALLBACK_SORT
    patch.sortOrder = 'desc'
  }
  return patch
}

/**
 * The URL changes needed when a filter's own row is no longer reachable.
 *
 * A shelf or tag can leave the sidebar while the URL still names it: hiding it,
 * unhiding it, or deleting it. The server then keeps filtering by an id the
 * reader can no longer see or click, so the list sits at zero with no way out
 * except editing the URL by hand. Clearing the filter is the only honest state,
 * and it is the same class of dead end as the others this file already covers.
 *
 * Callers must only pass id lists that have actually loaded: an empty list from
 * a query still in flight would clear a perfectly valid filter.
 *
 * `none` is the virtual uncategorized row and is never in the shelf list, so it
 * is exempt rather than treated as vanished.
 */
export function vanishedFilterCorrection(params: {
  shelfId: string | null
  tagId: string | null
  shelfIds: string[]
  tagIds: string[]
}): Partial<LibrarySearch> {
  const patch: Partial<LibrarySearch> = {}
  if (params.shelfId && params.shelfId !== 'none' && !params.shelfIds.includes(params.shelfId)) {
    patch.shelf = undefined
    patch.categoryScope = undefined
  }
  if (params.tagId && !params.tagIds.includes(params.tagId)) {
    patch.tag = undefined
  }
  return patch
}
