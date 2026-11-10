import type { BookFormat, ReadStatus } from './constants'
import type { AnnotationRes, BookDetailRes, BookListItem, BookMetadata, PaginatedResponse, ReadingRecordBookItem, ShelfListItem } from './contract'
import type { BatchSelectionItem, CatalogBook, Category } from './library'
import type { Review } from './review'
import type { ArchiveBookItem } from './reader-profile'
import type { ClientBook, ClientBookRef, ClientOrganization, ClientPresetBinding, ClientReadingState } from './client-reading'

export interface ClientLibraryBookView extends Omit<BookListItem, 'size'> {
  ref?: ClientBookRef
  size: number | null
  clientVersion?: number
}

export interface ClientLibraryDetailView extends Omit<BookDetailRes, 'filePath' | 'size'> {
  clientPresetBinding?: ClientPresetBinding | null
  ref?: ClientBookRef
  size: number | null
  clientVersion?: number
}

export interface ClientLibraryListView extends PaginatedResponse<ClientLibraryBookView> {
  totalSize: number | null
}

export type ClientTaxonomyView = Omit<ShelfListItem, 'userId'>
export type ClientCategoryView = Omit<Category, 'userId' | 'libraryId'>

export interface ClientBatchSelectionItem extends Omit<BatchSelectionItem, 'bookVersionId' | 'versionCount'> {
  ref?: ClientBookRef
  clientVersion?: number
  bookVersionId?: string
  versionCount?: number
}

export type ClientActionAvailability =
  | { status: 'available' }
  | { status: 'unconfigured' | 'authentication-required' | 'forbidden' | 'unsupported-input' | 'temporarily-unavailable'; reason: string }

export interface ClientCatalogEntry {
  book: Omit<ClientBook, 'version'> & { version: number | null }
  metadata: BookMetadata | null
  state: ClientReadingState | null
  remote?: { kind: 'private'; value: BookListItem } | { kind: 'shared'; value: CatalogBook; libraryId: string }
}

export interface ClientCatalogPage {
  entries: ClientCatalogEntry[]
  total: number
  totalSize: number | null
  organization?: ClientOrganization
}

export interface ClientCatalogQuery {
  trash?: boolean
  page: number
  pageSize: number
  search: string
  expression?: string
  sortBy: string
  sortOrder: string
  shelfId: string | null
  categoryId?: string | null
  tagId: string | null
  author?: string | null
  series?: string | null
  format: BookFormat | null
  readStatus: ReadStatus | null
  showHidden?: boolean
}


export interface ClientArchiveBookDetailView {
  annotations: AnnotationRes[]
  reviews?: Review[]
}

export interface ClientArchiveBookView extends Omit<ArchiveBookItem, 'bookVersionId'> {
  id: string
  ref?: ClientBookRef
}

export interface ClientReadingBookView extends ReadingRecordBookItem {
  ref?: ClientBookRef
}
