import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookVersions, shelves } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { ensurePrivateLibrary } from '../libraries/library-access'
import { loadLibraryHiddenTaxonomy, workHiddenExclusion } from '../libraries/library-query'

function privateLibraryId(userId: string): string | null {
  const db = getDb()
  return db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()?.id ?? null
}

export async function listShelves(userId: string, showHidden = false) {
  const db = getDb()
  const libraryId = privateLibraryId(userId)
  if (!libraryId) return []
  const taxonomy = showHidden ? null : loadLibraryHiddenTaxonomy(db, libraryId)
  const countExtra: SQL[] = []
  if (taxonomy) {
    countExtra.push(workHiddenExclusion(taxonomy))
  }
  const rows = db.select({
    id: shelves.id,
    userId: shelves.userId,
    name: shelves.name,
    sortOrder: shelves.sortOrder,
    createdAt: shelves.createdAt,
    updatedAt: shelves.updatedAt,
    pinned: shelves.pinned,
    hidden: shelves.hidden,
    bookCount: sql<number>`count(${libraryBooks.id})`,
  }).from(shelves)
    .leftJoin(libraryBooks, and(eq(shelves.id, libraryBooks.shelfId), isNull(libraryBooks.deletedAt), ...countExtra))
    .where(and(eq(shelves.libraryId, libraryId), ...(showHidden ? [] : [eq(shelves.hidden, false)])))
    .groupBy(shelves.id)
    .orderBy(asc(shelves.sortOrder), asc(shelves.createdAt))
    .all()
  return rows
}

export async function createShelf(userId: string, name: string) {
  const db = getDb()
  const libraryId = ensurePrivateLibrary(db, userId)
  return db.transaction((tx) => {
    const existing = tx.select({ id: shelves.id }).from(shelves)
      .where(and(eq(shelves.libraryId, libraryId), eq(shelves.name, name))).get()
    if (existing) throw new AppError('SHELF_NAME_TAKEN', 'Shelf name is already in use')
    const now = Date.now()
    const id = createId('shelf')
    const max = tx.select({ max: sql<number>`max(${shelves.sortOrder})` }).from(shelves)
      .where(eq(shelves.libraryId, libraryId)).get()
    const sortOrder = (max?.max ?? -1) + 1
    tx.insert(shelves).values({
      id, libraryId, userId, name, sortOrder, pinned: false, hidden: false, createdAt: now, updatedAt: now,
    }).run()
    return { id, userId, name, sortOrder, createdAt: now, updatedAt: now, pinned: false, hidden: false, bookCount: 0 }
  })
}

export async function reorderShelves(userId: string, shelfIds: string[]) {
  const db = getDb()
  const libraryId = ensurePrivateLibrary(db, userId)
  const existing = db.select({ id: shelves.id }).from(shelves).where(eq(shelves.libraryId, libraryId)).all()
  const owned = new Set(existing.map((shelf) => shelf.id))
  if (shelfIds.length !== owned.size || new Set(shelfIds).size !== owned.size || shelfIds.some((id) => !owned.has(id))) {
    throw new AppError('SHELF_NOT_FOUND')
  }
  db.transaction((tx) => {
    for (const [index, id] of shelfIds.entries()) {
      tx.update(shelves).set({ sortOrder: index }).where(eq(shelves.id, id)).run()
    }
  })
}

export async function updateShelf(userId: string, shelfId: string, patch: { name?: string; pinned?: boolean; hidden?: boolean }) {
  const db = getDb()
  const libraryId = ensurePrivateLibrary(db, userId)
  return db.transaction((tx) => {
    const existing = tx.select().from(shelves)
      .where(and(eq(shelves.id, shelfId), eq(shelves.libraryId, libraryId))).get()
    if (!existing) throw new AppError('SHELF_NOT_FOUND')
    if (patch.name !== undefined && patch.name !== existing.name) {
      const duplicate = tx.select({ id: shelves.id }).from(shelves)
        .where(and(eq(shelves.libraryId, libraryId), eq(shelves.name, patch.name), ne(shelves.id, shelfId))).get()
      if (duplicate) throw new AppError('SHELF_NAME_TAKEN', 'Shelf name is already in use')
    }
    tx.update(shelves).set(patch).where(eq(shelves.id, shelfId)).run()
    return { ...existing, ...patch }
  })
}

export async function deleteShelf(userId: string, shelfId: string) {
  const db = getDb()
  const libraryId = privateLibraryId(userId)
  if (!libraryId) throw new AppError('SHELF_NOT_FOUND')
  return db.transaction((tx) => {
    const shelf = tx.select().from(shelves)
      .where(and(eq(shelves.id, shelfId), eq(shelves.libraryId, libraryId))).get()
    if (!shelf) throw new AppError('SHELF_NOT_FOUND')
    const now = Date.now()
    tx.update(libraryBooks).set({ shelfId: null, updatedAt: now })
      .where(eq(libraryBooks.shelfId, shelfId)).run()
    tx.delete(shelves).where(eq(shelves.id, shelfId)).run()
    return shelf
  })
}

export async function moveBooksToShelf(userId: string, shelfId: string, bookIds: string[]) {
  const db = getDb()
  const libraryId = ensurePrivateLibrary(db, userId)
  await verifyShelfOwnership(libraryId, shelfId)
  if (bookIds.length === 0) return
  const libraryBookIds = await verifyBookOwnership(libraryId, bookIds)
  const now = Date.now()
  db.transaction((tx) => {
    const previous = tx.select({ shelfId: libraryBooks.shelfId }).from(libraryBooks)
      .where(inArray(libraryBooks.id, libraryBookIds)).all().map((row) => row.shelfId).filter((id): id is string => id !== null)
    tx.update(libraryBooks).set({ shelfId, updatedAt: now }).where(inArray(libraryBooks.id, libraryBookIds)).run()
    for (const touched of new Set([...previous, shelfId])) tx.update(shelves).set({ updatedAt: now }).where(eq(shelves.id, touched)).run()
  })
}

export async function removeBooksFromShelf(userId: string, shelfId: string, bookIds: string[]) {
  const db = getDb()
  const libraryId = ensurePrivateLibrary(db, userId)
  await verifyShelfOwnership(libraryId, shelfId)
  if (bookIds.length === 0) return
  const libraryBookIds = await verifyBookOwnership(libraryId, bookIds)
  const now = Date.now()
  db.transaction((tx) => {
    tx.update(libraryBooks).set({ shelfId: null, updatedAt: now })
      .where(and(inArray(libraryBooks.id, libraryBookIds), eq(libraryBooks.shelfId, shelfId))).run()
    tx.update(shelves).set({ updatedAt: now }).where(eq(shelves.id, shelfId)).run()
  })
}

async function verifyShelfOwnership(libraryId: string, shelfIds: string | string[]) {
  const ids = Array.isArray(shelfIds) ? shelfIds : [shelfIds]
  const db = getDb()
  const existing = db.select({ count: sql<number>`count(*)` }).from(shelves)
    .where(and(eq(shelves.libraryId, libraryId), inArray(shelves.id, ids))).get()
  if ((existing?.count ?? 0) !== ids.length) throw new AppError('SHELF_NOT_FOUND')
}

async function verifyBookOwnership(libraryId: string, bookIds: string[]): Promise<string[]> {
  const db = getDb()
  const rows = db.select({ bookVersionId: libraryBookVersions.bookVersionId, libraryBookId: libraryBookVersions.libraryBookId })
    .from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, libraryId), inArray(libraryBookVersions.bookVersionId, bookIds))).all()
  if (rows.length !== bookIds.length) throw new AppError('BOOK_NOT_FOUND')
  return rows.map((row) => row.libraryBookId)
}
