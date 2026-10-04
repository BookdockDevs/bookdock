import { and, eq, isNotNull, isNull, not, or, sql, type SQL } from 'drizzle-orm'

import { bindLibrarySearch, LibrarySearchError, readLibrarySearchExpression, visitLibrarySearch, type LibrarySearchExpression } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookVersions, libraryCategories, libraryTags } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { assertLibraryBrowsable, isLibraryManager, requireLibraryOwner } from './library-access'
import { loadLibraryHiddenTaxonomy, workHiddenExclusion } from './library-query'

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
    visitLibrarySearch(parsed, (node) => {
      if (node.kind !== 'field') return
      if (node.field === 'tag') needsTags = true
      if (node.field === 'shelf' || node.field === 'category') needsCategories = true
    })
    const db = needsTags || needsCategories ? getDb() : undefined
    const hidden = db && visibleTaxonomyOnly ? loadLibraryHiddenTaxonomy(db, libraryId) : undefined
    const expression = bindLibrarySearch(parsed, {
      shared,
      tags: needsTags ? db!.select().from(libraryTags).where(eq(libraryTags.libraryId, libraryId)).all().filter((tag) => !hidden?.hiddenTagIds.includes(tag.id)) : [],
      categories: needsCategories ? db!.select().from(libraryCategories).where(eq(libraryCategories.libraryId, libraryId)).all().filter((category) => !hidden?.hiddenCategoryIds.includes(category.id)) : [],
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
