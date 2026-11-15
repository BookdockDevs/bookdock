import { and, eq, isNotNull, isNull, not, or, sql, type SQL } from 'drizzle-orm'

import { bindLibrarySearch, classificationValueKey, parseCategoryValueKey, LibrarySearchError, readLibrarySearchExpression, visitLibrarySearch, type BookFormat, type CategoryScope, type LibrarySearchExpression } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookVersions, shelves } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { assertLibraryBrowsable, isLibraryManager, requireLibraryOwner } from './library-access'
import { loadLibraryHiddenTaxonomy, workHiddenExclusion } from './library-query'
import { categorySearchNames, tagSearchNames } from '../classification/classification.service'

/**
 * Names a `category:`/`tag:` term may resolve to, minus values hidden from this
 * viewer. A hidden root also removes its children, because the branch is gone
 * from that viewer's navigation.
 */
function searchableNames(libraryId: string, opts: { categories: boolean; tags: boolean }, hideHidden: boolean) {
  // A plain-text or non-taxonomy query must not touch the database at all, so
  // the lookup is skipped entirely when no term can bind to a value.
  if (!opts.categories && !opts.tags) return { categories: [], tags: [] }
  const db = getDb()
  const hidden = hideHidden ? loadLibraryHiddenTaxonomy(db, libraryId) : undefined
  const hiddenKeys = new Set<string>()
  for (const path of hidden?.hiddenCategoryPaths ?? []) hiddenKeys.add(classificationValueKey('category', path))
  const categories = opts.categories
    ? categorySearchNames(db, libraryId).filter((entry) => !hiddenKeys.has(entry.id) && !(entry.parentId && hiddenKeys.has(entry.parentId)))
    : []
  const tags = opts.tags
    ? tagSearchNames(db, libraryId).filter((entry) => !hidden?.hiddenTagNames.includes(entry.name))
    : []
  return { categories, tags }
}

/** Turn one bound field term into the list filter it stands for. */
export function searchFieldFilter(node: { field: string; value: string; id?: string }): {
  category?: string[]
  categoryScope?: CategoryScope
  tag?: string
  shelfId?: string
  author?: string
  format?: BookFormat
  status?: string
} {
  if (node.field === 'category') {
    const path = parseCategoryValueKey(node.id ?? node.value)
    if (!path) throw new LibrarySearchError(`category:${node.value} 名称不存在或不可访问`, 0)
    return { category: path }
  }
  if (node.field === 'tag') return { tag: node.id ?? node.value }
  if (node.field === 'shelf') return { shelfId: node.id ?? node.value }
  if (node.field === 'format') return { format: node.value as BookFormat }
  return { [node.field]: node.value }
}

export function searchExpressionError(error: unknown): never {
  if (error instanceof LibrarySearchError) throw new AppError('VALIDATION_ERROR', 'Invalid search expression', { message: error.message, start: error.start, end: error.end })
  throw error
}

export function compileSearchExpression(
  input: unknown,
  libraryId: string,
  shared: boolean,
  leaf: (node: Extract<LibrarySearchExpression, { kind: 'text' | 'field' }>) => SQL,
  visibleTaxonomyOnly = false,
): SQL {
  try {
    const parsed = readLibrarySearchExpression(input)
    if (parsed.kind === 'text') return leaf(parsed)
    let needsTags = false
    let needsCategories = false
    let needsShelves = false
    visitLibrarySearch(parsed, (node) => {
      if (node.kind !== 'field') return
      if (node.field === 'tag') needsTags = true
      if (node.field === 'shelf') needsShelves = true
      if (node.field === 'category') needsCategories = true
    })
    const db = needsShelves ? getDb() : undefined
    const hidden = db && visibleTaxonomyOnly ? loadLibraryHiddenTaxonomy(db, libraryId) : undefined
    const names = searchableNames(libraryId, { categories: needsCategories, tags: needsTags }, visibleTaxonomyOnly)
    const expression = bindLibrarySearch(parsed, {
      shared,
      tags: names.tags,
      categories: names.categories,
      shelves: needsShelves && !shared ? db!.select().from(shelves).where(eq(shelves.libraryId, libraryId)).all().filter((shelf) => !hidden?.hiddenShelfIds.includes(shelf.id)) : [],
    })
    const compile = (node: LibrarySearchExpression): SQL => {
      if (node.kind === 'and') return and(compile(node.left), compile(node.right)) as SQL
      if (node.kind === 'or') return or(compile(node.left), compile(node.right)) as SQL
      if (node.kind === 'not') return not(compile(node.child))
      // NULL must behave as no match before NOT is applied.
      if (node.kind === 'text' || node.kind === 'field') return sql`coalesce((${leaf(node)}), 0)`
      throw new LibrarySearchError('搜索表达式结构无效', node.start, node.end)
    }
    return compile(expression)
  } catch (error) { return searchExpressionError(error) }
}

export async function listSearchAuthors(actorId: string, libraryId?: string, trash = false, showHidden = false): Promise<string[]> {
  const db = getDb()
  const library = libraryId
    ? await assertLibraryBrowsable(actorId, libraryId)
    : db.select().from(libraries).where(and(eq(libraries.userId, actorId), eq(libraries.type, 'private'))).get()
  if (!library) return []
  const shared = library.type === 'shared'
  const manager = shared && await isLibraryManager(actorId, library.id)
  if (shared && trash) await requireLibraryOwner(actorId, library.id)
  const conditions: SQL[] = [eq(libraryBookVersions.libraryId, library.id), trash ? isNotNull(libraryBooks.deletedAt) : isNull(libraryBooks.deletedAt)]
  if (!shared) conditions.push(eq(libraryBooks.userId, actorId))
  if (shared && !manager) conditions.push(eq(libraryBookVersions.status, 'published'))
  if (!trash && (shared ? !manager : !showHidden)) conditions.push(workHiddenExclusion(loadLibraryHiddenTaxonomy(db, library.id)))
  const rows = db.select({
    author: sql<string>`coalesce(${libraryBookVersions.author}, ${libraryBooks.author})`,
    authors: sql<string>`coalesce(${libraryBookVersions.authors}, ${libraryBooks.authors}, '[]')`,
  }).from(libraryBookVersions).innerJoin(libraryBooks, eq(libraryBookVersions.libraryBookId, libraryBooks.id)).where(and(...conditions)).all()
  return [...new Set(rows.flatMap((row) => {
    const authors: unknown = JSON.parse(row.authors)
    return [...(row.author ? [row.author] : []), ...(Array.isArray(authors) ? authors.filter((value): value is string => typeof value === 'string' && value.length > 0) : [])]
  }))].sort((a, b) => a.localeCompare(b))
}
