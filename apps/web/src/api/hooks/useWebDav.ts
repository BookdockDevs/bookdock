import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  WebDavConfigRes,
  WebDavConfigUpdateReq,
  WebDavEntry,
  WebDavImportReq,
  WebDavImportRes,
  WebDavTestReq,
} from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '../client'

export const WEBDAV_CONFIG_KEY = ['webdav', 'config'] as const

export function useWebDavConfig(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: WEBDAV_CONFIG_KEY,
    queryFn: () => apiGet<{ data: WebDavConfigRes }>('/integrations/webdav/config'),
    enabled: options.enabled !== false,
  })
}

export function useUpdateWebDavConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: WebDavConfigUpdateReq) =>
      apiPut<{ data: WebDavConfigRes }>('/integrations/webdav/config', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WEBDAV_CONFIG_KEY })
    },
  })
}

export function useDeleteWebDavConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiDelete<{ data: { success: boolean } }>('/integrations/webdav/config'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WEBDAV_CONFIG_KEY })
    },
  })
}

export function useTestWebDavConnection() {
  return useMutation({
    mutationFn: (body?: WebDavTestReq) =>
      apiPost<{ data: { success: boolean; latencyMs: number } }>('/integrations/webdav/test', body ?? {}),
  })
}

export function useWebDavLs(path: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['webdav', 'ls', path],
    queryFn: () => apiPost<{ data: WebDavEntry[] }>('/integrations/webdav/ls', { path }),
    enabled: options.enabled !== false,
  })
}

export function useWebDavImport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: WebDavImportReq) =>
      apiPost<{ data: WebDavImportRes }>('/integrations/webdav/import', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['shelves'] })
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}
