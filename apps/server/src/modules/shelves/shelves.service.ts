import { eq, and, inArray, isNull, sql, asc, ne } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookVersions, libraryCategories } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { ensurePrivateLibrary } from '../libraries/library-access'

function privateLibraryId(userId: string): string | null {
  const db = getDb()
  return db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()?.id ?? null
}

function requirePrivateLibrary(userId: string): string {
  return ensurePrivateLibrary(getDb(), userId)
}

export async function listShelves(userId: string) {
  const db = getDb()
  const libraryId = privateLibraryId(userId)
  if (!libraryId) return []
  const rows = db
    .select({
      id: libraryCategories.id,
      userId: libraryCategories.userId,
      name: libraryCategories.name,
      sortOrder: libraryCategories.sortOrder,
      createdAt: libraryCategories.createdAt,
      updatedAt: libraryCategories.updatedAt,
      pinned: libraryCategories.pinned,
      bookCount: sql<number>`count(${libraryBooks.id})`,
    })
    .from(libraryCategories)
    .leftJoin(libraryBooks, and(eq(libraryCategories.id, libraryBooks.categoryId), isNull(libraryBooks.deletedAt)))
    .where(eq(libraryCategories.libraryId, libraryId))
    .groupBy(libraryCategories.id)
    .orderBy(asc(libraryCategories.sortOrder), asc(libraryCategories.createdAt))
    .all()
  return rows
}

export async function createShelf(userId: string, name: string) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  return db.transaction((tx) => {
    const existing = tx
      .select({ id: libraryCategories.id })
      .from(libraryCategories)
      .where(and(eq(libraryCategories.libraryId, libraryId), eq(libraryCategories.name, name)))
      .get()
    if (existing) throw new AppError('SHELF_NAME_TAKEN', 'Shelf name is already in use')

    const now = Date.now()
    const id = createId('shelf')
    // New shelves always land last: the list orders by (sortOrder, createdAt), so
    // a default 0 would jump to the front once a reorder has written dense ranks.
    const max = tx
      .select({ max: sql<number>`max(${libraryCategories.sortOrder})` })
      .from(libraryCategories)
      .where(eq(libraryCategories.libraryId, libraryId))
      .get()
    const sortOrder = (max?.max ?? -1) + 1
    tx.insert(libraryCategories).values({
      id, libraryId, userId, name, parentId: null, sortOrder, pinned: false, createdAt: now, updatedAt: now,
    }).run()
    return { id, userId, name, sortOrder, createdAt: now, updatedAt: now, pinned: false, bookCount: 0 }
  })
}

export async function reorderShelves(userId: string, shelfIds: string[]) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  // The submitted list must be the library's full shelf set — anything less would
  // leave stragglers on stale ranks that collide with the rewritten ones.
  const existing = db
    .select({ id: libraryCategories.id })
    .from(libraryCategories)
    .where(eq(libraryCategories.libraryId, libraryId))
    .all()
  const owned = new Set(existing.map((s) => s.id))
  if (shelfIds.length !== owned.size || shelfIds.some((id) => !owned.has(id))) {
    throw new AppError('SHELF_NOT_FOUND')
  }
  db.transaction((tx) => {
    for (const [index, id] of shelfIds.entries()) {
      tx.update(libraryCategories).set({ sortOrder: index }).where(eq(libraryCategories.id, id)).run()
    }
  })
}

export async function updateShelf(userId: string, shelfId: string, patch: { name?: string; pinned?: boolean }) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  return db.transaction((tx) => {
    const existing = tx.select().from(libraryCategories)
      .where(and(eq(libraryCategories.id, shelfId), eq(libraryCategories.libraryId, libraryId))).get()
    if (!existing) throw new AppError('SHELF_NOT_FOUND')
    if (patch.name !== undefined && patch.name !== existing.name) {
      const duplicate = tx
        .select({ id: libraryCategories.id })
        .from(libraryCategories)
        .where(and(eq(libraryCategories.libraryId, libraryId), eq(libraryCategories.name, patch.name), ne(libraryCategories.id, shelfId)))
        .get()
      if (duplicate) throw new AppError('SHELF_NAME_TAKEN', 'Shelf name is already in use')
    }
    tx.update(libraryCategories).set(patch).where(eq(libraryCategories.id, shelfId)).run()
    const { libraryId: _libraryId, parentId: _parentId, ...shelf } = { ...existing, ...patch }
    return shelf
  })
}

export async function deleteShelf(userId: string, shelfId: string) {
  const db = getDb()
  const existing = await getShelf(userId, shelfId)
  if (!existing) throw new AppError('SHELF_NOT_FOUND')
  // libraryBooks.categoryId FK is ON DELETE SET NULL: books become uncategorized
  db.delete(libraryCategories).where(eq(libraryCategories.id, shelfId)).run()
  const { libraryId: _libraryId, parentId: _parentId, ...shelf } = existing
  return shelf
}

export async function moveBooksToShelf(userId: string, shelfId: string, bookIds: string[]) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  await verifyCategoryOwnership(libraryId, shelfId)
  const libraryBookIds = await verifyBookOwnership(libraryId, bookIds)
  if (bookIds.length === 0) return
  const now = Date.now()
  db.update(libraryBooks).set({ categoryId: shelfId, updatedAt: now })
    .where(inArray(libraryBooks.id, libraryBookIds)).run()
  db.update(libraryCategories).set({ updatedAt: now }).where(eq(libraryCategories.id, shelfId)).run()
}

export async function removeBooksFromShelf(userId: string, shelfId: string, bookIds: string[]) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  await verifyCategoryOwnership(libraryId, shelfId)
  if (bookIds.length === 0) return
  const libraryBookIds = await verifyBookOwnership(libraryId, bookIds)
  const now = Date.now()
  db.update(libraryBooks).set({ categoryId: null, updatedAt: now })
    .where(and(inArray(libraryBooks.id, libraryBookIds), eq(libraryBooks.categoryId, shelfId))).run()
  db.update(libraryCategories).set({ updatedAt: now }).where(eq(libraryCategories.id, shelfId)).run()
}

async function getShelf(userId: string, shelfId: string) {
  const db = getDb()
  const libraryId = privateLibraryId(userId)
  if (!libraryId) return undefined
  return db.select().from(libraryCategories)
    .where(and(eq(libraryCategories.id, shelfId), eq(libraryCategories.libraryId, libraryId))).get()
}

async function verifyCategoryOwnership(libraryId: string, shelfIdOrIds: string | string[]) {
  const ids = Array.isArray(shelfIdOrIds) ? shelfIdOrIds : [shelfIdOrIds]
  const db = getDb()
  const existing = db
    .select({ count: sql<number>`count(*)` })
    .from(libraryCategories)
    .where(and(eq(libraryCategories.libraryId, libraryId), inArray(libraryCategories.id, ids)))
    .get()
  if ((existing?.count ?? 0) !== ids.length) {
    throw new AppError('SHELF_NOT_FOUND')
  }
}

async function verifyBookOwnership(libraryId: string, bookIds: string[]): Promise<string[]> {
  const db = getDb()
  const rows = db
    .select({ bookVersionId: libraryBookVersions.bookVersionId, libraryBookId: libraryBookVersions.libraryBookId })
    .from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, libraryId), inArray(libraryBookVersions.bookVersionId, bookIds)))
    .all()
  if (rows.length !== bookIds.length) {
    throw new AppError('BOOK_NOT_FOUND')
  }
  return rows.map((row) => row.libraryBookId)
}
