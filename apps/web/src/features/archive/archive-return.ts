import type { LibrarySearch } from '@/routes/index'

/**
 * Where the archive top bar exits to: the library home or reader view
 * exactly as it was when the archive was entered, plus the window scroll
 * to restore afterwards. Recorded once at entry and forwarded unchanged
 * by every in-archive navigation — navigating without `state` resets history
 * state, which would otherwise lose the exit source on the first internal move.
 */
export interface ArchiveReturn {
  to?: string
  search?: LibrarySearch
  scrollTop: number
}

export type ArchiveSource = LibrarySearch | { to: string }

declare module '@tanstack/react-router' {
  interface HistoryState {
    archiveReturn?: ArchiveReturn
    /**
     * Window scroll requested by an archive exit, consumed by the library
     * once its list is rendered (a blind scrollTo would clamp against
     * skeletons). Cleared by every in-library navigation.
     */
    archiveExitScroll?: number
  }
}

/**
 * Entry capture: keep an existing record (re-entering the archive from
 * inside it must not overwrite the exit source), otherwise snapshot the
 * source. Absent stays absent for in-archive moves, so direct opens keep
 * falling back to the library home.
 */
export function archiveEntryState(
  source: ArchiveSource,
  scrollTop: number,
  previous?: ArchiveReturn,
): { archiveReturn: ArchiveReturn } {
  if (previous) return { archiveReturn: previous }
  if ('to' in source) {
    return { archiveReturn: { to: source.to, scrollTop } }
  }
  return { archiveReturn: { search: source, scrollTop } }
}
