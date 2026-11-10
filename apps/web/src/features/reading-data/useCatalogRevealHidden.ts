import { useQuery, useQueryClient } from '@tanstack/react-query'

import { toggleRevealHidden } from '@/lib/reveal-hidden'
import { useUiStore } from '@/stores/ui.store'

import { catalogQueryKey } from './catalog'
import { useLocalCatalog } from './catalog-source-context'

export function useCatalogRevealHidden() {
  const local = useLocalCatalog()
  const client = useQueryClient()
  const remote = useUiStore((state) => state.revealHidden)
  const query = useQuery({
    queryKey: local ? catalogQueryKey(local.scope, 'preferences') : ['catalog-reveal-inactive'],
    queryFn: async () => ({ data: { library: await local!.operations.getCatalogPreferences() } }),
    enabled: Boolean(local),
  })
  return {
    revealHidden: local ? query.data?.data.library.showHidden ?? false : remote,
    async toggle() {
      if (!local) return toggleRevealHidden()
      await local.operations.toggleHidden()
      await client.invalidateQueries({ queryKey: catalogQueryKey(local.scope, 'preferences').slice(0, -1) })
    },
  }
}
