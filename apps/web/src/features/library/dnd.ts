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
