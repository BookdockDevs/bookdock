import { useInfiniteQuery, keepPreviousData, type QueryClient } from '@tanstack/react-query'

import type { ActivityPage, ActivityQuery } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'

export type ActivityScope = ActivityQuery['scope']
export type ActivityFilter = ActivityQuery['type']

export function invalidateActivityQueries(queryClient: QueryClient, libraryId?: string) {
  const userId = useAuthStore.getState().user?.id
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[0] === 'activity' && queryKey[1] === userId && (
      queryKey[2] === 'personal'
      || queryKey[2] === 'library' && (!libraryId || queryKey[3] === libraryId)
    ),
  })
}

export const activityQueryKey = (userId: string, scope: ActivityScope, targetId: string, type: ActivityFilter, groupEventId?: string) =>
  ['activity', userId, scope, targetId, type, groupEventId ?? null] as const

export function useActivity(scope: ActivityScope, targetId: string | undefined, type: ActivityFilter) {
  const userId = useAuthStore((state) => state.user?.id)
  return useInfiniteQuery({
    queryKey: activityQueryKey(userId ?? '', scope, targetId ?? '', type),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ scope, type })
      if (scope === 'personal' && targetId) params.set('userId', targetId)
      if (scope === 'library' && targetId) params.set('libraryId', targetId)
      if (pageParam) params.set('cursor', pageParam)
      return apiGet<{ data: ActivityPage }>(`/activity?${params}`, signal)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.data.nextCursor ?? undefined,
    enabled: Boolean(userId && targetId),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function useActivityGroup(scope: ActivityScope, targetId: string, type: ActivityFilter, groupEventId: string, enabled: boolean) {
  const userId = useAuthStore((state) => state.user?.id)
  return useInfiniteQuery({
    queryKey: activityQueryKey(userId ?? '', scope, targetId, type, groupEventId),
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ scope, type, groupEventId })
      if (scope === 'personal') params.set('userId', targetId)
      else params.set('libraryId', targetId)
      if (pageParam) params.set('cursor', pageParam)
      return apiGet<{ data: ActivityPage }>(`/activity?${params}`, signal)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.data.nextCursor ?? undefined,
    enabled: enabled && Boolean(userId),
    staleTime: 30_000,
  })
}
