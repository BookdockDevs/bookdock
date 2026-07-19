import { eq, and, inArray, sql, asc } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { books, shelves, bookShelves } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'

export async function listShelves(userId: string) {
  const db = getDb()
  const rows = db
    .select({
      shelf: shelves,
      bookCount: sql<number>`count(${bookShelves.bookId})`,
    })
    .from(shelves)
    .leftJoin(bookShelves, eq(shelves.id, bookShelves.shelfId))
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
  db.insert(shelves).values({ id, userId, name, sortOrder: 0, createdAt: now }).run()
  return { id, userId, name, sortOrder: 0, createdAt: now, bookCount: 0 }
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
  db.delete(bookShelves).where(eq(bookShelves.shelfId, shelfId)).run()
  db.delete(shelves).where(eq(shelves.id, shelfId)).run()
  return existing
}

export async function addBooksToShelf(userId: string, shelfId: string, bookIds: string[]) {
  const db = getDb()
  await verifyShelfOwnership(userId, shelfId)
  await verifyBookOwnership(userId, bookIds)
  if (bookIds.length === 0) return
  const values = bookIds.map((bookId) => ({ bookId, shelfId, sortOrder: 0 }))
  db.insert(bookShelves).values(values).onConflictDoNothing().run()
}

export async function removeBooksFromShelf(userId: string, shelfId: string, bookIds: string[]) {
  const db = getDb()
  await verifyShelfOwnership(userId, shelfId)
  if (bookIds.length === 0) return
  db.delete(bookShelves)
    .where(and(eq(bookShelves.shelfId, shelfId), inArray(bookShelves.bookId, bookIds)))
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
