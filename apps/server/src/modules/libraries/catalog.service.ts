import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'

import { getDb } from '../../db/client'
import {
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
import { assertLibraryBrowsable, deleteOrphanedBookVersions, requireLibraryManager } from './library-access'
import {
  likePattern,
  libraryOrderBy,
  sharedListConditions,
  taxonomyNameMatch,
  versionEffectiveMatch,
  type LibraryListQuery,
} from './library-query'
import type {
  CatalogBook,
  CatalogBookTag,
  CatalogBookUpdateReq,
  CatalogListRes,
  CatalogVersion,
  CatalogVersionUpdateReq,
} from '@bookdock/shared'

/**
 * Catalog reads and metadata management (5.1/5.3). Every entry point resolves
 * permissions through library-access: browsing needs `assertLibraryBrowsable`,
 * writing needs `requireLibraryManager`. Nothing here creates content — that
 * lives in books.service so uploads and reads share one materialization path.
 */
export const CATALOG_PAGE_SIZE = 24

/** Managers see unlisted versions in the catalog; everyone else does not. */
async function isLibraryManager(actorId: string, libraryId: string): Promise<boolean> {
  try {
    await requireLibraryManager(actorId, libraryId)
    return true
  } catch (err) {
    // Permission and topology denials mean "not a manager"; anything else (a
    // database or system failure) must not masquerade as an ordinary reader.
    if (err instanceof AppError) return false
    throw err
  }
}

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
    description: link.description,
    coverKey: link.coverKey,
    // Inheritance (5.3): a null override reads the work default, and the
    // resolved value is never written back onto the version row.
    effective: {
      title: link.title ?? work.title,
      author: link.author ?? work.author,
      description: link.description ?? work.description,
      coverKey: link.coverKey ?? work.coverKey,
      coverPaletteKey: typeof revisionMeta.coverPaletteKey === 'string' ? revisionMeta.coverPaletteKey : null,
      bookmeta: revisionMeta.bookmeta ?? {},
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
    pinnedAt: link.pinnedAt ?? null,
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
  return {
    id: work.id,
    libraryId: work.libraryId,
    categoryId: work.categoryId,
    title: work.title,
    author: work.author,
    description: work.description,
    coverKey: work.coverKey,
    tags,
    versions: links.map((link) => toCatalogVersion(work, link, resolved, collectedVersionIds)),
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
    // same sort-first rule private cards use. One pinned version pins the work.
    .orderBy(asc(sql`(SELECT max(v.pinned_at) FROM library_book_versions v WHERE v.library_book_id = ${libraryBooks.id}) IS NULL`), ...libraryOrderBy(params.sortBy, params.sortOrder, {
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
  })
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
  getWork(libraryId, libraryBookId)
  const link = getVersionLink(libraryId, libraryBookId, versionLinkId)
  const updates: Partial<typeof libraryBookVersions.$inferInsert> = { updatedAt: Date.now() }
  if (patch.name !== undefined) updates.name = patch.name
  if (patch.title !== undefined) updates.title = patch.title
  if (patch.author !== undefined) updates.author = patch.author
  if (patch.description !== undefined) updates.description = patch.description
  if (patch.status !== undefined) updates.status = patch.status
  if (patch.pinned !== undefined) updates.pinnedAt = patch.pinned ? Date.now() : null
  db.update(libraryBookVersions).set(updates).where(eq(libraryBookVersions.id, link.id)).run()
  const book = await getCatalogBook(actorId, libraryId, libraryBookId)
  const updated = book.versions.find((v) => v.id === link.id)
  if (!updated) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  return updated
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
