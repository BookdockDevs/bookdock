import { createContext, useContext } from 'react'

import type { ClientDataScope } from '@bookdock/shared'

import type { localCatalogOperations } from '../local-library/catalog'

export interface LocalCatalogSource {
  scope: Extract<ClientDataScope, { kind: 'local' }>
  operations: ReturnType<typeof localCatalogOperations>
}

export const CatalogSourceContext = createContext<LocalCatalogSource | null>(null)
export const useLocalCatalog = () => useContext(CatalogSourceContext)
