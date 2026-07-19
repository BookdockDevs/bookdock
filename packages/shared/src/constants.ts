export type BookFormat = 'epub' | 'txt'

export const BOOK_FORMATS: BookFormat[] = ['epub', 'txt']

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const

export const SORT_FIELDS = ['title', 'author', 'createdAt', 'updatedAt', 'size'] as const
export type SortField = (typeof SORT_FIELDS)[number]
