import type { ClientLibraryBookView } from '@bookdock/shared'

export function catalogBookTarget(book: Pick<ClientLibraryBookView, 'id' | 'ref' | 'sourceUnavailable'>) {
  // One route for every book: it resolves where the book lives by itself.
  return { to: '/books/$id' as const, params: { id: book.id } }
}

export function catalogHomeTarget() {
  return { to: '/' as const }
}
