import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { bookVersions, contentRevisions, libraryBookTagValues, libraryBooks, libraryBookVersions, libraryMetadataValueState, shelves, libraries } from '../../db/schema'
import { getDb } from '../../db/client'
import { parseCategoryValueKey, type CategoryScope, type HiddenReason, type HiddenVia } from '@bookdock/shared'

export function pendingBookDataDeletionVersionIds(db: ReturnType<typeof getDb>, userId: string): string[] {
  return db.select({ id: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(
      eq(libraryBooks.userId, userId),
      sql`${libraryBooks.deletedAt} IS NOT NULL`,
      sql`json_extract(${libraryBooks.meta}, '$.pendingUserDataDeletion') = 1`,
    )).all().map((row) => row.id)
}

/**
 * Query dimensions a library's book list can be filtered and ordered by (0.4.0).
 *
 * A private library's own list and a shared library's catalog are the same kind
 * of thing - works in a library, filed under that library's categories and tags -
 * so they share one implementation of the parts that mean the same thing to both.
 * Private shelves and library categories are independent dimensions. Shared
 * libraries have categories only.
 *
 * What genuinely differs is per-user reading state: progress, read status and
 * last-read only exist for books someone owns, so a shared catalog cannot offer
 * them. Callers pass the columns they actually have (see `LibrarySortColumns`)
 * rather than each side growing its own copy of the sort logic.
 */
export interface LibraryListQuery {
  page: number
  pageSize: number
  expression?: string
  search?: string
  sortBy?: string
  sortOrder?: string
  /** Category path, or the 'none' sentinel for uncategorized. */
  category?: string[] | 'none'
  /** Private shelf, or the 'none' sentinel for works outside every shelf. */
  shelfId?: string
  categoryScope?: CategoryScope
  /** Tag value (the name itself; tags have no other identity). */
  tag?: string
  format?: 'epub' | 'txt'
  author?: string
  series?: string
  /**
   * Unix ms; keep only rows whose newer of (work touched, content revised) is at
   * least this. Both halves matter: adding a version or editing metadata moves
   * the work, while appending to or replacing a file's content only produces a
   * new revision, so filtering on the work alone would make a content change
   * invisible to a client syncing on a watermark.
   */
  updatedSince?: number
}

/** Which sort keys this list can honour. Missing keys simply do not apply. */
export interface LibrarySortColumns {
  title: SQLWrapper
  author: SQLWrapper
  size: SQLWrapper
  createdAt: SQLWrapper
  updatedAt: SQLWrapper
  progress?: SQLWrapper
  lastReadAt?: SQLWrapper
  deletedAt?: SQLWrapper
}

/**
 * Escapes LIKE wildcards so user input is matched literally. The escape char is
 * '!' because a backslash gets mangled by drizzle's sql template, and it must
 * itself be escaped first.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[!%_]/g, (match) => '!' + match)}%`
}

/**
 * 'none' filters uncategorized works; a path matches the books carrying it.
 *
 * A path node stands for itself, and a subtree query for a root covers every
 * branch under it — the two-level limit means the root column alone answers
 * that, so no recursive walk is needed.
 */
export function categoryFilter(category: string[] | 'none' | undefined, scope: CategoryScope = 'direct'): SQL | undefined {
  if (category === undefined) return undefined
  if (category === 'none') return isNull(libraryBooks.categoryRoot)
  const root = category[0]!
  const leaf = category[1]
  if (leaf === undefined) {
    return scope === 'subtree' ? eq(libraryBooks.categoryRoot, root) : and(eq(libraryBooks.categoryRoot, root), isNull(libraryBooks.categoryLeaf)) as SQL
  }
  return and(eq(libraryBooks.categoryRoot, root), eq(libraryBooks.categoryLeaf, leaf)) as SQL
}

export function publishedWorkExists(): SQL {
  return sql`EXISTS (
    SELECT 1 FROM library_book_versions AS visible_version
    WHERE visible_version.library_book_id = ${libraryBooks.id}
      AND visible_version.library_id = ${libraryBooks.libraryId}
      AND visible_version.status = 'published'
  )`
}

/** Works carrying the tag value. Tag names are library-scoped by the book join. */
export function tagFilter(tag: string | undefined): SQL | undefined {
  if (!tag) return undefined
  return sql`EXISTS (
    SELECT 1 FROM ${libraryBookTagValues} AS filter_book_tag
    INNER JOIN ${libraryBooks} AS filter_tag_book ON filter_tag_book.id = filter_book_tag.library_book_id
    WHERE filter_book_tag.library_book_id = ${libraryBooks.id}
      AND filter_book_tag.name = ${tag}
      AND filter_tag_book.library_id = ${libraryBooks.libraryId}
  )`
}

/**
 * Persistent-hide snapshot for one library (see the Hidden boundary in
 * architecture.md). Category hiding is value-based: hiding a root covers its
 * whole branch, hiding a leaf covers exactly that path. Tag hiding is flat and
 * hides every work carrying the name. Libraries are small; the snapshot is
 * loaded once per request.
 */
export interface LibraryHiddenTaxonomy {
  hiddenShelfIds: string[]
  hiddenShelfNames: Map<string, string>
  /** Hidden category paths. Length 1 hides the branch, length 2 the exact node. */
  hiddenCategoryPaths: string[][]
  hiddenTagNames: string[]
}

export function loadLibraryHiddenTaxonomy(
  db: ReturnType<typeof getDb>,
  libraryId: string,
): LibraryHiddenTaxonomy {
  const hiddenShelves = db.select({ id: shelves.id, name: shelves.name }).from(shelves)
    .where(and(eq(shelves.libraryId, libraryId), eq(shelves.hidden, true))).all()
  const hiddenRows = db.select({ kind: libraryMetadataValueState.kind, value: libraryMetadataValueState.value })
    .from(libraryMetadataValueState)
    .where(and(eq(libraryMetadataValueState.libraryId, libraryId), eq(libraryMetadataValueState.hidden, true))).all()
  const hiddenCategoryPaths: string[][] = []
  const hiddenTagNames: string[] = []
  for (const row of hiddenRows) {
    if (row.kind === 'tag') {
      hiddenTagNames.push(row.value)
      continue
    }
    const path = parseCategoryValueKey(row.value)
    if (path) hiddenCategoryPaths.push(path)
  }
  return {
    hiddenShelfIds: hiddenShelves.map((shelf) => shelf.id),
    hiddenShelfNames: new Map(hiddenShelves.map((shelf) => [shelf.id, shelf.name])),
    hiddenCategoryPaths,
    hiddenTagNames,
  }
}

/** Which layer hides a work, with the names the UI needs to say so. */
export interface WorkHiddenDetail {
  reason: HiddenReason | null
  via?: HiddenVia
}

/**
 * Pure classification over a preloaded taxonomy: no queries, so list paths
 * call it per row after one taxonomy load. Priority is direct over category
 * over tag, so a work hidden two ways still names one cause. The named
 * category is the nearest hidden ancestor, which is where the owner must
 * unhide.
 */
export function classifyWorkHidden(
  work: { hidden: boolean; shelfId?: string | null; categoryRoot: string | null; categoryLeaf: string | null },
  taxonomy: LibraryHiddenTaxonomy,
  workTagNames: readonly string[] = [],
): WorkHiddenDetail {
  if (work.hidden) return { reason: 'direct' }
  if (work.shelfId && taxonomy.hiddenShelfNames.has(work.shelfId)) {
    return { reason: 'shelf', via: { shelfName: taxonomy.hiddenShelfNames.get(work.shelfId) } }
  }
  const path = work.categoryRoot ? [work.categoryRoot, ...(work.categoryLeaf ? [work.categoryLeaf] : [])] : null
  if (path && path.length > 0) {
    // Nearest first: a hidden leaf names itself, otherwise its root does.
    for (let depth = path.length; depth >= 1; depth -= 1) {
      const candidate = path.slice(0, depth)
      const hit = taxonomy.hiddenCategoryPaths.find((hidden) => hidden.length === candidate.length
        && hidden.every((name, index) => name === candidate[index]))
      if (hit) return { reason: 'category', via: { categoryName: candidate[candidate.length - 1] } }
    }
  }
  const hitNames = workTagNames.filter((name) => taxonomy.hiddenTagNames.includes(name))
  if (hitNames.length > 0) return { reason: 'tag', via: { tagNames: hitNames } }
  return { reason: null }
}

/**
 * Single-work detail for detail/read gates that already hold the work row.
 * Loads the library taxonomy once per call; libraries are small and the
 * result is not cached across requests.
 */
export function getWorkHiddenDetail(
  db: ReturnType<typeof getDb>,
  libraryId: string,
  work: { id: string; shelfId?: string | null; categoryRoot: string | null; categoryLeaf: string | null; hidden: boolean },
): WorkHiddenDetail {
  if (work.hidden) return { reason: 'direct' }
  const taxonomy = loadLibraryHiddenTaxonomy(db, libraryId)
  const tagNames = taxonomy.hiddenTagNames.length === 0 ? [] : db.select({ name: libraryBookTagValues.name })
    .from(libraryBookTagValues)
    .where(and(
      eq(libraryBookTagValues.libraryBookId, work.id),
      inArray(libraryBookTagValues.name, taxonomy.hiddenTagNames),
    )).all().map((row) => row.name)
  return classifyWorkHidden(work, taxonomy, tagNames)
}

/**
 * Read-time visibility exclusion for works (see Hidden boundary). A work is
 * listed only when it is not hidden itself, sits outside every hidden
 * category branch (null = uncategorized, always outside), and carries no
 * hidden tag. Callers that may see hidden rows (shared-library managers,
 * private owners with showHidden) skip this condition entirely.
 *
 * The pieces are exported separately so sidebar counts can stay consistent
 * with the lists they annotate: a visible shelf/tag still must not count
 * works hidden through another dimension.
 */
export function workDirectHiddenExclusion(): SQL {
  return eq(libraryBooks.hidden, false)
}

export function hiddenCategoryExclusion(hiddenCategoryPaths: string[][]): SQL | undefined {
  if (hiddenCategoryPaths.length === 0) return undefined
  const roots = hiddenCategoryPaths.filter((path) => path.length === 1).map((path) => path[0]!)
  const leaves = hiddenCategoryPaths.filter((path) => path.length === 2)
  const conditions: SQL[] = []
  if (roots.length > 0) conditions.push(or(isNull(libraryBooks.categoryRoot), notInArray(libraryBooks.categoryRoot, roots)) as SQL)
  for (const [root, leaf] of leaves) {
    conditions.push(sql`(
      ${libraryBooks.categoryRoot} IS NULL
      OR ${libraryBooks.categoryRoot} <> ${root}
      OR ${libraryBooks.categoryLeaf} IS NULL
      OR ${libraryBooks.categoryLeaf} <> ${leaf}
    )`)
  }
  if (conditions.length === 0) return undefined
  return conditions.length === 1 ? conditions[0] : and(...conditions) as SQL
}

export function hiddenShelfExclusion(hiddenShelfIds: string[]): SQL | undefined {
  if (hiddenShelfIds.length === 0) return undefined
  return or(isNull(libraryBooks.shelfId), notInArray(libraryBooks.shelfId, hiddenShelfIds)) as SQL
}

export function hiddenTagExclusion(hiddenTagNames: string[]): SQL | undefined {
  if (hiddenTagNames.length === 0) return undefined
  return sql`NOT EXISTS (
    SELECT 1 FROM ${libraryBookTagValues} AS hidden_book_tag
    WHERE hidden_book_tag.library_book_id = ${libraryBooks.id}
      AND hidden_book_tag.name IN ${hiddenTagNames}
  )`
}

export function workHiddenExclusion(taxonomy: LibraryHiddenTaxonomy): SQL {
  const conditions: SQL[] = [workDirectHiddenExclusion()]
  const category = hiddenCategoryExclusion(taxonomy.hiddenCategoryPaths)
  if (category) conditions.push(category)
  const shelf = hiddenShelfExclusion(taxonomy.hiddenShelfIds)
  if (shelf) conditions.push(shelf)
  const tag = hiddenTagExclusion(taxonomy.hiddenTagNames)
  if (tag) conditions.push(tag)
  return and(...conditions) as SQL
}

/**
 * Single-work version of the exclusion above, for detail/read gates that
 * already hold the work row. Loads the library taxonomy once per call;
 * libraries are small and the result is not cached across requests.
 */
export function isWorkEffectivelyHidden(
  db: ReturnType<typeof getDb>,
  libraryId: string,
  work: { id: string; shelfId?: string | null; categoryRoot: string | null; categoryLeaf: string | null; hidden: boolean },
): boolean {
  return getWorkHiddenDetail(db, libraryId, work).reason !== null
}

/**
 * The same author drill-down the private list offers, with the same meaning: an
 * author matches on what a reader actually sees, which is the version's override
 * when it has one and the work's default otherwise. A work with several versions
 * matches if any of them resolves to that author - otherwise filtering by an
 * author one version overrode would hide the work it still appears under.
 *
 * The match is purely per-version: a bare work-default comparison would also
 * hit works whose every visible version overrode the author away, which is a
 * false positive, not inheritance (inherited defaults already resolve through
 * the coalesce below).
 */
export function authorFilter(author: string, libraryId: string, opts?: { publishedOnly?: boolean }): SQL | undefined {
  if (!author) return undefined
  return sql`EXISTS (
    SELECT 1 FROM ${libraryBookVersions} AS filter_author_version
    WHERE filter_author_version.library_id = ${libraryId}
      AND filter_author_version.library_book_id = ${libraryBooks.id}
      ${opts?.publishedOnly ? sql`AND filter_author_version.status = 'published'` : sql``}
      AND (
        coalesce(filter_author_version.author, ${libraryBooks.author}) = ${author}
        OR EXISTS (
          SELECT 1 FROM json_each(coalesce(filter_author_version.authors, ${libraryBooks.authors}, '[]'))
          WHERE value = ${author}
        )
      )
  )`
}

/**
 * Shelf, category, and tag *names* are searchable alongside the work's own fields, so
 * typing a shelf or tag name finds the works filed under it.
 */
export function taxonomyNameMatch(pattern: string, libraryId: string): SQL {
  const shelfMatch = sql`EXISTS (
    SELECT 1 FROM ${shelves} AS q_shelf
    WHERE q_shelf.id = ${libraryBooks.shelfId}
      AND q_shelf.library_id = ${libraryId}
      AND q_shelf.name LIKE ${pattern} ESCAPE '!'
  )`
  const categoryMatch = sql`(
    ${libraryBooks.categoryRoot} LIKE ${pattern} ESCAPE '!'
    OR ${libraryBooks.categoryLeaf} LIKE ${pattern} ESCAPE '!'
  )`
  const tagMatch = sql`EXISTS (
    SELECT 1 FROM ${libraryBookTagValues} AS q_book_tag
    WHERE q_book_tag.library_book_id = ${libraryBooks.id}
      AND q_book_tag.name LIKE ${pattern} ESCAPE '!'
  )`
  return sql`(${shelfMatch} OR ${categoryMatch} OR ${tagMatch})`
}

/**
 * A work also matches when any of its versions resolves to the search text:
 * readers see the version override first, so searching only the work defaults
 * would miss a version renamed away from them. Hidden versions never match
 * for non-managers, for the same reason the author filter excludes them.
 */
export function versionEffectiveMatch(pattern: string, libraryId: string, opts?: { publishedOnly?: boolean }): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${libraryBookVersions} AS q_version
    WHERE q_version.library_book_id = ${libraryBooks.id}
      AND q_version.library_id = ${libraryId}
      ${opts?.publishedOnly ? sql`AND q_version.status = 'published'` : sql``}
      AND (
        coalesce(q_version.title, ${libraryBooks.title}) LIKE ${pattern} ESCAPE '!'
        OR coalesce(q_version.author, ${libraryBooks.author}) LIKE ${pattern} ESCAPE '!'
        OR EXISTS (
          SELECT 1 FROM json_each(coalesce(q_version.authors, ${libraryBooks.authors}, '[]'))
          WHERE value LIKE ${pattern} ESCAPE '!'
        )
      )
  )`
}

/**
 * One ordering for both lists. Unknown keys fall back to newest-first, and a key
 * a list cannot honour (progress in a shared catalog) falls through to the same
 * default rather than producing a broken query.
 */
export function libraryOrderBy(sortBy: string | undefined, sortOrder: string | undefined, columns: LibrarySortColumns): SQL[] {
  const direction = sortOrder === 'asc' ? asc : desc
  const key = (column: SQLWrapper | undefined): SQL[] | undefined => (column ? [direction(column)] : undefined)
  const resolved =
    (sortBy === 'title' && key(columns.title))
    || (sortBy === 'author' && key(columns.author))
    || (sortBy === 'size' && key(columns.size))
    || (sortBy === 'progress' && key(columns.progress))
    || (sortBy === 'lastReadAt' && key(columns.lastReadAt))
    || (sortBy === 'updatedAt' && key(columns.updatedAt))
    || (sortBy === 'deletedAt' && key(columns.deletedAt))
    || key(columns.createdAt)
  // The work id breaks ties so paging cannot repeat or skip a row.
  return [...(resolved ?? [desc(columns.createdAt)]), asc(libraryBooks.id)]
}

/**
 * The series a file declared, read the same way a private list reads it: the
 * latest content revision's bookmeta, never a copied column. A shared library
 * stores no series of its own because it has no use for one - its work titles
 * and authors are curated fields - but the versions it manages are real
 * BookVersions whose parsed metadata says exactly what a private book's does.
 * A work matches when any of its versions resolves to that series, for the same
 * reason authorFilter does.
 */
export function seriesFilter(series: string, libraryId: string, opts?: { publishedOnly?: boolean }): SQL | undefined {
  if (!series) return undefined
  return sql`${libraryBooks.id} IN (
    SELECT series_version.library_book_id FROM ${libraryBookVersions} AS series_version
    INNER JOIN ${bookVersions} AS series_book
      ON series_book.id = series_version.book_version_id
    WHERE series_version.library_id = ${libraryId}
      ${opts?.publishedOnly ? sql`AND series_version.status = 'published'` : sql``}
      AND json_extract((
        SELECT ${contentRevisions.meta} FROM ${contentRevisions}
        WHERE ${contentRevisions.bookVersionId} = series_book.id
        ORDER BY ${contentRevisions.revisionNo} DESC LIMIT 1
      ), '$.bookmeta.series') = ${series}
  )`
}

/** All list filters that mean the same thing in every library, in one place. */
export function sharedListConditions(query: LibraryListQuery, libraryId: string, opts?: { publishedOnly?: boolean }): SQL[] {
  const conditions: SQL[] = []
  const libraryType = getDb().select({ type: libraries.type }).from(libraries).where(eq(libraries.id, libraryId)).get()?.type
  const categoryScope = libraryType === 'private' ? 'subtree' : query.categoryScope ?? 'direct'
  const category = categoryFilter(query.category, categoryScope)
  if (category) conditions.push(category)
  if (query.shelfId !== undefined) {
    conditions.push(sql`EXISTS (SELECT 1 FROM ${libraries} WHERE ${libraries.id} = ${libraryId} AND ${libraries.type} = 'private')`)
    conditions.push(query.shelfId === 'none'
      ? isNull(libraryBooks.shelfId)
      : eq(libraryBooks.shelfId, query.shelfId))
  }
  const tag = query.tag ? tagFilter(query.tag) : undefined
  if (tag) conditions.push(tag)
  const author = authorFilter(query.author ?? '', libraryId, opts)
  if (author) conditions.push(author)
  const series = seriesFilter(query.series ?? '', libraryId, opts)
  if (series) conditions.push(series)
  const format = query.format
  if (format) {
    // A work matches when any of its versions has the format, mirroring the
    // private list where each row is one version.
    conditions.push(sql`${libraryBooks.id} IN (
      SELECT filter_link.library_book_id FROM library_book_versions AS filter_link
      INNER JOIN book_versions AS filter_version ON filter_version.id = filter_link.book_version_id
      WHERE filter_version.format = ${format}
      ${opts?.publishedOnly ? sql`AND filter_link.status = 'published'` : sql``}
    )`)
  }
  if (typeof query.updatedSince === 'number' && Number.isFinite(query.updatedSince)) {
    conditions.push(sql`max(${libraryBooks.updatedAt}, ${contentRevisions.createdAt}) >= ${query.updatedSince}`)
  }
  return conditions
}

export function andAll(conditions: SQL[]): SQL | undefined {
  return conditions.length > 0 ? and(...conditions) : undefined
}
