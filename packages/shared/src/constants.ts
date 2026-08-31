export type BookFormat = 'epub' | 'txt'

export const BOOK_FORMATS: BookFormat[] = ['epub', 'txt']

export type ReadStatus = 'wishlist' | 'reading' | 'idle' | 'finished' | 'abandoned'

export const READ_STATUSES: ReadStatus[] = ['wishlist', 'reading', 'finished', 'idle', 'abandoned']

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const

export const SORT_FIELDS = ['title', 'author', 'createdAt', 'updatedAt', 'lastReadAt', 'size'] as const
export type SortField = (typeof SORT_FIELDS)[number]

/** Maximum transformed text accepted in one explicit reader corpus snapshot. */
export const AI_MAX_INDEX_CORPUS_CHARS = 10_000_000
