import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { NotificationPage, NotificationTarget } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'

export function useUnreadNotifications() {
  const user = useAuthStore((state) => state.user)
  return useQuery({
    queryKey: ['notifications', user?.id, 'unread'],
    queryFn: () => apiGet<{ data: { count: number } }>('/notifications/unread'),
    enabled: Boolean(user), staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true,
  })
}

export function useNotifications(page: number) {
  const user = useAuthStore((state) => state.user)
  return useQuery({
    queryKey: ['notifications', user?.id, 'page', page],
    queryFn: () => apiGet<{ data: NotificationPage }>(`/notifications?page=${page}`),
    enabled: Boolean(user), staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true,
  })
}

export function useNotificationTarget(id?: string) {
  const user = useAuthStore((state) => state.user)
  return useQuery({
    queryKey: ['notifications', user?.id, 'target', id],
    queryFn: () => apiGet<{ data: NotificationTarget }>(`/notifications/${encodeURIComponent(id!)}/target`),
    enabled: Boolean(user && id), staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true,
  })
}

export function useNotificationRead() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; read: boolean } | { all: true }) => 'all' in input
      ? apiPut('/notifications/read-all', {})
      : apiPut(`/notifications/${encodeURIComponent(input.id)}/read`, { read: input.read }),
    onSettled: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
