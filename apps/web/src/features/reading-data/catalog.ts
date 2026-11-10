import type { ClientBook, ClientCatalogEntry, ClientDataScope, ClientReadingState } from '@bookdock/shared'
import { clientScopeKey } from '@bookdock/shared'

export type { ClientActionAvailability as ActionAvailability, ClientCatalogEntry as CatalogEntry, ClientCatalogPage as CatalogPage, ClientCatalogQuery as CatalogQuery } from '@bookdock/shared'

export function catalogQueryKey(scope: ClientDataScope, operation: string, parameters?: unknown): readonly unknown[] {
  return ['client-catalog', ...clientScopeKey(scope), operation, ...(parameters === undefined ? [] : [parameters])]
}

export function localCatalogEntry(book: ClientBook, state: ClientReadingState | null): ClientCatalogEntry {
  return { book, metadata: book.catalog?.metadata ?? null, state }
}
