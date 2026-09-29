import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'

import { getDb } from '../../db/client'
import {
  blobs,
  bookVersions,
  contentRevisions,
  libraryBooks,
  libraryBookTags,
  libraryBookVersions,
  libraryCategories,
  libraryTags,
  libraries,
} from '../../db/schema'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { getParser } from '../../formats/registry'
import { blobKey, coverThumbnailKey, detectImageExtension, generateCoverThumbnail } from '../../lib/cover'
import { sha256 } from '../../lib/hash'
import { assertLibraryBrowsable, deleteOrphanedBookVersions, isLibraryManager, requireLibraryManager } from './library-access'
import {
  isWorkEffectivelyHidden,
  likePattern,
  libraryOrderBy,
  loadLibraryHiddenTaxonomy,
  sharedListConditions,
  taxonomyNameMatch,
  versionEffectiveMatch,
  workHiddenExclusion,
  type LibraryListQuery,
} from './library-query'
import {
  normalizeAuthors,
  type CatalogBook,
  type CatalogBookTag,
  type CatalogBookUpdateReq,
  type CatalogListRes,
  type CatalogVersion,
  type CatalogVersionUpdateReq,
  type BatchOrganizeReq,
  type BatchSelectionItem,
} from '@bookdock/shared'

/**
 * Catalog reads and metadata management (5.1/5.3). Every entry point resolves
 * permissions through library-access: browsing needs `assertLibraryBrowsable`,
 * writing needs `requireLibraryManager`. Nothing here creates content — that
 * lives in books.service so uploads and reads share one materialization path.
 */
export const CATALOG_PAGE_SIZE = 24

function getWork(libraryId: string, libraryBookId: string) {
  const db = getDb()
  const work = db.select().from(libraryBooks)
    .where(and(eq(libraryBooks.id, libraryBookId), eq(libraryBooks.libraryId, libraryId))).get()
  if (!work) throw new AppError('LIBRARY_BOOK_NOT_FOUND', 'Library book not found')
  return work
}

/**
 * Version rows joined with their content facts, newest work last. The latest
 * revision carries the derived chapter/word counts — older revisions of the
 * same version are history, not the current shape of the book.
 *
 * Facts come preloaded per page (see loadVersionFacts): resolving them per
 * link would be two queries per row.
 */
function toCatalogVersion(
  work: typeof libraryBooks.$inferSelect,
  link: typeof libraryBookVersions.$inferSelect,
  facts: { versions: Map<string, typeof bookVersions.$inferSelect>; revisions: Map<string, typeof contentRevisions.$inferSelect> },
  collectedVersionIds?: ReadonlySet<string>,
): CatalogVersion {
  const version = facts.versions.get(link.bookVersionId)
  const revision = facts.revisions.get(link.bookVersionId)
  // Publication metadata travels with the version; only these two keys are
  // exposed - the revision meta also carries internal pipeline state
  // (chapters, toc scoring) that is not catalog business.
  const revisionMeta = (revision?.meta ?? {}) as { bookmeta?: CatalogVersion['effective']['bookmeta']; fileName?: unknown; coverPaletteKey?: unknown }
  return {
    id: link.id,
    libraryBookId: link.libraryBookId,
    bookVersionId: link.bookVersionId,
    kind: link.kind,
    status: link.status,
    name: link.name,
    title: link.title,
    author: link.author,
    authors: link.authors,
    description: link.description,
    coverKey: link.coverKey,
    // Raw override layer for editors; consumers read `effective`.
    meta: (link.meta ?? {}) as Record<string, unknown>,
    // Inheritance (5.3): a null override reads the work default, and the
    // resolved value is never written back onto the version row.
    effective: {
      title: link.title ?? work.title,
      author: link.author ?? work.author,
      authors: link.authors ?? work.authors ?? [],
      description: link.description ?? work.description,
      coverKey: link.coverKey ?? work.coverKey,
      coverPaletteKey: typeof revisionMeta.coverPaletteKey === 'string' ? revisionMeta.coverPaletteKey : null,
      // Version wins over work wins over parsed file: a version with its own
      // publication metadata is a distinct edition, and clearing an override
      // layer reveals the one beneath it.
      bookmeta: {
        ...(revisionMeta.bookmeta ?? {}),
        ...((work.meta ?? {}) as Record<string, unknown>),
        ...((link.meta ?? {}) as Record<string, unknown>),
      },
      fileName: typeof revisionMeta.fileName === 'string' ? revisionMeta.fileName : null,
    },
    collected: collectedVersionIds?.has(link.bookVersionId) ?? false,
    // Per-listing anonymous switch; only meaningful with public visibility
    // and the instance guest switch (see resolveSharedVersionRead).
    guestReadable: link.guestReadable,
    format: version?.format ?? 'epub',
    size: version?.size ?? 0,
    chapterCount: revision?.chapterCount ?? 0,
    wordCount: revision?.wordCount ?? null,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  }
}

function toCatalogBook(
  work: typeof libraryBooks.$inferSelect,
  links: typeof libraryBookVersions.$inferSelect[],
  tags: CatalogBookTag[] = [],
  facts?: { versions: Map<string, typeof bookVersions.$inferSelect>; revisions: Map<string, typeof contentRevisions.$inferSelect> },
  collectedVersionIds?: ReadonlySet<string>,
): CatalogBook {
  const resolved = facts ?? { versions: new Map(), revisions: new Map() }
  // Default display version leads: cards, rows and the detail dialog read
  // versions[0], so reordering here moves every surface at once. A default
  // invisible to this viewer (unlisted for members) or gone entirely simply
  // keeps the existing order — never an empty slot, never a leak.
  const ordered = [...links]
  if (work.defaultVersionLinkId) {
    const at = ordered.findIndex((link) => link.id === work.defaultVersionLinkId)
    if (at > 0) ordered.unshift(...ordered.splice(at, 1))
  }
  return {
    id: work.id,
    libraryId: work.libraryId,
    categoryId: work.categoryId,
    title: work.title,
    author: work.author,
    authors: work.authors ?? [],
    description: work.description,
    coverKey: work.coverKey,
    // Raw override layer for editors; consumers read each version's `effective`.
    meta: (work.meta ?? {}) as Record<string, unknown>,
    // Work-level hide; members never receive hidden works (filtered above),
    // managers receive them badged.
    hidden: work.hidden,
    pinnedAt: work.pinnedAt ?? null,
    defaultVersionLinkId: work.defaultVersionLinkId ?? null,
    tags,
    versions: ordered.map((link) => toCatalogVersion(work, link, resolved, collectedVersionIds)),
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
  }
}

function getCollectedVersionIds(actorId: string, versionIds: string[]) {
  const db = getDb()
  if (versionIds.length === 0) return new Set<string>()
  const privateLibrary = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, actorId), eq(libraries.type, 'private'))).get()
  if (!privateLibrary) return new Set<string>()
  return new Set(db.select({ bookVersionId: libraryBookVersions.bookVersionId })
    .from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.libraryId, privateLibrary.id),
      inArray(libraryBookVersions.bookVersionId, versionIds),
    )).all().map((row) => row.bookVersionId))
}

/**
 * One page's version facts in two queries, not two per link. Revisions arrive
 * newest-first so the first row kept per version is its latest.
 */
function loadVersionFacts(bookVersionIds: string[]) {
  const db = getDb()
  const versions = new Map<string, typeof bookVersions.$inferSelect>()
  const revisions = new Map<string, typeof contentRevisions.$inferSelect>()
  if (bookVersionIds.length === 0) return { versions, revisions }
  for (const row of db.select().from(bookVersions).where(inArray(bookVersions.id, bookVersionIds)).all()) {
    versions.set(row.id, row)
  }
  for (const row of db.select().from(contentRevisions)
    .where(inArray(contentRevisions.bookVersionId, bookVersionIds))
    .orderBy(desc(contentRevisions.revisionNo)).all()) {
    if (!revisions.has(row.bookVersionId)) revisions.set(row.bookVersionId, row)
  }
  return { versions, revisions }
}

/**
 * Tag ids -> names for a page of works, in one query. The catalog shows tags on
 * every card, so resolving them per work would be a query per row.
 */
function tagNamesByWork(db: ReturnType<typeof getDb>, workIds: string[]) {
  const map = new Map<string, CatalogBookTag[]>()
  if (workIds.length === 0) return map
  const rows = db.select({
    libraryBookId: libraryBookTags.libraryBookId,
    id: libraryTags.id,
    name: libraryTags.name,
    sortOrder: libraryTags.sortOrder,
  }).from(libraryBookTags)
    .innerJoin(libraryTags, eq(libraryTags.id, libraryBookTags.tagId))
    .where(inArray(libraryBookTags.libraryBookId, workIds))
    .orderBy(libraryTags.sortOrder, libraryTags.name).all()
  for (const row of rows) {
    const list = map.get(row.libraryBookId) ?? []
    list.push({ id: row.id, name: row.name })
    map.set(row.libraryBookId, list)
  }
  return map
}

/**
 * Replaces a work's tag set. Every id must already belong to this library, so
 * a caller cannot tag a book with another library's taxonomy — the same rule
 * the category path enforces.
 */
function setWorkTags(
  tx: Pick<ReturnType<typeof getDb>, 'select' | 'delete' | 'insert'>,
  libraryId: string,
  workId: string,
  tagIds: string[],
) {
  const unique = [...new Set(tagIds)]
  if (unique.length > 0) {
    const found = tx.select({ id: libraryTags.id }).from(libraryTags)
      .where(and(eq(libraryTags.libraryId, libraryId), inArray(libraryTags.id, unique))).all()
    if (found.length !== unique.length) throw new AppError('TAG_NOT_FOUND', 'Tag not found')
  }
  tx.delete(libraryBookTags).where(eq(libraryBookTags.libraryBookId, workId)).run()
  if (unique.length > 0) {
    tx.insert(libraryBookTags).values(unique.map((tagId) => ({ libraryBookId: workId, tagId }))).run()
  }
}

/**
 * One page of the catalog, filtered and ordered by the same dimensions a
 * private library's own list uses (see library-query.ts). What a catalog cannot
 * offer is per-user reading state - progress, read status, last-read - because
 * a shared work belongs to nobody; those sort keys are simply absent here, and
 * libraryOrderBy falls through to newest-first for them.
 *
 * A private library's own books are never trashed here (trash is a
 * private-library concept until the catalog grows one), so `deletedAt` always
 * excludes. Unlisted versions are visible to managers only.
 */
export async function listCatalogBooks(
  actorId: string,
  libraryId: string,
  params: Partial<LibraryListQuery> = {},
): Promise<CatalogListRes> {
  const db = getDb()
  await assertLibraryBrowsable(actorId, libraryId)
  const includeUnlisted = await isLibraryManager(actorId, libraryId)
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? CATALOG_PAGE_SIZE))
  const filters: SQL[] = [eq(libraryBooks.libraryId, libraryId), isNull(libraryBooks.deletedAt)]
  if (params.search) {
    // The same searchable surface as a private list: the work's own fields plus
    // the names of the category and tags it is filed under, plus what a reader
    // actually sees on each version (override, else the work default).
    const pattern = likePattern(params.search)
    filters.push(sql`(
      ${libraryBooks.title} LIKE ${pattern} ESCAPE '!'
      OR ${libraryBooks.author} LIKE ${pattern} ESCAPE '!'
      OR ${libraryBooks.description} LIKE ${pattern} ESCAPE '!'
      OR ${taxonomyNameMatch(pattern, libraryId)}
      OR ${versionEffectiveMatch(pattern, libraryId, { publishedOnly: !includeUnlisted })}
    )`)
  }
  filters.push(...sharedListConditions({ page, pageSize, ...params }, libraryId, { publishedOnly: !includeUnlisted }))
  // Hidden works are invisible to non-managers, with the same no-leak rule
  // as unlisted-only works below (name, count and metadata stay hidden).
  // Managers always see hidden rows, badged by toCatalogBook.
  if (!includeUnlisted) {
    filters.push(workHiddenExclusion(loadLibraryHiddenTaxonomy(db, libraryId)))
  }
  // A work with only unlisted versions is invisible to non-managers: without
  // this, it would still occupy total/items with an empty version list and
  // leak the hidden version's name, count and metadata.
  if (!includeUnlisted) {
    filters.push(sql`EXISTS (
      SELECT 1 FROM library_book_versions AS visible_version
      WHERE visible_version.library_book_id = ${libraryBooks.id}
        AND visible_version.status = 'published'
    )`)
  }
  const where = and(...filters)
  const total = db.select({ count: sql<number>`count(*)` }).from(libraryBooks).where(where).get()?.count ?? 0
  const sizeColumn = includeUnlisted
    ? sql`coalesce((SELECT max(v.size) FROM library_book_versions v
        INNER JOIN book_versions bv ON bv.id = v.book_version_id
        WHERE v.library_book_id = ${libraryBooks.id}), 0)`
    : sql`coalesce((SELECT max(v.size) FROM library_book_versions v
        INNER JOIN book_versions bv ON bv.id = v.book_version_id
        WHERE v.library_book_id = ${libraryBooks.id} AND v.status = 'published'), 0)`
  const works = db.select().from(libraryBooks).where(where)
    // A manager's pin sorts the work first for everyone in the library, the
    // same sort-first rule private cards use, at the shared work's display unit.
    .orderBy(asc(sql`${libraryBooks.pinnedAt} IS NULL`), ...libraryOrderBy(params.sortBy, params.sortOrder, {
      title: libraryBooks.title,
      author: libraryBooks.author,
      size: sizeColumn,
      createdAt: libraryBooks.createdAt,
      updatedAt: libraryBooks.updatedAt,
    }))
    .limit(pageSize).offset((page - 1) * pageSize).all()
  const links = works.length === 0 ? [] : db.select().from(libraryBookVersions)
    .where(inArray(libraryBookVersions.libraryBookId, works.map((w) => w.id)))
    .orderBy(libraryBookVersions.createdAt, libraryBookVersions.id).all()
  const facts = loadVersionFacts([...new Set(links.map((link) => link.bookVersionId))])
  const collectedVersionIds = getCollectedVersionIds(actorId, [...new Set(links.map((link) => link.bookVersionId))])
  const tagMap = tagNamesByWork(db, works.map((w) => w.id))
  return {
    items: works.map((work) => toCatalogBook(
      work,
      links.filter((link) => link.libraryBookId === work.id && (includeUnlisted || link.status === 'published')),
      tagMap.get(work.id) ?? [],
      facts,
      collectedVersionIds,
    )),
    total,
    page,
    pageSize,
  }
}

export async function getCatalogBook(actorId: string, libraryId: string, libraryBookId: string) {
  const db = getDb()
  await assertLibraryBrowsable(actorId, libraryId)
  const includeUnlisted = await isLibraryManager(actorId, libraryId)
  const work = getWork(libraryId, libraryBookId)
  // Hidden works read as NOT_FOUND for non-managers (same verdict as an
  // unlisted-only work); managers always see them, badged.
  if (!includeUnlisted && isWorkEffectivelyHidden(db, libraryId, work)) {
    throw new AppError('LIBRARY_BOOK_NOT_FOUND', 'Library book not found')
  }
  const links = db.select().from(libraryBookVersions)
    .where(eq(libraryBookVersions.libraryBookId, work.id))
    .orderBy(libraryBookVersions.createdAt, libraryBookVersions.id).all()
  const facts = loadVersionFacts(links.map((link) => link.bookVersionId))
  const collectedVersionIds = getCollectedVersionIds(actorId, links.map((link) => link.bookVersionId))
  return toCatalogBook(
    work,
    links.filter((link) => includeUnlisted || link.status === 'published'),
    tagNamesByWork(db, [work.id]).get(work.id) ?? [],
    facts,
    collectedVersionIds,
  )
}

/** Work-level defaults (5.3). Every version that inherits them follows along. */
export async function updateCatalogBook(actorId: string, libraryId: string, libraryBookId: string, patch: CatalogBookUpdateReq) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const work = getWork(libraryId, libraryBookId)
  const updates: Partial<typeof libraryBooks.$inferInsert> = { updatedAt: Date.now() }
  if (patch.title !== undefined) updates.title = patch.title
  if (patch.author !== undefined) updates.author = patch.author
  if (patch.description !== undefined) updates.description = patch.description
  if (patch.hidden !== undefined) updates.hidden = patch.hidden
  if (patch.pinned !== undefined) updates.pinnedAt = patch.pinned ? Date.now() : null
  if (patch.meta !== undefined) updates.meta = patch.meta
  if (patch.defaultVersionLinkId !== undefined) {
    // The default must be a version of this work: getVersionLink scopes the
    // lookup to this library and work, so a foreign id reads as NOT_FOUND
    // instead of leaking another work's existence.
    if (patch.defaultVersionLinkId !== null) {
      getVersionLink(libraryId, libraryBookId, patch.defaultVersionLinkId)
    }
    updates.defaultVersionLinkId = patch.defaultVersionLinkId
  }
  if (patch.categoryId !== undefined) {
    if (patch.categoryId !== null) {
      const category = db.select({ id: libraryCategories.id }).from(libraryCategories)
        .where(and(eq(libraryCategories.id, patch.categoryId), eq(libraryCategories.libraryId, libraryId))).get()
      if (!category) throw new AppError('CATEGORY_NOT_FOUND')
    }
    updates.categoryId = patch.categoryId
  }
  // Taxonomy moves with the metadata, so a rename and a retag are one action and
  // one transaction rather than two calls that can half-apply.
  db.transaction((tx) => {
    tx.update(libraryBooks).set(updates).where(eq(libraryBooks.id, work.id)).run()
    if (patch.tagIds !== undefined) setWorkTags(tx, libraryId, work.id, patch.tagIds)
    if (patch.hidden !== undefined) {
      const links = tx.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
        .where(eq(libraryBookVersions.libraryBookId, work.id)).all()
      if (links.length === 1) {
        tx.update(libraryBookVersions)
          .set({ status: patch.hidden ? 'unlisted' : 'published', updatedAt: updates.updatedAt })
          .where(eq(libraryBookVersions.id, links[0].id)).run()
      }
    }
  })
  return getCatalogBook(actorId, libraryId, work.id)
}

export async function getCatalogBatchSelection(actorId: string, libraryId: string, ids: string[]): Promise<BatchSelectionItem[]> {
  await requireLibraryManager(actorId, libraryId)
  const db = getDb()
  const uniqueIds = [...new Set(ids)]
  const works = db.select().from(libraryBooks)
    .where(and(eq(libraryBooks.libraryId, libraryId), inArray(libraryBooks.id, uniqueIds))).all()
  if (works.length !== uniqueIds.length) throw new AppError('LIBRARY_BOOK_NOT_FOUND')
  const links = db.select({ libraryBookId: libraryBookVersions.libraryBookId }).from(libraryBookVersions)
    .where(inArray(libraryBookVersions.libraryBookId, uniqueIds)).all()
  const tags = db.select().from(libraryBookTags)
    .where(inArray(libraryBookTags.libraryBookId, uniqueIds)).all()
  const versionCounts = new Map<string, number>()
  const tagIdsByWork = new Map<string, string[]>()
  for (const link of links) versionCounts.set(link.libraryBookId, (versionCounts.get(link.libraryBookId) ?? 0) + 1)
  for (const tag of tags) {
    const tagIds = tagIdsByWork.get(tag.libraryBookId) ?? []
    tagIds.push(tag.tagId)
    tagIdsByWork.set(tag.libraryBookId, tagIds)
  }
  const byId = new Map(works.map((work) => [work.id, {
    id: work.id,
    categoryId: work.categoryId,
    tagIds: tagIdsByWork.get(work.id) ?? [],
    hidden: work.hidden,
    pinnedAt: work.pinnedAt,
    versionCount: versionCounts.get(work.id) ?? 0,
  }]))
  return ids.map((id) => byId.get(id)!).filter(Boolean)
}

export async function organizeCatalogBatch(actorId: string, libraryId: string, input: BatchOrganizeReq) {
  await requireLibraryManager(actorId, libraryId)
  const db = getDb()
  const ids = [...new Set(input.ids)]
  const works = db.select({ id: libraryBooks.id }).from(libraryBooks)
    .where(and(eq(libraryBooks.libraryId, libraryId), inArray(libraryBooks.id, ids))).all()
  if (works.length !== ids.length) throw new AppError('LIBRARY_BOOK_NOT_FOUND')
  if (input.categoryId !== undefined && input.categoryId !== null && !db.select({ id: libraryCategories.id }).from(libraryCategories)
    .where(and(eq(libraryCategories.id, input.categoryId), eq(libraryCategories.libraryId, libraryId))).get()) throw new AppError('CATEGORY_NOT_FOUND')
  const addTagIds = [...new Set(input.addTagIds)]
  const removeTagIds = [...new Set(input.removeTagIds)]
  if (addTagIds.some((id) => removeTagIds.includes(id))) throw new AppError('VALIDATION_ERROR', 'Conflicting tag changes')
  const touchedTagIds = [...addTagIds, ...removeTagIds]
  if (touchedTagIds.length > 0) {
    const found = db.select({ id: libraryTags.id }).from(libraryTags)
      .where(and(eq(libraryTags.libraryId, libraryId), inArray(libraryTags.id, touchedTagIds))).all()
    if (found.length !== touchedTagIds.length) throw new AppError('TAG_NOT_FOUND')
  }
  const now = Date.now()
  db.transaction((tx) => {
    if (input.categoryId !== undefined) tx.update(libraryBooks)
      .set({ categoryId: input.categoryId, updatedAt: now }).where(inArray(libraryBooks.id, ids)).run()
    for (const tagId of removeTagIds) tx.delete(libraryBookTags)
      .where(and(inArray(libraryBookTags.libraryBookId, ids), eq(libraryBookTags.tagId, tagId))).run()
    for (const tagId of addTagIds) tx.insert(libraryBookTags)
      .values(ids.map((libraryBookId) => ({ libraryBookId, tagId }))).onConflictDoNothing().run()
  })
  return { count: ids.length }
}

/**
 * Work cover management: the work row owns its coverKey and versions inherit
 * it through the null-override rule, so one write re-covers every version.
 * Manager-only like every other catalog write; mirrors the private-book cover
 * flow (5MB cap, content-hash key, derived thumbnail).
 */
export async function updateCatalogBookCover(actorId: string, libraryId: string, libraryBookId: string, file: File) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const work = getWork(libraryId, libraryBookId)
  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > 5 * 1024 * 1024) throw new AppError('UPLOAD_TOO_LARGE')
  const ext = detectImageExtension(buffer)
  if (!ext) throw new AppError('UNSUPPORTED_FORMAT', 'Cover must be a PNG, JPEG, GIF, SVG or WebP image')
  const storage = getStorage()
  const coverKey = blobKey(sha256(buffer), `.cover.${ext}`)
  await storage.put(coverKey, buffer)
  const thumb = await generateCoverThumbnail(buffer, ext)
  if (thumb) {
    await storage.put(coverThumbnailKey(coverKey), thumb)
  }
  const now = Date.now()
  try {
    db.insert(blobs).values({ key: coverKey, size: buffer.length, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
    db.update(libraryBooks).set({ coverKey, updatedAt: now }).where(eq(libraryBooks.id, work.id)).run()
  } catch (err) {
    for (const key of [coverKey, coverThumbnailKey(coverKey)]) {
      if (await storage.exists(key)) await storage.delete(key)
    }
    throw err
  }
  return getCatalogBook(actorId, libraryId, work.id)
}

export async function removeCatalogBookCover(actorId: string, libraryId: string, libraryBookId: string) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const work = getWork(libraryId, libraryBookId)
  db.update(libraryBooks).set({ coverKey: null, updatedAt: Date.now() }).where(eq(libraryBooks.id, work.id)).run()
  return getCatalogBook(actorId, libraryId, work.id)
}

/**
 * Version-level management (5.3/5.4): overrides and publish state. Setting a
 * field to null removes the override so the work default applies again; a
 * version is always addressable inside its own library only.
 */
export async function updateCatalogVersion(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  patch: CatalogVersionUpdateReq,
) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const work = getWork(libraryId, libraryBookId)
  const link = getVersionLink(libraryId, libraryBookId, versionLinkId)
  const updates: Partial<typeof libraryBookVersions.$inferInsert> = { updatedAt: Date.now() }
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.title !== undefined) updates.title = patch.title
  if (patch.author !== undefined || patch.authors !== undefined) {
    // Version overrides follow the same mirror rule as works: an explicit
    // authors list wins, otherwise a lone author becomes one element, and
    // null clears the override back to inheritance.
    if (patch.authors === null || (patch.authors === undefined && patch.author === null)) {
      updates.author = null
      updates.authors = null
    } else {
      const normalized = normalizeAuthors({
        author: patch.author === null ? undefined : patch.author,
        authors: patch.authors === null ? undefined : patch.authors,
      })
      updates.author = normalized.author
      updates.authors = normalized.authors
    }
  }
  if (patch.description !== undefined) updates.description = patch.description
  if (patch.status !== undefined) updates.status = patch.status
  // Version meta replaces wholesale like the work meta; null clears the
  // override back to inheriting the work default.
  if (patch.meta !== undefined) updates.meta = patch.meta ?? {}
  db.transaction((tx) => {
    tx.update(libraryBookVersions).set(updates).where(eq(libraryBookVersions.id, link.id)).run()
    if (patch.status !== undefined) {
      const links = tx.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
        .where(eq(libraryBookVersions.libraryBookId, work.id)).all()
      if (links.length === 1) {
        tx.update(libraryBooks)
          .set({ hidden: patch.status === 'unlisted', updatedAt: updates.updatedAt })
          .where(eq(libraryBooks.id, work.id)).run()
      }
    }
  })
  const book = await getCatalogBook(actorId, libraryId, libraryBookId)
  const updated = book.versions.find((v) => v.id === link.id)
  if (!updated) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  return updated
}

/**
 * Version cover management: a version with its own coverKey is a distinct
 * edition on the shelf; clearing it reveals the work cover. Manager-only like
 * every other catalog write; mirrors the work-cover flow (5MB cap,
 * content-hash key, derived thumbnail).
 */
export async function updateCatalogVersionCover(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  file: File,
) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  getWork(libraryId, libraryBookId)
  const link = getVersionLink(libraryId, libraryBookId, versionLinkId)
  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > 5 * 1024 * 1024) throw new AppError('UPLOAD_TOO_LARGE')
  const ext = detectImageExtension(buffer)
  if (!ext) throw new AppError('UNSUPPORTED_FORMAT', 'Cover must be a PNG, JPEG, GIF, SVG or WebP image')
  const storage = getStorage()
  const coverKey = blobKey(sha256(buffer), `.cover.${ext}`)
  await storage.put(coverKey, buffer)
  const thumb = await generateCoverThumbnail(buffer, ext)
  if (thumb) {
    await storage.put(coverThumbnailKey(coverKey), thumb)
  }
  const now = Date.now()
  try {
    db.insert(blobs).values({ key: coverKey, size: buffer.length, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
    db.update(libraryBookVersions).set({ coverKey, updatedAt: now }).where(eq(libraryBookVersions.id, link.id)).run()
  } catch (err) {
    for (const key of [coverKey, coverThumbnailKey(coverKey)]) {
      if (await storage.exists(key)) await storage.delete(key)
    }
    throw err
  }
  const book = await getCatalogBook(actorId, libraryId, libraryBookId)
  const updated = book.versions.find((v) => v.id === link.id)
  if (!updated) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  return updated
}

export async function removeCatalogVersionCover(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  getWork(libraryId, libraryBookId)
  const link = getVersionLink(libraryId, libraryBookId, versionLinkId)
  db.update(libraryBookVersions).set({ coverKey: null, updatedAt: Date.now() })
    .where(eq(libraryBookVersions.id, link.id)).run()
  const book = await getCatalogBook(actorId, libraryId, libraryBookId)
  const updated = book.versions.find((v) => v.id === link.id)
  if (!updated) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  return updated
}

/**
 * Version metadata reset: clears every version-level override (title, author,
 * description, cover, meta) so the version inherits the work default again,
 * and restores the latest revision's parsed bookmeta from the stored file —
 * the catalog half of the private resetBookMetadata.
 */
export async function resetCatalogVersionMetadata(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  getWork(libraryId, libraryBookId)
  const link = getVersionLink(libraryId, libraryBookId, versionLinkId)
  const latestRevision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, link.bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  // The stored content is always EPUB bytes (TXT is converted at upload), so
  // the blob key itself selects the parser. A missing blob skips the
  // bookmeta restore but still clears the overrides.
  if (latestRevision && await getStorage().exists(latestRevision.blobKey)) {
    const parser = getParser(latestRevision.blobKey, '')
    if (!parser) throw new AppError('UNSUPPORTED_FORMAT')
    const parsed = await parser.parse(await getStorage().get(latestRevision.blobKey))
    const meta = { ...((latestRevision.meta ?? {}) as Record<string, unknown>), bookmeta: parsed.meta.bookmeta ?? {} }
    db.update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, latestRevision.id)).run()
  }
  db.update(libraryBookVersions).set({
    title: null, author: null, authors: null, description: null, coverKey: null, meta: {},
    updatedAt: Date.now(),
  }).where(eq(libraryBookVersions.id, link.id)).run()
  return getCatalogBook(actorId, libraryId, libraryBookId)
}

function getVersionLink(libraryId: string, libraryBookId: string, versionLinkId: string) {
  const db = getDb()
  const link = db.select().from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.id, versionLinkId),
      eq(libraryBookVersions.libraryId, libraryId),
      eq(libraryBookVersions.libraryBookId, libraryBookId),
    )).get()
  if (!link) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  return link
}

/**
 * Grouping hints (5.2). The catalog never groups on its own: this only ranks
 * works the admin may attach the new version to. Ranking is deliberately plain
 * — normalized title equality, then containment, then a shared author — because
 * global work recognition is explicitly out of scope.
 */
export async function findSimilarWorks(
  actorId: string,
  libraryId: string,
  query: { title: string; author?: string; excludeLibraryBookId?: string; limit?: number },
) {
  const db = getDb()
  await assertLibraryBrowsable(actorId, libraryId)
  const title = normalizeHint(query.title)
  const author = normalizeHint(query.author ?? '')
  const candidates = db.select().from(libraryBooks)
    .where(and(eq(libraryBooks.libraryId, libraryId), isNull(libraryBooks.deletedAt))).all()
    .filter((work) => work.id !== query.excludeLibraryBookId)
    .map((work) => {
      const workTitle = normalizeHint(work.title)
      const workAuthor = normalizeHint(work.author)
      let score = 0
      if (title && workTitle === title) score = 3
      else if (title && (workTitle.includes(title) || title.includes(workTitle))) score = 2
      if (author && workAuthor && workAuthor === author) score = Math.max(score, 1)
      return { work, score }
    })
    .filter((row) => row.score > 0)
    // Title matches first, then newest; the id keeps the order deterministic.
    .sort((a, b) => b.score - a.score || b.work.updatedAt - a.work.updatedAt || a.work.id.localeCompare(b.work.id))
    .slice(0, query.limit ?? 5)
  const links = candidates.length === 0 ? [] : db.select().from(libraryBookVersions)
    .where(inArray(libraryBookVersions.libraryBookId, candidates.map((c) => c.work.id))).all()
  const facts = loadVersionFacts([...new Set(links.map((link) => link.bookVersionId))])
  const collectedVersionIds = getCollectedVersionIds(actorId, [...new Set(links.map((link) => link.bookVersionId))])
  const includeUnlisted = await isLibraryManager(actorId, libraryId)
  const visibleLinks = (workId: string) => links.filter(
    (link) => link.libraryBookId === workId && (includeUnlisted || link.status === 'published'),
  )
  return candidates
    .filter(({ work }) => includeUnlisted || visibleLinks(work.id).length > 0)
    .map(({ work, score }) => ({
      ...toCatalogBook(work, visibleLinks(work.id), [], facts, collectedVersionIds),
      matchScore: score,
    }))
}

function normalizeHint(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Version move (5.5): re-grouping after a mistake. Only the aggregate changes —
 * the BookVersion, its revisions, its blob and every User x BookVersion row
 * keep their ids. A move that would leave the source work without any version
 * is refused, because a work with no version is not a valid state.
 */
export async function moveCatalogVersion(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  targetLibraryBookId: string,
) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  getWork(libraryId, libraryBookId)
  const link = getVersionLink(libraryId, libraryBookId, versionLinkId)
  if (link.libraryBookId === targetLibraryBookId) {
    throw new AppError('VALIDATION_ERROR', 'Version already belongs to this work')
  }
  getWork(libraryId, targetLibraryBookId)
  const siblings = db.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
    .where(eq(libraryBookVersions.libraryBookId, libraryBookId)).all()
  if (siblings.length <= 1) {
    throw new AppError('VALIDATION_ERROR', 'Move would leave the work without a version; delete it instead')
  }
  db.update(libraryBookVersions)
    .set({ libraryBookId: targetLibraryBookId, updatedAt: Date.now() })
    .where(eq(libraryBookVersions.id, link.id)).run()
  db.update(libraryBooks).set({ updatedAt: Date.now() }).where(eq(libraryBooks.id, targetLibraryBookId)).run()
  return getCatalogBook(actorId, libraryId, targetLibraryBookId)
}

/**
 * Version delete (5.6). Removing the last version removes the work with it, in
 * one transaction, so a work without versions never becomes a lasting state.
 * The BookVersion itself only goes when no other library still lists it, and
 * the blob only when nothing references the file — other libraries' B rows
 * point at the source by plain text, so a deleted source keeps its provenance
 * and simply becomes unreadable.
 */
export async function deleteCatalogBook(actorId: string, libraryId: string, libraryBookId: string) {
  await requireLibraryManager(actorId, libraryId)
  const db = getDb()
  const work = getWork(libraryId, libraryBookId)
  const links = db.select().from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, libraryId), eq(libraryBookVersions.libraryBookId, libraryBookId))).all()
  const orphanedVersionIds: string[] = []
  db.transaction((tx) => {
    tx.delete(libraryBookTags).where(eq(libraryBookTags.libraryBookId, libraryBookId)).run()
    tx.delete(libraryBookVersions).where(eq(libraryBookVersions.libraryBookId, libraryBookId)).run()
    tx.delete(libraryBooks).where(eq(libraryBooks.id, libraryBookId)).run()
    for (const link of links) {
      const stillListed = tx.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
        .where(eq(libraryBookVersions.bookVersionId, link.bookVersionId)).get()
      if (!stillListed) orphanedVersionIds.push(link.bookVersionId)
    }
  })
  const coverKeys = [work.coverKey, ...links.map((link) => link.coverKey)]
    .filter((key): key is string => key !== null)
  await deleteOrphanedBookVersions([...new Set(orphanedVersionIds)], { coverKeys: [...new Set(coverKeys)] })
  return { id: libraryBookId, versionCount: links.length }
}

export async function deleteCatalogVersion(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
) {
  const db = getDb()
  await requireLibraryManager(actorId, libraryId)
  const work = getWork(libraryId, libraryBookId)
  const link = getVersionLink(libraryId, libraryBookId, versionLinkId)
  const now = Date.now()
  const orphanedVersionIds: string[] = []
  let workDeleted = false
  db.transaction((tx) => {
    tx.delete(libraryBookVersions).where(eq(libraryBookVersions.id, link.id)).run()
    const remaining = tx.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
      .where(eq(libraryBookVersions.libraryBookId, libraryBookId)).all()
    if (remaining.length === 0) {
      tx.delete(libraryBookTags).where(eq(libraryBookTags.libraryBookId, libraryBookId)).run()
      tx.delete(libraryBooks).where(eq(libraryBooks.id, libraryBookId)).run()
      workDeleted = true
    } else {
      tx.update(libraryBooks).set({ updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
    }
    const stillListed = tx.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
      .where(eq(libraryBookVersions.bookVersionId, link.bookVersionId)).get()
    if (!stillListed) orphanedVersionIds.push(link.bookVersionId)
  })
  // A new work carries its cover on the work row (version overrides stay
  // null); without it the last-version delete would orphan the artwork.
  const coverKeys = [link.coverKey, ...(workDeleted && work.coverKey ? [work.coverKey] : [])]
    .filter((key): key is string => key !== null)
  await deleteOrphanedBookVersions(orphanedVersionIds, { coverKeys })
  return { id: link.id, libraryBookId, workDeleted }
}
