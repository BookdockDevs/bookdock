import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { fetchSettings, seedSettingsQuery } from '@/lib/settings-cache'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 1,
    },
  },
})

queryClient.setQueryDefaults(['settings'], {
  queryFn: fetchSettings,
  staleTime: 0,
})

seedSettingsQuery(queryClient)

useAuthStore.subscribe((state, previous) => {
  if (state.user?.id === previous.user?.id && state.user?.guest === previous.user?.guest && state.user?.role === previous.user?.role) return
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== 'auth' }
  void queryClient.cancelQueries(filters)
  queryClient.removeQueries(filters)
})

useUiStore.subscribe((state, previous) => {
  if (state.revealHidden === previous.revealHidden) return
  const prefixes = ['books', 'book', 'shelves', 'tags', 'chapters', 'progress', 'annotations', 'reading-records', 'reading-sessions', 'batch-selection']
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => prefixes.includes(String(query.queryKey[0])) }
  // Cancel first so an older hidden-inclusive response cannot repopulate a reset cache.
  void queryClient.cancelQueries(filters)
  void queryClient.resetQueries(filters)
})
