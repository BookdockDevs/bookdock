import type { BookSortPrefField, LibrarySortMode, LibrarySortPreference } from '@bookdock/shared'

export type SortDir = 'asc' | 'desc'

/** Default direction per auto mode: names asc, counts and times newest/most first. */
export const SIDEBAR_DEFAULT_DIR: Record<Exclude<LibrarySortMode, 'manual'>, SortDir> = {
  name: 'asc',
  bookCount: 'desc',
  recentlyAdded: 'desc',
  recentlyUpdated: 'desc',
}

export const BOOK_SORT_DEFAULT_DIR: Record<BookSortPrefField, SortDir> = {
  createdAt: 'desc',
  title: 'asc',
  author: 'asc',
  size: 'desc',
  progress: 'desc',
  lastReadAt: 'desc',
}

/** Manual mode never flips: a mirrored manual view turned into a drag would
 * silently materialize the reversed order into sortOrder (data accident, not
 * a sort preference), so direction is only defined for auto modes. */
export function sidebarSortDir(pref: LibrarySortPreference | undefined): SortDir {
  if (!pref || pref.mode === 'manual') return 'asc'
  return pref.dir ?? SIDEBAR_DEFAULT_DIR[pref.mode]
}

/** Re-clicking the active mode flips the direction; another mode gets its default. */
export function nextSidebarSort(current: LibrarySortPreference | undefined, mode: LibrarySortMode): LibrarySortPreference {
  if (mode === 'manual') return { mode: 'manual' }
  if (current?.mode === mode) {
    return { mode, dir: sidebarSortDir(current) === 'asc' ? 'desc' : 'asc' }
  }
  return { mode, dir: SIDEBAR_DEFAULT_DIR[mode] }
}

export interface SidebarSortableItem {
  name: string
  bookCount: number
  createdAt: number
  updatedAt: number
  /** Pin-to-top flag; orthogonal to the mode — pinned items lead in every mode. */
  pinned: boolean
}

/** Manual mode keeps the server (sortOrder) sequence within each group; auto
 * modes re-sort client-side (stable, so equal keys stay in manual rank).
 * Pinned items always form the leading group, ordered by the same rules. */
export function sortSidebarItems<T extends SidebarSortableItem>(
  items: T[],
  pref: LibrarySortPreference | undefined,
): T[] {
  const compare = (a: T, b: T): number => {
    if (!pref || pref.mode === 'manual') return 0
    const sign = sidebarSortDir(pref) === 'asc' ? 1 : -1
    switch (pref.mode) {
      case 'name': return sign * a.name.localeCompare(b.name)
      case 'bookCount': return sign * (a.bookCount - b.bookCount)
      case 'recentlyAdded': return sign * (a.createdAt - b.createdAt)
      case 'recentlyUpdated': return sign * (a.updatedAt - b.updatedAt)
      default: return 0
    }
  }
  const sorted = pref && pref.mode !== 'manual' ? [...items].sort(compare) : items
  if (!sorted.some((item) => item.pinned)) return sorted
  return [
    ...sorted.filter((item) => item.pinned),
    ...sorted.filter((item) => !item.pinned),
  ]
}
