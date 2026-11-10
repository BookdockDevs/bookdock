import type { ClientBookRef } from '@bookdock/shared'

import { isDeviceBook } from './book-source'

// Selection keys are scope-qualified because a local book id and a server book
// id are independent namespaces and can collide once a shelf mixes both
// sources. Everything downstream of a resolved row keeps raw ids.
export type CatalogSelectionKey = `local:${string}` | `server:${string}`

export function catalogSelectionKey(item: { id: string; ref?: Pick<ClientBookRef, 'scope'> | null }): CatalogSelectionKey {
  return isDeviceBook(item.ref) ? `local:${item.id}` : `server:${item.id}`
}

export function catalogSelectionScope(key: string): 'local' | 'server' {
  return key.startsWith('local:') ? 'local' : 'server'
}

export function catalogSelectionId(key: string): string {
  return key.startsWith('local:') ? key.slice('local:'.length) : key.slice('server:'.length)
}

export function splitCatalogSelectionKeys(keys: Iterable<string>): { localIds: string[]; serverIds: string[] } {
  const localIds: string[] = []
  const serverIds: string[] = []
  for (const key of keys) {
    if (catalogSelectionScope(key) === 'local') localIds.push(catalogSelectionId(key))
    else serverIds.push(catalogSelectionId(key))
  }
  return { localIds, serverIds }
}
