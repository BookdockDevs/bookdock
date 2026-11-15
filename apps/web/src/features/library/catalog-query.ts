import { parseCategoryValueKey } from '@bookdock/shared'
import type { BookFormat, ClientCatalogQuery, ReadStatus } from '@bookdock/shared'

export interface UseBooksParams {
  page: number
  pageSize: number
  expression?: string
  search: string
  sortBy: string
  sortOrder: string
  shelfId: string | null
  /** Canonical category value key, or 'none' for the uncategorized shelf. */
  categoryId?: string | null
  /** A tag is identified by its name. */
  tagId: string | null
  author?: string | null
  series?: string | null
  format: BookFormat | null
  readStatus: ReadStatus | null
  source?: 'local' | 'server' | null
  trash: boolean
  /** Private-vault reveal; omitted = hidden rows excluded. */
  showHidden?: boolean
}

/**
 * A category filter on the wire is the value path itself (or the 'none'
 * sentinel). A key that no longer parses is a stale link to a value nothing
 * carries any more, so the filter is dropped instead of matching nothing.
 */
export function categoryFilterValue(categoryId: string | null | undefined): string[] | 'none' | null {
  if (!categoryId) return null
  if (categoryId === 'none') return 'none'
  return parseCategoryValueKey(categoryId)
}

/** The same filter expressed for the local catalog reader. */
export function toCatalogQuery(params: UseBooksParams): ClientCatalogQuery {
  return {
    trash: params.trash,
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    expression: params.expression,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    shelfId: params.shelfId,
    category: categoryFilterValue(params.categoryId),
    tag: params.tagId,
    author: params.author,
    series: params.series,
    format: params.format,
    readStatus: params.readStatus,
    showHidden: params.showHidden,
  }
}

export function buildBooksPath({ page, pageSize, search, sortBy, sortOrder, shelfId, categoryId, tagId, author, series, format, readStatus, trash, showHidden, expression }: UseBooksParams): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sortBy,
    sortOrder,
  })
  if (expression) params.set('expression', expression)
  if (search) params.set('search', search)
  if (shelfId) params.set('shelfId', shelfId)
  const category = categoryFilterValue(categoryId)
  if (category) params.set('category', category === 'none' ? 'none' : JSON.stringify(category))
  if (tagId) params.set('tag', tagId)
  if (author) params.set('author', author)
  if (series) params.set('series', series)
  if (format) params.set('format', format)
  if (readStatus) params.set('readStatus', readStatus)
  if (trash) params.set('trash', '1')
  if (showHidden) params.set('showHidden', '1')
  return `/books?${params.toString()}`
}

export function booksQueryParts(params: UseBooksParams) {
  // Optional filters are folded to one shape: a caller that omits categoryId and
  // a caller that passes null describe the same request, so they must land on
  // the same cache entry - otherwise writing the validated page after a search
  // submit would miss the entry the shelf reads.
  const key = { ...params, categoryId: params.categoryId ?? null, author: params.author ?? null, series: params.series ?? null, source: params.source ?? null, showHidden: params.showHidden ?? false }
  return { queryKey: ['books', key] as const, path: buildBooksPath(key) }
}
