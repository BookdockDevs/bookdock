import { eq, and, inArray, isNull, notInArray, sql, asc, ne, type SQL } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookVersions, libraryCategories } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { ensurePrivateLibrary, isLibraryManager, requireLibraryManager, assertLibraryBrowsable } from '../libraries/library-access'
import { hiddenTagExclusion, loadLibraryHiddenTaxonomy, workDirectHiddenExclusion } from '../libraries/library-query'

function privateLibraryId(userId: string): string | null {
  const db = getDb()
  return db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()?.id ?? null
}

function requirePrivateLibrary(userId: string): string {
  return ensurePrivateLibrary(getDb(), userId)
}

export async function listShelves(userId: string, showHidden = false) {
  const db = getDb()
  const libraryId = privateLibraryId(userId)
  if (!libraryId) return []
  // Private vault: hidden shelves stay out unless the owner reveals them.
  // Counts mirror the book list: works hidden directly or through a hidden
  // tag are not counted (the shelf itself is visible here, so the category
  // dimension cannot hide anything counted under it).
  const taxonomy = showHidden ? null : loadLibraryHiddenTaxonomy(db, libraryId)
  const countExtra: SQL[] = []
  if (taxonomy) {
    countExtra.push(workDirectHiddenExclusion())
    const tag = hiddenTagExclusion(taxonomy.hiddenTagIds)
    if (tag) countExtra.push(tag)
  }
  const shelfFilter = taxonomy && taxonomy.hiddenCategoryIds.length > 0
    ? notInArray(libraryCategories.id, taxonomy.hiddenCategoryIds)
    : undefined
  const rows = db
    .select({
      id: libraryCategories.id,
      userId: libraryCategories.userId,
      name: libraryCategories.name,
      sortOrder: libraryCategories.sortOrder,
      createdAt: libraryCategories.createdAt,
      updatedAt: libraryCategories.updatedAt,
      pinned: libraryCategories.pinned,
      hidden: libraryCategories.hidden,
      bookCount: sql<number>`count(${libraryBooks.id})`,
    })
    .from(libraryCategories)
    .leftJoin(libraryBooks, and(eq(libraryCategories.id, libraryBooks.categoryId), isNull(libraryBooks.deletedAt), ...countExtra))
    .where(shelfFilter ? and(eq(libraryCategories.libraryId, libraryId), shelfFilter) : eq(libraryCategories.libraryId, libraryId))
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
      id, libraryId, userId, name, parentId: null, sortOrder, pinned: false, hidden: false, createdAt: now, updatedAt: now,
    }).run()
    return { id, userId, name, sortOrder, createdAt: now, updatedAt: now, pinned: false, hidden: false, bookCount: 0 }
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

export async function updateShelf(userId: string, shelfId: string, patch: { name?: string; pinned?: boolean; hidden?: boolean }) {
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

/**
 * `bookCount` is part of the category shape a private shelf already returns, so
 * the sidebar can render one row component for every library instead of a
 * count-less variant. Counted here rather than in the list query because the
 * single-row call sites (create, rename, delete) also answer with a category.
 */
function toCategoryRes(row: typeof libraryCategories.$inferSelect) {
  const bookCount = getDb().select({ count: sql<number>`count(${libraryBooks.id})` })
    .from(libraryBooks)
    .where(and(eq(libraryBooks.categoryId, row.id), isNull(libraryBooks.deletedAt)))
    .get()?.count ?? 0
  return {
    id: row.id,
    libraryId: row.libraryId,
    userId: row.userId,
    name: row.name,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    pinned: row.pinned,
    hidden: row.hidden,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    bookCount,
  }
}

function getLibraryCategory(libraryId: string, categoryId: string) {
  const db = getDb()
  const row = db.select().from(libraryCategories)
    .where(and(eq(libraryCategories.id, categoryId), eq(libraryCategories.libraryId, libraryId))).get()
  if (!row) throw new AppError('CATEGORY_NOT_FOUND', 'Category not found')
  return row
}

/**
 * Library-scoped category management (4.4): owners and admins of any
 * library curate its taxonomy; members and outsiders are refused by
 * requireLibraryManager before any row is touched.
 */
export async function listLibraryCategories(actorId: string, libraryId: string) {
  const db = getDb()
  await assertLibraryBrowsable(actorId, libraryId)
  // Shared asymmetry: managers always see hidden rows (badged); members never
  // do. Counts mirror what each viewer can list: hidden works are excluded
  // for members through every dimension except the category itself (a hidden
  // category never reaches a member's list in the first place). A hidden tag
  // on the work hides it here too, which is what listTags also applies.
  const manager = await isLibraryManager(actorId, libraryId)
  const taxonomy = manager ? null : loadLibraryHiddenTaxonomy(db, libraryId)
  const countExtra: SQL[] = []
  if (taxonomy) {
    countExtra.push(workDirectHiddenExclusion())
    const tag = hiddenTagExclusion(taxonomy.hiddenTagIds)
    if (tag) countExtra.push(tag)
  }
  const rowFilter = taxonomy && taxonomy.hiddenCategoryIds.length > 0
    ? notInArray(libraryCategories.id, taxonomy.hiddenCategoryIds)
    : undefined
  // Counts ride along in the same grouped query: one query for N rows, not
  // N+1. Single-row call sites (create, rename, delete) keep toCategoryRes.
  return db
    .select({
      id: libraryCategories.id,
      libraryId: libraryCategories.libraryId,
      userId: libraryCategories.userId,
      name: libraryCategories.name,
      parentId: libraryCategories.parentId,
      sortOrder: libraryCategories.sortOrder,
      pinned: libraryCategories.pinned,
      hidden: libraryCategories.hidden,
      createdAt: libraryCategories.createdAt,
      updatedAt: libraryCategories.updatedAt,
      bookCount: sql<number>`count(${libraryBooks.id})`,
    })
    .from(libraryCategories)
    .leftJoin(libraryBooks, and(eq(libraryCategories.id, libraryBooks.categoryId), isNull(libraryBooks.deletedAt), ...countExtra))
    .where(rowFilter ? and(eq(libraryCategories.libraryId, libraryId), rowFilter) : eq(libraryCategories.libraryId, libraryId))
    .groupBy(libraryCategories.id)
    .orderBy(asc(libraryCategories.sortOrder), asc(libraryCategories.createdAt))
    .all()
}

export async function createLibraryCategory(actorId: string, libraryId: string, data: { name: string; parentId?: string }) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  return db.transaction((tx) => {
    const duplicate = tx.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(eq(libraryCategories.libraryId, libraryId), eq(libraryCategories.name, data.name))).get()
    if (duplicate) throw new AppError('CATEGORY_NAME_TAKEN', 'Category name is already in use')
    if (data.parentId) getLibraryCategory(libraryId, data.parentId)
    const max = tx.select({ max: sql<number>`max(${libraryCategories.sortOrder})` }).from(libraryCategories)
      .where(eq(libraryCategories.libraryId, libraryId)).get()
    const now = Date.now()
    const row = {
      id: createId('cat'), libraryId, userId: actorId, name: data.name,
      parentId: data.parentId ?? null, sortOrder: (max?.max ?? -1) + 1,
      pinned: false, hidden: false, createdAt: now, updatedAt: now,
    }
    tx.insert(libraryCategories).values(row).run()
    return toCategoryRes(row)
  })
}

export async function updateLibraryCategory(actorId: string, libraryId: string, categoryId: string, patch: { name?: string; pinned?: boolean; hidden?: boolean }) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  return db.transaction((tx) => {
    const existing = getLibraryCategory(libraryId, categoryId)
    if (patch.name !== undefined && patch.name !== existing.name) {
      const duplicate = tx.select({ id: libraryCategories.id }).from(libraryCategories)
        .where(and(eq(libraryCategories.libraryId, libraryId), eq(libraryCategories.name, patch.name), ne(libraryCategories.id, categoryId))).get()
      if (duplicate) throw new AppError('CATEGORY_NAME_TAKEN', 'Category name is already in use')
    }
    tx.update(libraryCategories).set({ ...patch, updatedAt: Date.now() }).where(eq(libraryCategories.id, categoryId)).run()
    return toCategoryRes({ ...existing, ...patch, updatedAt: Date.now() })
  })
}

export async function setLibraryCategoryParent(actorId: string, libraryId: string, categoryId: string, parentId: string | null) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const existing = getLibraryCategory(libraryId, categoryId)
  if (parentId === existing.parentId) return toCategoryRes(existing)
  if (parentId !== null) {
    if (parentId === categoryId) throw new AppError('VALIDATION_ERROR', 'A category cannot parent itself')
    getLibraryCategory(libraryId, parentId)
    // Walk up: the new parent must not descend from the category itself.
    let cursor: string | null = parentId
    while (cursor) {
      if (cursor === categoryId) throw new AppError('VALIDATION_ERROR', 'Category parenting would create a cycle')
      cursor = db.select({ parentId: libraryCategories.parentId }).from(libraryCategories)
        .where(and(eq(libraryCategories.id, cursor), eq(libraryCategories.libraryId, libraryId))).get()?.parentId ?? null
    }
  }
  const now = Date.now()
  db.update(libraryCategories).set({ parentId, updatedAt: now }).where(eq(libraryCategories.id, categoryId)).run()
  return toCategoryRes({ ...existing, parentId, updatedAt: now })
}

export async function reorderLibraryCategories(actorId: string, libraryId: string, categoryIds: string[]) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const existing = db.select({ id: libraryCategories.id }).from(libraryCategories)
    .where(eq(libraryCategories.libraryId, libraryId)).all()
  const owned = new Set(existing.map((row) => row.id))
  if (categoryIds.length !== owned.size || new Set(categoryIds).size !== owned.size || categoryIds.some((id) => !owned.has(id))) {
    throw new AppError('CATEGORY_NOT_FOUND')
  }
  db.transaction((tx) => {
    for (const [index, id] of categoryIds.entries()) {
      tx.update(libraryCategories).set({ sortOrder: index }).where(eq(libraryCategories.id, id)).run()
    }
  })
}

export async function deleteLibraryCategory(actorId: string, libraryId: string, categoryId: string) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const existing = getLibraryCategory(libraryId, categoryId)
  // Books fall back to uncategorized (FK SET NULL); child categories become roots.
  db.delete(libraryCategories).where(eq(libraryCategories.id, categoryId)).run()
  return toCategoryRes(existing)
}
