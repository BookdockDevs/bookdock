import type { LibrarySearch } from '@/routes/index'

/**
 * Where the archive top bar exits to: the library home or reader view
 * exactly as it was when the archive was entered, plus the source history
 * index and window scroll to restore afterwards. Recorded once at entry and
 * forwarded unchanged by every in-archive navigation — navigating without
 * `state` resets history state, which would otherwise lose the exit source on
 * the first internal move.
 */
export interface ArchiveReturn {
  to?: string
  search?: LibrarySearch
  scrollTop: number
  sourceHistoryIndex?: number
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
 * source and its current history index. The source entry also receives the
 * scroll request before the archive push, so history traversal can restore it
 * without replacing the source with a duplicate route. Absent stays absent
 * for in-archive moves, so direct opens keep falling back to the library home.
 */
export function archiveEntryState(
  source: ArchiveSource,
  scrollTop: number,
  previous?: ArchiveReturn,
  sourceHistoryIndex = readCurrentHistoryIndex(),
): { archiveReturn: ArchiveReturn } {
  if (previous) return { archiveReturn: previous }
  if (sourceHistoryIndex !== undefined) rememberArchiveExitScroll(scrollTop)
  const returnState: ArchiveReturn = 'to' in source
    ? { to: source.to, scrollTop }
    : { search: source, scrollTop }
  if (sourceHistoryIndex !== undefined) returnState.sourceHistoryIndex = sourceHistoryIndex
  return { archiveReturn: returnState }
}

function readCurrentHistoryIndex(): number | undefined {
  if (typeof window === 'undefined') return undefined
  const index = (window.history.state as { __TSR_index?: unknown } | null)?.__TSR_index
  return typeof index === 'number' ? index : undefined
}

function rememberArchiveExitScroll(scrollTop: number): void {
  if (typeof window === 'undefined') return
  const state = window.history.state
  if (!state || typeof state !== 'object') return
  window.history.replaceState({ ...state, archiveExitScroll: scrollTop }, '', window.location.href)
}
