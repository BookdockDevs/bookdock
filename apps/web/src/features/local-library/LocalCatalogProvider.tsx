import { useMemo, type ReactNode } from 'react'

import { CatalogSourceContext } from '../reading-data/catalog-source-context'
import { localCatalogOperations } from './catalog'
import { LOCAL_VAULT_ID } from './id'

export default function LocalCatalogProvider({ children }: { children: ReactNode }) {
  const source = useMemo(() => {
    const scope = { kind: 'local' as const, vaultId: LOCAL_VAULT_ID }
    return { scope, operations: localCatalogOperations(scope) }
  }, [])
  return <CatalogSourceContext.Provider value={source}>{children}</CatalogSourceContext.Provider>
}
