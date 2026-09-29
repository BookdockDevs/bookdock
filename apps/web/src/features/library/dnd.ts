// Shared dnd-kit contracts for library drag interactions.
// Drag sources (book cards / list rows) carry a BookDragPayload; drop targets
// are the sortable shelf/tag rows plus the uncategorized entry
// (SHELF_NONE_DROPPABLE).

export interface BookDragPayload {
  bookIds: string[]
}

export const SHELF_NONE_DROPPABLE = 'shelf:none'

export function isBookDrag(payload: unknown): payload is BookDragPayload {
  return Boolean(payload) && Array.isArray((payload as BookDragPayload).bookIds) && (payload as BookDragPayload).bookIds.length > 0
}

/** overId -> target shelfId; 'shelf:none' means remove from shelf (null). */
export function resolveDropShelfId(overId: string): string | null {
  return overId === SHELF_NONE_DROPPABLE ? null : overId
}

// Same-frame taxonomy order mirror during drag end (see Library): reorder the
// base list by the override while it is active, falling back to the base when
// the override is missing or no longer covers every row (e.g. a category was
// created elsewhere and the query refetched). Generic over the row so a private
// shelf, a private tag, a shared library's category and its tag all share it.
export function applyShelfOrder<T extends { id: string }>(base: T[], override: string[] | null | undefined): T[] {
  if (!override) return base
  const byId = new Map(base.map((s) => [s.id, s]))
  const ordered = override
    .map((id) => byId.get(id))
    .filter((s): s is T => Boolean(s))
  return ordered.length === base.length ? ordered : base
}

export function applyTagOrder<T extends { id: string }>(base: T[], override: string[] | null | undefined): T[] {
  if (!override) return base
  const byId = new Map(base.map((tag) => [tag.id, tag]))
  const ordered = override
    .map((id) => byId.get(id))
    .filter((tag): tag is T => Boolean(tag))
  return ordered.length === base.length ? ordered : base
}

/**
 * The reader's manual library order, merged over the server's join-time order.
 *
 * Unlike applyShelfOrder this is incremental, not all-or-nothing: a library the
 * order does not mention — joined after the last drag — keeps its base order and
 * lands at the bottom, which is the same "new entries go last" rule shelves get
 * from max(sortOrder) + 1. Ids the reader has since left are dropped.
 */
export function applyLibraryOrder<T extends { id: string }>(base: T[], order: string[] | null | undefined): T[] {
  if (!order || order.length === 0) return base
  const byId = new Map(base.map((library) => [library.id, library]))
  const placed = order.map((id) => byId.get(id)).filter((library): library is T => Boolean(library))
  if (placed.length === 0) return base
  const seen = new Set(placed.map((library) => library.id))
  return [...placed, ...base.filter((library) => !seen.has(library.id))]
}
