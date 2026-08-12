import type { ShelfListItem } from '@bookdock/shared'

// Shared dnd-kit contracts for the book-drag-to-shelf feature.
// Drag sources (book cards / list rows) carry a BookDragPayload; drop targets
// are the sortable shelf rows (droppable id = shelf id) plus the uncategorized
// entry (SHELF_NONE_DROPPABLE).

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

// Same-frame shelf order mirror during drag end (see Library): reorder the
// base list by the override while it is active, falling back to the base when
// the override is missing or no longer covers every shelf (e.g. a shelf was
// created elsewhere and the query refetched).
export function applyShelfOrder(base: ShelfListItem[], override: string[] | null | undefined): ShelfListItem[] {
  if (!override) return base
  const byId = new Map(base.map((s) => [s.id, s]))
  const ordered = override
    .map((id) => byId.get(id))
    .filter((s): s is ShelfListItem => Boolean(s))
  return ordered.length === base.length ? ordered : base
}
