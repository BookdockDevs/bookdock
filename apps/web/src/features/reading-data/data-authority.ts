import { useMemo } from 'react'

import { useAuthStore } from '@/stores/auth.store'

import { useLocalCatalog, type LocalCatalogSource } from './catalog-source-context'
import { DEVICE_VAULT_SCOPE, localCatalogOperations } from '../local-library/catalog'

/**
 * Where the data that is *not* a book itself lives: the app settings, reading
 * settings, shelves, categories, tags, trash policy and stats.
 *
 * There is one such dataset, not one per book. It lives in the account when
 * there is an account, and in the device vault for a guest - a guest has no
 * server to hold it, which is why they never see a second copy of anything.
 * A surface pinned to one device book (reader, content editor) answers through
 * its source context and is unaffected.
 *
 * Book-owned data (content, progress, notes, bookmarks, cover) does NOT use
 * this: that follows the book and is decided by `book-source.ts`.
 */
export function useDataAuthority(): LocalCatalogSource | null {
  const context = useLocalCatalog()
  const user = useAuthStore((state) => state.user)
  return useMemo(
    () => context ?? (user ? null : { scope: DEVICE_VAULT_SCOPE, operations: localCatalogOperations(DEVICE_VAULT_SCOPE) }),
    [context, user],
  )
}
