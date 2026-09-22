import { useQuery } from '@tanstack/react-query'

import type { SystemInfoRes, SystemUpdateCheckRes } from '@bookdock/shared'

import { apiGet } from '../client'

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
