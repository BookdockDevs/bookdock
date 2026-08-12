import { eq, and, inArray, sql, asc } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { books, shelves } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'

export async function listShelves(userId: string) {
  const db = getDb()
  const rows = db
    .select({
      shelf: shelves,
      bookCount: sql<number>`count(${books.id})`,
    })
    .from(shelves)
    .leftJoin(books, eq(shelves.id, books.shelfId))
    .where(eq(shelves.userId, userId))
    .groupBy(shelves.id)
    .orderBy(asc(shelves.sortOrder), asc(shelves.createdAt))
    .all()
  return rows.map((r) => ({ ...r.shelf, bookCount: r.bookCount }))
}

export async function createShelf(userId: string, name: string) {
  const db = getDb()
  const now = Date.now()
  const id = createId('shelf')
  // New shelves always land last: the list orders by (sortOrder, createdAt), so
  // a default 0 would jump to the front once a reorder has written dense ranks.
  const max = db
    .select({ max: sql<number>`max(${shelves.sortOrder})` })
    .from(shelves)
    .where(eq(shelves.userId, userId))
    .get()
  const sortOrder = (max?.max ?? -1) + 1
  db.insert(shelves).values({ id, userId, name, sortOrder, createdAt: now }).run()
  return { id, userId, name, sortOrder, createdAt: now, bookCount: 0 }
}

export async function reorderShelves(userId: string, shelfIds: string[]) {
  const db = getDb()
  // The submitted list must be the user's full shelf set — anything less would
  // leave stragglers on stale ranks that collide with the rewritten ones.
  const existing = db
    .select({ id: shelves.id })
    .from(shelves)
    .where(eq(shelves.userId, userId))
    .all()
  const owned = new Set(existing.map((s) => s.id))
  if (shelfIds.length !== owned.size || shelfIds.some((id) => !owned.has(id))) {
    throw new AppError('SHELF_NOT_FOUND')
  }
  db.transaction((tx) => {
    for (const [index, id] of shelfIds.entries()) {
      tx.update(shelves).set({ sortOrder: index }).where(eq(shelves.id, id)).run()
    }
  })
}

export async function updateShelf(userId: string, shelfId: string, name: string) {
  const db = getDb()
  const existing = await getShelf(userId, shelfId)
  if (!existing) throw new AppError('SHELF_NOT_FOUND')
  db.update(shelves).set({ name }).where(eq(shelves.id, shelfId)).run()
  return { ...existing, name }
}

export async function deleteShelf(userId: string, shelfId: string) {
  const db = getDb()
  const existing = await getShelf(userId, shelfId)
  if (!existing) throw new AppError('SHELF_NOT_FOUND')
  // books.shelfId FK is ON DELETE SET NULL: books become uncategorized
  db.delete(shelves).where(eq(shelves.id, shelfId)).run()
  return existing
}

export async function moveBooksToShelf(userId: string, shelfId: string, bookIds: string[]) {
  const db = getDb()
  await verifyShelfOwnership(userId, shelfId)
  await verifyBookOwnership(userId, bookIds)
  if (bookIds.length === 0) return
  db.update(books)
    .set({ shelfId })
    .where(and(eq(books.userId, userId), inArray(books.id, bookIds)))
    .run()
}

export async function removeBooksFromShelf(userId: string, shelfId: string, bookIds: string[]) {
  const db = getDb()
  await verifyShelfOwnership(userId, shelfId)
  if (bookIds.length === 0) return
  db.update(books)
    .set({ shelfId: null })
    .where(and(eq(books.userId, userId), eq(books.shelfId, shelfId), inArray(books.id, bookIds)))
    .run()
}

async function getShelf(userId: string, shelfId: string) {
  const db = getDb()
  return db.select().from(shelves).where(and(eq(shelves.id, shelfId), eq(shelves.userId, userId))).get()
}

async function verifyShelfOwnership(userId: string, shelfIdOrIds: string | string[]) {
  const ids = Array.isArray(shelfIdOrIds) ? shelfIdOrIds : [shelfIdOrIds]
  const db = getDb()
  const existing = db
    .select({ count: sql<number>`count(*)` })
    .from(shelves)
    .where(and(eq(shelves.userId, userId), inArray(shelves.id, ids)))
    .get()
  if ((existing?.count ?? 0) !== ids.length) {
    throw new AppError('SHELF_NOT_FOUND')
  }
}

async function verifyBookOwnership(userId: string, bookIds: string[]) {
  const db = getDb()
  const existing = db
    .select({ count: sql<number>`count(*)` })
    .from(books)
    .where(and(eq(books.userId, userId), inArray(books.id, bookIds)))
    .get()
  if ((existing?.count ?? 0) !== bookIds.length) {
    throw new AppError('BOOK_NOT_FOUND')
  }
}
