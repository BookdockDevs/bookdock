import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { SystemInfoRes, SystemUpdateCheckRes, UpdateStartReq, UpdateStatusRes } from '@bookdock/shared'

import { apiGet, apiPost } from '../client'

const SYSTEM_INFO_KEY = ['system', 'info'] as const

export function useSystemInfo() {
  return useQuery({
    queryKey: SYSTEM_INFO_KEY,
    queryFn: () => apiGet<{ data: SystemInfoRes }>('/system/info'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useSystemUpdateCheck() {
  return useQuery({
    queryKey: ['system', 'update-check'],
    queryFn: () => apiGet<{ data: SystemUpdateCheckRes }>('/system/update-check'),
    enabled: false,
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

const SYSTEM_UPDATE_STATUS_KEY = ['system', 'update-status'] as const
const UPDATE_POLL_MS = 800

/**
 * Only polled while an update is being tracked. During the container restart the
 * endpoint answers nothing: the request fails, the last phase stays cached and
 * the interval keeps firing — which is exactly "restarting, keep watching".
 */
export function useSystemUpdateStatus(tracking: boolean) {
  return useQuery({
    queryKey: SYSTEM_UPDATE_STATUS_KEY,
    queryFn: () => apiGet<{ data: UpdateStatusRes }>('/system/update/status'),
    enabled: tracking,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) => {
      const phase = query.state.data?.data.phase
      return !phase || (phase !== 'idle' && phase !== 'failed') ? UPDATE_POLL_MS : false
    },
  })
}

export function useStartSystemUpdate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: UpdateStartReq) => apiPost<{ data: UpdateStatusRes }>('/system/update', body),
    onSuccess: (res) => queryClient.setQueryData(SYSTEM_UPDATE_STATUS_KEY, res),
  })
}
