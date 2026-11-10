import type { ArchiveRecordType } from '@bookdock/shared'

export interface ArchiveBookSearch {
  bookView?: 'data' | 'notes'
  bookType?: ArchiveRecordType | 'all'
  bookSort?: 'chapter' | 'chapter-desc' | 'time-desc' | 'time-asc' | 'recent'
}
const RECORD_TYPES: Array<ArchiveRecordType | 'all'> = ['all', 'highlight', 'idea', 'bookmark', 'review']
const BOOK_SORTS = ['chapter', 'chapter-desc', 'time-desc', 'time-asc', 'recent'] as const

export function parseArchiveBookSearch(search: Record<string, unknown>): ArchiveBookSearch {
  return {
    bookView: search.bookView === 'data' || search.bookView === 'notes' ? search.bookView : undefined,
    bookType: typeof search.bookType === 'string' && (RECORD_TYPES as string[]).includes(search.bookType) ? search.bookType as ArchiveRecordType | 'all' : undefined,
    bookSort: typeof search.bookSort === 'string' && (BOOK_SORTS as readonly string[]).includes(search.bookSort) ? search.bookSort as typeof BOOK_SORTS[number] : undefined,
  }
}
