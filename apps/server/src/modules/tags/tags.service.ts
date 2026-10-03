import { eq, and, inArray, isNull, notInArray, sql, asc, ne, type SQL } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookTags, libraryBookVersions, libraryTags } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { ensurePrivateLibrary, isLibraryManager, requireLibraryManager, assertLibraryBrowsable } from '../libraries/library-access'
import { hiddenCategoryExclusion, hiddenTagExclusion, loadLibraryHiddenTaxonomy, publishedWorkExists, workDirectHiddenExclusion } from '../libraries/library-query'

function privateLibraryId(userId: string): string | null {
  const db = getDb()
  return db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()?.id ?? null
}

function requirePrivateLibrary(userId: string): string {
  return ensurePrivateLibrary(getDb(), userId)
}

export async function listTags(userId: string, showHidden = false) {
  const db = getDb()
  const libraryId = privateLibraryId(userId)
  if (!libraryId) return []
  // Private vault: hidden tags stay out unless the owner reveals them.
  // Counts mirror the book list, so a sibling's count drops when a work is
  // hidden through *any* dimension: directly, through a hidden category, or
  // through another hidden tag. Excluding only the first two left a tag's
  // capsule disagreeing with the list it counts.
  const taxonomy = showHidden ? null : loadLibraryHiddenTaxonomy(db, libraryId)
  const countExtra: SQL[] = []
  if (taxonomy) {
    countExtra.push(workDirectHiddenExclusion())
    const category = hiddenCategoryExclusion(taxonomy.hiddenCategoryIds)
    if (category) countExtra.push(category)
    const tag = hiddenTagExclusion(taxonomy.hiddenTagIds)
    if (tag) countExtra.push(tag)
  }
  const tagFilter = taxonomy && taxonomy.hiddenTagIds.length > 0
    ? notInArray(libraryTags.id, taxonomy.hiddenTagIds)
    : undefined
  const rows = db
    .select({
      id: libraryTags.id,
      userId: libraryTags.userId,
      name: libraryTags.name,
      sortOrder: libraryTags.sortOrder,
      createdAt: libraryTags.createdAt,
      updatedAt: libraryTags.updatedAt,
      pinned: libraryTags.pinned,
      hidden: libraryTags.hidden,
      bookCount: sql<number>`count(${libraryBooks.id})`,
    })
    .from(libraryTags)
    .leftJoin(libraryBookTags, eq(libraryTags.id, libraryBookTags.tagId))
    .leftJoin(libraryBooks, and(eq(libraryBooks.id, libraryBookTags.libraryBookId), isNull(libraryBooks.deletedAt), ...countExtra))
    .where(tagFilter ? and(eq(libraryTags.libraryId, libraryId), tagFilter) : eq(libraryTags.libraryId, libraryId))
    .groupBy(libraryTags.id)
    .orderBy(asc(libraryTags.sortOrder), asc(libraryTags.name))
    .all()
  return rows
}

export async function createTag(userId: string, name: string) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  return db.transaction((tx) => {
    const existing = tx
      .select({ id: libraryTags.id })
      .from(libraryTags)
      .where(and(eq(libraryTags.libraryId, libraryId), eq(libraryTags.name, name)))
      .get()
    if (existing) throw new AppError('TAG_NAME_TAKEN', 'Tag name is already in use')

    const id = createId('tag')
    const now = Date.now()
    const max = tx
      .select({ max: sql<number>`max(${libraryTags.sortOrder})` })
      .from(libraryTags)
      .where(eq(libraryTags.libraryId, libraryId))
      .get()
    const sortOrder = (max?.max ?? -1) + 1
    tx.insert(libraryTags).values({ id, libraryId, userId, name, sortOrder, pinned: false, hidden: false, createdAt: now, updatedAt: now }).run()
    return { id, userId, name, sortOrder, createdAt: now, updatedAt: now, pinned: false, hidden: false, bookCount: 0 }
  })
}

export async function reorderTags(userId: string, tagIds: string[]) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  const existing = db
    .select({ id: libraryTags.id })
    .from(libraryTags)
    .where(eq(libraryTags.libraryId, libraryId))
    .all()
  const owned = new Set(existing.map((tag) => tag.id))
  if (tagIds.length !== owned.size || new Set(tagIds).size !== owned.size || tagIds.some((id) => !owned.has(id))) {
    throw new AppError('TAG_NOT_FOUND')
  }
  db.transaction((tx) => {
    for (const [index, id] of tagIds.entries()) {
      tx.update(libraryTags).set({ sortOrder: index }).where(eq(libraryTags.id, id)).run()
    }
  })
}

export async function updateTag(userId: string, tagId: string, patch: { name?: string; pinned?: boolean; hidden?: boolean }) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  return db.transaction((tx) => {
    const existing = tx.select().from(libraryTags)
      .where(and(eq(libraryTags.id, tagId), eq(libraryTags.libraryId, libraryId))).get()
    if (!existing) throw new AppError('TAG_NOT_FOUND')
    if (patch.name !== undefined && patch.name !== existing.name) {
      const duplicate = tx
        .select({ id: libraryTags.id })
        .from(libraryTags)
        .where(and(eq(libraryTags.libraryId, libraryId), eq(libraryTags.name, patch.name), ne(libraryTags.id, tagId)))
        .get()
      if (duplicate) throw new AppError('TAG_NAME_TAKEN', 'Tag name is already in use')
    }
    tx.update(libraryTags).set(patch).where(eq(libraryTags.id, tagId)).run()
    const { libraryId: _libraryId, ...tag } = { ...existing, ...patch }
    return tag
  })
}

export async function deleteTag(userId: string, tagId: string) {
  const db = getDb()
  const existing = await getTag(userId, tagId)
  if (!existing) throw new AppError('TAG_NOT_FOUND')
  // Relations cascade off the tag row.
  db.delete(libraryTags).where(eq(libraryTags.id, tagId)).run()
  const { libraryId: _libraryId, ...tag } = existing
  return tag
}

export async function addBooksToTag(userId: string, tagId: string, bookIds: string[]) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  await verifyTagOwnership(libraryId, tagId)
  const libraryBookIds = await verifyBookOwnership(libraryId, bookIds)
  if (bookIds.length === 0) return
  const values = libraryBookIds.map((libraryBookId) => ({ libraryBookId, tagId }))
  db.insert(libraryBookTags).values(values).onConflictDoNothing().run()
  db.update(libraryTags).set({ updatedAt: Date.now() }).where(eq(libraryTags.id, tagId)).run()
}

export async function removeBooksFromTag(userId: string, tagId: string, bookIds: string[]) {
  const db = getDb()
  const libraryId = requirePrivateLibrary(userId)
  await verifyTagOwnership(libraryId, tagId)
  if (bookIds.length === 0) return
  const libraryBookIds = await verifyBookOwnership(libraryId, bookIds)
  db.delete(libraryBookTags)
    .where(and(eq(libraryBookTags.tagId, tagId), inArray(libraryBookTags.libraryBookId, libraryBookIds)))
    .run()
  db.update(libraryTags).set({ updatedAt: Date.now() }).where(eq(libraryTags.id, tagId)).run()
}

async function getTag(userId: string, tagId: string) {
  const db = getDb()
  const libraryId = privateLibraryId(userId)
  if (!libraryId) return undefined
  return db.select().from(libraryTags)
    .where(and(eq(libraryTags.id, tagId), eq(libraryTags.libraryId, libraryId))).get()
}

async function verifyTagOwnership(libraryId: string, tagIdOrIds: string | string[]) {
  const ids = Array.isArray(tagIdOrIds) ? tagIdOrIds : [tagIdOrIds]
  const db = getDb()
  const existing = db
    .select({ count: sql<number>`count(*)` })
    .from(libraryTags)
    .where(and(eq(libraryTags.libraryId, libraryId), inArray(libraryTags.id, ids)))
    .get()
  if ((existing?.count ?? 0) !== ids.length) {
    throw new AppError('TAG_NOT_FOUND')
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
 * `bookCount` mirrors what a private tag already reports, so the sidebar uses
 * one row component for every library (see toCategoryRes for why it is counted
 * here rather than in the list query).
 */
function toLibraryTagRes(row: typeof libraryTags.$inferSelect) {
  const bookCount = getDb().select({ count: sql<number>`count(${libraryBooks.id})` })
    .from(libraryBookTags)
    .leftJoin(libraryBooks, and(eq(libraryBooks.id, libraryBookTags.libraryBookId), isNull(libraryBooks.deletedAt)))
    .where(eq(libraryBookTags.tagId, row.id))
    .get()?.count ?? 0
  return {
    id: row.id,
    libraryId: row.libraryId,
    userId: row.userId,
    name: row.name,
    sortOrder: row.sortOrder,
    pinned: row.pinned,
    hidden: row.hidden,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    bookCount,
  }
}

/**
 * Library-scoped tag maintenance (4.4): owners and admins curate the shared
 * taxonomy; the per-book tagging itself stays a catalog concern (Phase 5).
 */
export async function listLibraryTags(actorId: string, libraryId: string) {
  const db = getDb()
  await assertLibraryBrowsable(actorId, libraryId)
  // Shared asymmetry: managers always see hidden rows (badged); members never
  // do. Counts mirror what each viewer can list (see listLibraryCategories).
  const manager = await isLibraryManager(actorId, libraryId)
  const taxonomy = manager ? null : loadLibraryHiddenTaxonomy(db, libraryId)
  const countExtra: SQL[] = []
  if (!manager) countExtra.push(publishedWorkExists())
  if (taxonomy) {
    countExtra.push(workDirectHiddenExclusion())
    const category = hiddenCategoryExclusion(taxonomy.hiddenCategoryIds)
    if (category) countExtra.push(category)
    const tag = hiddenTagExclusion(taxonomy.hiddenTagIds)
    if (tag) countExtra.push(tag)
  }
  const rowFilter = taxonomy && taxonomy.hiddenTagIds.length > 0
    ? notInArray(libraryTags.id, taxonomy.hiddenTagIds)
    : undefined
  // Counts ride along in the same grouped query: one query for N rows, not
  // N+1. Single-row call sites keep toLibraryTagRes.
  return db
    .select({
      id: libraryTags.id,
      libraryId: libraryTags.libraryId,
      userId: libraryTags.userId,
      name: libraryTags.name,
      sortOrder: libraryTags.sortOrder,
      pinned: libraryTags.pinned,
      hidden: libraryTags.hidden,
      createdAt: libraryTags.createdAt,
      updatedAt: libraryTags.updatedAt,
      bookCount: sql<number>`count(${libraryBooks.id})`,
    })
    .from(libraryTags)
    .leftJoin(libraryBookTags, eq(libraryTags.id, libraryBookTags.tagId))
    .leftJoin(libraryBooks, and(eq(libraryBooks.id, libraryBookTags.libraryBookId), isNull(libraryBooks.deletedAt), ...countExtra))
    .where(rowFilter ? and(eq(libraryTags.libraryId, libraryId), rowFilter) : eq(libraryTags.libraryId, libraryId))
    .groupBy(libraryTags.id)
    .orderBy(asc(libraryTags.sortOrder), asc(libraryTags.name))
    .all()
}

export async function createLibraryTag(actorId: string, libraryId: string, name: string) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  return db.transaction((tx) => {
    const existing = tx.select({ id: libraryTags.id }).from(libraryTags)
      .where(and(eq(libraryTags.libraryId, libraryId), eq(libraryTags.name, name))).get()
    if (existing) throw new AppError('TAG_NAME_TAKEN', 'Tag name is already in use')
    const max = tx.select({ max: sql<number>`max(${libraryTags.sortOrder})` }).from(libraryTags)
      .where(eq(libraryTags.libraryId, libraryId)).get()
    const now = Date.now()
    const row = {
      id: createId('tag'), libraryId, userId: actorId, name,
      sortOrder: (max?.max ?? -1) + 1, pinned: false, hidden: false, createdAt: now, updatedAt: now,
    }
    tx.insert(libraryTags).values(row).run()
    return toLibraryTagRes(row)
  })
}

export async function updateLibraryTag(actorId: string, libraryId: string, tagId: string, patch: { name?: string; pinned?: boolean; hidden?: boolean }) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  return db.transaction((tx) => {
    const existing = tx.select().from(libraryTags)
      .where(and(eq(libraryTags.id, tagId), eq(libraryTags.libraryId, libraryId))).get()
    if (!existing) throw new AppError('TAG_NOT_FOUND')
    if (patch.name !== undefined && patch.name !== existing.name) {
      const duplicate = tx.select({ id: libraryTags.id }).from(libraryTags)
        .where(and(eq(libraryTags.libraryId, libraryId), eq(libraryTags.name, patch.name), ne(libraryTags.id, tagId))).get()
      if (duplicate) throw new AppError('TAG_NAME_TAKEN', 'Tag name is already in use')
    }
    tx.update(libraryTags).set({ ...patch, updatedAt: Date.now() }).where(eq(libraryTags.id, tagId)).run()
    return toLibraryTagRes({ ...existing, ...patch, updatedAt: Date.now() })
  })
}

export async function reorderLibraryTags(actorId: string, libraryId: string, tagIds: string[]) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const existing = db.select({ id: libraryTags.id }).from(libraryTags)
    .where(eq(libraryTags.libraryId, libraryId)).all()
  const owned = new Set(existing.map((row) => row.id))
  if (tagIds.length !== owned.size || new Set(tagIds).size !== owned.size || tagIds.some((id) => !owned.has(id))) {
    throw new AppError('TAG_NOT_FOUND')
  }
  db.transaction((tx) => {
    for (const [index, id] of tagIds.entries()) {
      tx.update(libraryTags).set({ sortOrder: index }).where(eq(libraryTags.id, id)).run()
    }
  })
}

export async function deleteLibraryTag(actorId: string, libraryId: string, tagId: string) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const existing = db.select().from(libraryTags)
    .where(and(eq(libraryTags.id, tagId), eq(libraryTags.libraryId, libraryId))).get()
  if (!existing) throw new AppError('TAG_NOT_FOUND')
  // Relations cascade off the tag row.
  db.delete(libraryTags).where(eq(libraryTags.id, tagId)).run()
  return toLibraryTagRes(existing)
}
