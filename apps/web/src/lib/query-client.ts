import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { fetchSettings, seedSettingsQuery } from '@/lib/settings-cache'

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
