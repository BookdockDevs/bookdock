import type { BookFormat, ReadStatus } from '@bookdock/shared'

export interface UseBooksParams {
  page: number
  pageSize: number
  expression?: string
  search: string
  sortBy: string
  sortOrder: string
  shelfId: string | null
  categoryId?: string | null
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
  if (categoryId) params.set('categoryId', categoryId)
  if (tagId) params.set('tagId', tagId)
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

