import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

import { bookVersions, contentRevisions, libraryBookTags, libraryBooks, libraryBookVersions, libraryCategories, libraryTags } from '../../db/schema'
import type { getDb } from '../../db/client'
import type { CategoryScope, HiddenReason, HiddenVia } from '@bookdock/shared'

/**
 * Query dimensions a library's book list can be filtered and ordered by (0.4.0).
 *
 * A private library's own list and a shared library's catalog are the same kind
 * of thing - works in a library, filed under that library's categories and tags -
 * so they share one implementation of the parts that mean the same thing to both.
 * `shelfId` and `categoryId` are two names for the same column: a private
 * library's shelf is a LibraryBook.categoryId, and a library's category is the
 * identical table scoped by libraryId. Keeping both names is only about the
 * vocabulary the UI uses; the query is one.
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
  /** Category, or the 'none' sentinel for uncategorized. */
  categoryId?: string
  categoryScope?: CategoryScope
  tagId?: string
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

/** 'none' filters uncategorized works; otherwise the category must match. */
export function categoryFilter(categoryId: string | undefined, scope: CategoryScope = 'direct', libraryId?: string): SQL | undefined {
  if (categoryId === 'none') return isNull(libraryBooks.categoryId)
  if (!categoryId) return undefined
  if (scope === 'subtree' && libraryId) {
    // UNION terminates even for a historical cycle; every step stays in-library.
    return sql`${libraryBooks.categoryId} IN (
      WITH RECURSIVE category_tree(id) AS (
        SELECT id FROM library_categories WHERE id = ${categoryId} AND library_id = ${libraryId}
        UNION
        SELECT child.id FROM library_categories child
        INNER JOIN category_tree parent ON child.parent_id = parent.id
        WHERE child.library_id = ${libraryId}
      ) SELECT id FROM category_tree
    )`
  }
  return eq(libraryBooks.categoryId, categoryId)
}

export function publishedWorkExists(): SQL {
  return sql`EXISTS (
    SELECT 1 FROM library_book_versions AS visible_version
    WHERE visible_version.library_book_id = ${libraryBooks.id}
      AND visible_version.library_id = ${libraryBooks.libraryId}
      AND visible_version.status = 'published'
  )`
}

/** Works carrying the tag, scoped to the library so ids cannot cross over. */
export function tagFilter(tagId: string, libraryId: string): SQL | undefined {
  if (!tagId) return undefined
  return sql`${libraryBooks.id} IN (
    SELECT ${libraryBookTags.libraryBookId} FROM ${libraryBookTags}
    INNER JOIN library_tags AS filter_tag ON filter_tag.id = ${libraryBookTags.tagId}
    WHERE ${libraryBookTags.tagId} = ${tagId} AND filter_tag.library_id = ${libraryId}
  )`
}

/**
 * Persistent-hide taxonomy snapshot for one library (see Hidden boundary in
 * architecture.md). Category hiding propagates down: a hidden category hides
 * its whole subtree, so the closure contains every hidden node plus all of
 * its descendants. Tag hiding is flat: any hidden tag hides every work that
 * carries it. Libraries are small; the walk runs in memory per request.
 */
export interface LibraryHiddenTaxonomy {
  hiddenCategoryIds: string[]
  /** Only rows flagged hidden themselves, without inherited descendants. */
  directHiddenCategoryIds: string[]
  hiddenTagIds: string[]
  /** Every category's display name, for naming the hiding ancestor. */
  categoryNames: Map<string, string>
  /** Every category's parent, for walking a work's ancestry upward. */
  categoryParents: Map<string, string | null>
  /** Hidden tags' display names, for naming the hiding tags. */
  hiddenTagNames: Map<string, string>
}

export function loadLibraryHiddenTaxonomy(
  db: ReturnType<typeof getDb>,
  libraryId: string,
): LibraryHiddenTaxonomy {
  const categories = db.select({
    id: libraryCategories.id,
    parentId: libraryCategories.parentId,
    hidden: libraryCategories.hidden,
    name: libraryCategories.name,
  }).from(libraryCategories).where(eq(libraryCategories.libraryId, libraryId)).all()
  const childrenByParent = new Map<string, string[]>()
  const categoryNames = new Map<string, string>()
  const categoryParents = new Map<string, string | null>()
  for (const category of categories) {
    categoryNames.set(category.id, category.name)
    categoryParents.set(category.id, category.parentId)
    if (!category.parentId) continue
    const siblings = childrenByParent.get(category.parentId) ?? []
    siblings.push(category.id)
    childrenByParent.set(category.parentId, siblings)
  }
  const closure = new Set<string>()
  const queue = categories.filter((category) => category.hidden).map((category) => category.id)
  for (const id of queue) closure.add(id)
  while (queue.length > 0) {
    const current = queue.pop() as string
    for (const child of childrenByParent.get(current) ?? []) {
      if (closure.has(child)) continue
      closure.add(child)
      queue.push(child)
    }
  }
  const tags = db.select({ id: libraryTags.id, name: libraryTags.name }).from(libraryTags)
    .where(and(eq(libraryTags.libraryId, libraryId), eq(libraryTags.hidden, true))).all()
  return {
    hiddenCategoryIds: [...closure],
    directHiddenCategoryIds: categories.filter((category) => category.hidden).map((category) => category.id),
    hiddenTagIds: tags.map((tag) => tag.id),
    categoryNames,
    categoryParents,
    hiddenTagNames: new Map(tags.map((tag) => [tag.id, tag.name])),
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
 * over tag, so a work hidden two ways still names one cause. The category
 * name is the nearest hidden ancestor, which is where the owner must unhide.
 */
export function classifyWorkHidden(
  work: { hidden: boolean; categoryId: string | null },
  taxonomy: LibraryHiddenTaxonomy,
  workTagIds: string[] = [],
): WorkHiddenDetail {
  if (work.hidden) return { reason: 'direct' }
  // Walk the ancestry for the nearest directly-hidden category: descendants
  // inherit the hide but only the flagged ancestor names the cause.
  const seen = new Set<string>()
  let current: string | null | undefined = work.categoryId
  while (current && !seen.has(current)) {
    seen.add(current)
    if (taxonomy.directHiddenCategoryIds.includes(current)) {
      return { reason: 'category', via: { categoryName: taxonomy.categoryNames.get(current) } }
    }
    current = taxonomy.categoryParents.get(current) ?? null
  }
  const hitNames = workTagIds.flatMap((id) => {
    const name = taxonomy.hiddenTagNames.get(id)
    return name === undefined ? [] : [name]
  })
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
  work: { id: string; categoryId: string | null; hidden: boolean },
): WorkHiddenDetail {
  if (work.hidden) return { reason: 'direct' }
  const taxonomy = loadLibraryHiddenTaxonomy(db, libraryId)
  const tagIds = taxonomy.hiddenTagIds.length === 0 ? [] : db.select({ tagId: libraryBookTags.tagId }).from(libraryBookTags)
    .where(and(
      eq(libraryBookTags.libraryBookId, work.id),
      inArray(libraryBookTags.tagId, taxonomy.hiddenTagIds),
    )).all().map((row) => row.tagId)
  return classifyWorkHidden(work, taxonomy, tagIds)
}

/**
 * Read-time visibility exclusion for works (see Hidden boundary). A work is
 * listed only when it is not hidden itself, sits outside every hidden
 * category subtree (null = uncategorized, always outside), and carries no
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

export function hiddenCategoryExclusion(hiddenCategoryIds: string[]): SQL | undefined {
  if (hiddenCategoryIds.length === 0) return undefined
  return or(
    isNull(libraryBooks.categoryId),
    notInArray(libraryBooks.categoryId, hiddenCategoryIds),
  ) as SQL
}

export function hiddenTagExclusion(hiddenTagIds: string[]): SQL | undefined {
  if (hiddenTagIds.length === 0) return undefined
  return sql`NOT EXISTS (
    SELECT 1 FROM ${libraryBookTags} AS hidden_book_tag
    INNER JOIN ${libraryTags} AS hidden_tag ON hidden_tag.id = hidden_book_tag.tag_id
    WHERE hidden_book_tag.library_book_id = ${libraryBooks.id}
      AND hidden_tag.id IN ${hiddenTagIds}
  )`
}

export function workHiddenExclusion(taxonomy: LibraryHiddenTaxonomy): SQL {
  const conditions: SQL[] = [workDirectHiddenExclusion()]
  const category = hiddenCategoryExclusion(taxonomy.hiddenCategoryIds)
  if (category) conditions.push(category)
  const tag = hiddenTagExclusion(taxonomy.hiddenTagIds)
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
  work: { id: string; categoryId: string | null; hidden: boolean },
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
 * Category and tag *names* are searchable alongside the work's own fields, so
 * typing a shelf or tag name finds the works filed under it.
 */export function taxonomyNameMatch(pattern: string, libraryId: string): SQL {
  const categoryMatch = sql`EXISTS (
    SELECT 1 FROM ${libraryCategories} AS q_category
    WHERE q_category.id = ${libraryBooks.categoryId}
      AND q_category.library_id = ${libraryId}
      AND q_category.name LIKE ${pattern} ESCAPE '!'
  )`
  const tagMatch = sql`EXISTS (
    SELECT 1 FROM ${libraryBookTags} AS q_book_tag
    INNER JOIN library_tags AS q_tag ON q_tag.id = q_book_tag.tag_id
    WHERE q_book_tag.library_book_id = ${libraryBooks.id}
      AND q_tag.library_id = ${libraryId}
      AND q_tag.name LIKE ${pattern} ESCAPE '!'
  )`
  return sql`(${categoryMatch} OR ${tagMatch})`
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
  const category = categoryFilter(query.categoryId, query.categoryScope, libraryId)
  if (category) conditions.push(category)
  const tag = query.tagId ? tagFilter(query.tagId, libraryId) : undefined
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
