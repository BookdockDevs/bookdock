import { and, asc, eq, inArray, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookVersions, libraryCategories, shelves } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { assertLibraryBrowsable, ensurePrivateLibrary, isLibraryManager, requireLibraryManager } from '../libraries/library-access'
import { hiddenShelfExclusion, hiddenTagExclusion, loadLibraryHiddenTaxonomy, publishedWorkExists, workDirectHiddenExclusion, workHiddenExclusion } from '../libraries/library-query'

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

function toCategoryRes(row: typeof libraryCategories.$inferSelect) {
  const db = getDb()
  const bookCount = db.select({ count: sql<number>`count(${libraryBooks.id})` }).from(libraryBooks)
    .where(and(eq(libraryBooks.categoryId, row.id), isNull(libraryBooks.deletedAt))).get()?.count ?? 0
  const childCount = db.select({ count: sql<number>`count(${libraryBooks.id})` }).from(libraryBooks)
    .where(and(isNull(libraryBooks.deletedAt), inArray(libraryBooks.categoryId,
      db.select({ id: libraryCategories.id }).from(libraryCategories)
        .where(and(eq(libraryCategories.libraryId, row.libraryId), eq(libraryCategories.parentId, row.id))),
    ))).get()?.count ?? 0
  return { ...row, bookCount, subtreeBookCount: bookCount + childCount }
}

function getLibraryCategory(libraryId: string, categoryId: string) {
  const row = getDb().select().from(libraryCategories)
    .where(and(eq(libraryCategories.id, categoryId), eq(libraryCategories.libraryId, libraryId))).get()
  if (!row) throw new AppError('CATEGORY_NOT_FOUND', 'Category not found')
  return row
}

export async function listLibraryCategories(actorId: string, libraryId: string) {
  const db = getDb()
  await assertLibraryBrowsable(actorId, libraryId)
  const manager = await isLibraryManager(actorId, libraryId)
  const taxonomy = manager ? null : loadLibraryHiddenTaxonomy(db, libraryId)
  const countExtra: SQL[] = []
  if (!manager) countExtra.push(publishedWorkExists())
  if (taxonomy) {
    countExtra.push(workDirectHiddenExclusion())
    const shelf = hiddenShelfExclusion(taxonomy.hiddenShelfIds)
    if (shelf) countExtra.push(shelf)
    const tag = hiddenTagExclusion(taxonomy.hiddenTagIds)
    if (tag) countExtra.push(tag)
  }
  const rowFilter = taxonomy && taxonomy.hiddenCategoryIds.length > 0
    ? notInArray(libraryCategories.id, taxonomy.hiddenCategoryIds)
    : undefined
  const rows = db.select({
    id: libraryCategories.id, libraryId: libraryCategories.libraryId, userId: libraryCategories.userId,
    name: libraryCategories.name, parentId: libraryCategories.parentId, sortOrder: libraryCategories.sortOrder,
    pinned: libraryCategories.pinned, hidden: libraryCategories.hidden,
    createdAt: libraryCategories.createdAt, updatedAt: libraryCategories.updatedAt,
    bookCount: sql<number>`count(${libraryBooks.id})`,
  }).from(libraryCategories)
    .leftJoin(libraryBooks, and(eq(libraryCategories.id, libraryBooks.categoryId), isNull(libraryBooks.deletedAt), ...countExtra))
    .where(rowFilter ? and(eq(libraryCategories.libraryId, libraryId), rowFilter) : eq(libraryCategories.libraryId, libraryId))
    .groupBy(libraryCategories.id)
    .orderBy(asc(libraryCategories.sortOrder), asc(libraryCategories.createdAt)).all()
  const byId = new Map(rows.map((row) => [row.id, row]))
  const subtreeCounts = new Map(rows.map((row) => [row.id, row.bookCount]))
  for (const row of rows) {
    const seen = new Set([row.id])
    let parentId = row.parentId
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      subtreeCounts.set(parentId, (subtreeCounts.get(parentId) ?? 0) + row.bookCount)
      parentId = parent.parentId
    }
  }
  return rows.map((row) => ({ ...row, subtreeBookCount: subtreeCounts.get(row.id) ?? row.bookCount }))
}

function validateCategoryParent(libraryId: string, parentId: string | null, categoryId?: string) {
  if (parentId === null) return
  if (parentId === categoryId) throw new AppError('VALIDATION_ERROR', 'A category cannot parent itself')
  const parent = getLibraryCategory(libraryId, parentId)
  if (parent.parentId !== null) throw new AppError('VALIDATION_ERROR', 'Categories support at most two levels')
  if (categoryId && getDb().select({ id: libraryCategories.id }).from(libraryCategories)
    .where(and(eq(libraryCategories.libraryId, libraryId), eq(libraryCategories.parentId, categoryId))).get()) {
    throw new AppError('VALIDATION_ERROR', 'A category with children must remain a root')
  }
}

function findCategoryByPath(libraryId: string, name: string, parentId: string | null, excludingId?: string) {
  const filters = [eq(libraryCategories.libraryId, libraryId), eq(libraryCategories.name, name)]
  filters.push(parentId === null ? isNull(libraryCategories.parentId) : eq(libraryCategories.parentId, parentId))
  if (excludingId) filters.push(ne(libraryCategories.id, excludingId))
  return getDb().select({ id: libraryCategories.id }).from(libraryCategories).where(and(...filters)).get()
}

export async function createLibraryCategory(actorId: string, libraryId: string, data: { name: string; parentId?: string }) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  return db.transaction((tx) => {
    const parentId = data.parentId ?? null
    validateCategoryParent(libraryId, parentId)
    const duplicate = findCategoryByPath(libraryId, data.name, parentId)
    if (duplicate) throw new AppError('CATEGORY_NAME_TAKEN', 'Category name is already in use')
    const max = tx.select({ max: sql<number>`max(${libraryCategories.sortOrder})` }).from(libraryCategories)
      .where(eq(libraryCategories.libraryId, libraryId)).get()
    const now = Date.now()
    const row = {
      id: createId('cat'), libraryId, userId: actorId, name: data.name, parentId,
      sortOrder: (max?.max ?? -1) + 1, pinned: false, hidden: false, createdAt: now, updatedAt: now,
    }
    tx.insert(libraryCategories).values(row).run()
    return toCategoryRes(row)
  })
}

export async function updateLibraryCategory(actorId: string, libraryId: string, categoryId: string, patch: { name?: string; parentId?: string | null; pinned?: boolean; hidden?: boolean }) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  return db.transaction((tx) => {
    const existing = getLibraryCategory(libraryId, categoryId)
    const parentId = patch.parentId === undefined ? existing.parentId : patch.parentId
    if (patch.parentId !== undefined) validateCategoryParent(libraryId, parentId, categoryId)
    if (patch.name !== undefined && (patch.name !== existing.name || parentId !== existing.parentId)) {
      if (findCategoryByPath(libraryId, patch.name, parentId, categoryId)) throw new AppError('CATEGORY_NAME_TAKEN', 'Category name is already in use')
    }
    const updatedAt = Date.now()
    tx.update(libraryCategories).set({ ...patch, updatedAt }).where(eq(libraryCategories.id, categoryId)).run()
    return toCategoryRes({ ...existing, ...patch, updatedAt })
  })
}

export async function setLibraryCategoryParent(actorId: string, libraryId: string, categoryId: string, parentId: string | null) {
  return updateLibraryCategory(actorId, libraryId, categoryId, { parentId })
}

export async function reorderLibraryCategories(actorId: string, libraryId: string, categoryIds: string[]) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const existing = db.select({ id: libraryCategories.id }).from(libraryCategories).where(eq(libraryCategories.libraryId, libraryId)).all()
  const owned = new Set(existing.map((row) => row.id))
  if (categoryIds.length !== owned.size || new Set(categoryIds).size !== owned.size || categoryIds.some((id) => !owned.has(id))) {
    throw new AppError('CATEGORY_NOT_FOUND')
  }
  db.transaction((tx) => {
    for (const [index, id] of categoryIds.entries()) tx.update(libraryCategories).set({ sortOrder: index }).where(eq(libraryCategories.id, id)).run()
  })
}

export async function deleteLibraryCategory(actorId: string, libraryId: string, categoryId: string) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const existing = getLibraryCategory(libraryId, categoryId)
  db.delete(libraryCategories).where(eq(libraryCategories.id, categoryId)).run()
  return toCategoryRes(existing)
}
