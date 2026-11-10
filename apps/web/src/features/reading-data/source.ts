import type { ClientBookRef, ClientDataScope } from '@bookdock/shared'
import { clientScopeKey } from '@bookdock/shared'

export function assertSourceBook(scope: ClientDataScope, book: ClientBookRef): void {
  if (JSON.stringify(clientScopeKey(scope)) !== JSON.stringify(clientScopeKey(book.scope))) throw new Error('Book belongs to a different data source')
}
