import { QueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 1,
    },
  },
})
