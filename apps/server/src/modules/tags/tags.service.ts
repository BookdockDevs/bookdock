import { eq, and, inArray, isNull, sql, asc, ne } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { books, tags, bookTags } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'

export async function listTags(userId: string) {
  const db = getDb()
  const rows = db
    .select({
      tag: tags,
      bookCount: sql<number>`count(${books.id})`,
    })
    .from(tags)
    .leftJoin(bookTags, eq(tags.id, bookTags.tagId))
    .leftJoin(books, and(eq(books.id, bookTags.bookId), isNull(books.deletedAt)))
    .where(eq(tags.userId, userId))
    .groupBy(tags.id)
    .orderBy(asc(tags.sortOrder), asc(tags.name))
    .all()
  return rows.map((r) => ({ ...r.tag, bookCount: r.bookCount }))
}

export async function createTag(userId: string, name: string) {
  const db = getDb()
  return db.transaction((tx) => {
    const existing = tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, userId), eq(tags.name, name)))
      .get()
    if (existing) throw new AppError('TAG_NAME_TAKEN', 'Tag name is already in use')

    const id = createId('tag')
    const now = Date.now()
    const max = tx
      .select({ max: sql<number>`max(${tags.sortOrder})` })
      .from(tags)
      .where(eq(tags.userId, userId))
      .get()
    const sortOrder = (max?.max ?? -1) + 1
    tx.insert(tags).values({ id, userId, name, sortOrder, createdAt: now, updatedAt: now }).run()
    return { id, userId, name, sortOrder, createdAt: now, updatedAt: now, pinned: false, bookCount: 0 }
  })
}

export async function reorderTags(userId: string, tagIds: string[]) {
  const db = getDb()
  const existing = db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.userId, userId))
    .all()
  const owned = new Set(existing.map((tag) => tag.id))
  if (tagIds.length !== owned.size || new Set(tagIds).size !== owned.size || tagIds.some((id) => !owned.has(id))) {
    throw new AppError('TAG_NOT_FOUND')
  }
  db.transaction((tx) => {
    for (const [index, id] of tagIds.entries()) {
      tx.update(tags).set({ sortOrder: index }).where(eq(tags.id, id)).run()
    }
  })
}

export async function updateTag(userId: string, tagId: string, patch: { name?: string; pinned?: boolean }) {
  const db = getDb()
  return db.transaction((tx) => {
    const existing = tx.select().from(tags).where(and(eq(tags.id, tagId), eq(tags.userId, userId))).get()
    if (!existing) throw new AppError('TAG_NOT_FOUND')
    if (patch.name !== undefined && patch.name !== existing.name) {
      const duplicate = tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.userId, userId), eq(tags.name, patch.name), ne(tags.id, tagId)))
        .get()
      if (duplicate) throw new AppError('TAG_NAME_TAKEN', 'Tag name is already in use')
    }
    tx.update(tags).set(patch).where(eq(tags.id, tagId)).run()
    return { ...existing, ...patch }
  })
}

export async function deleteTag(userId: string, tagId: string) {
  const db = getDb()
  const existing = await getTag(userId, tagId)
  if (!existing) throw new AppError('TAG_NOT_FOUND')
  db.delete(bookTags).where(eq(bookTags.tagId, tagId)).run()
  db.delete(tags).where(eq(tags.id, tagId)).run()
  return existing
}

export async function addBooksToTag(userId: string, tagId: string, bookIds: string[]) {
  const db = getDb()
  await verifyTagOwnership(userId, tagId)
  await verifyBookOwnership(userId, bookIds)
  if (bookIds.length === 0) return
  const values = bookIds.map((bookId) => ({ bookId, tagId }))
  db.insert(bookTags).values(values).onConflictDoNothing().run()
}

export async function removeBooksFromTag(userId: string, tagId: string, bookIds: string[]) {
  const db = getDb()
  await verifyTagOwnership(userId, tagId)
  if (bookIds.length === 0) return
  db.delete(bookTags)
    .where(and(eq(bookTags.tagId, tagId), inArray(bookTags.bookId, bookIds)))
    .run()
}

async function getTag(userId: string, tagId: string) {
  const db = getDb()
  return db.select().from(tags).where(and(eq(tags.id, tagId), eq(tags.userId, userId))).get()
}

async function verifyTagOwnership(userId: string, tagIdOrIds: string | string[]) {
  const ids = Array.isArray(tagIdOrIds) ? tagIdOrIds : [tagIdOrIds]
  const db = getDb()
  const existing = db
    .select({ count: sql<number>`count(*)` })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.id, ids)))
    .get()
  if ((existing?.count ?? 0) !== ids.length) {
    throw new AppError('TAG_NOT_FOUND')
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
