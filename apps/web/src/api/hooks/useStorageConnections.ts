import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateStorageConnectionReq,
  StorageConnectionRes,
  TestDirectStorageConnectionReq,
  TestStorageConnectionReq,
  UpdateStorageConnectionReq,
  WebDavEntry,
  WebDavImportReq,
  WebDavImportRes,
} from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '../client'

export const STORAGE_CONNECTIONS_KEY = ['storage-connections'] as const

export function useStorageConnections(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: STORAGE_CONNECTIONS_KEY,
    queryFn: () => apiGet<{ data: StorageConnectionRes[] }>('/integrations/storage-connections'),
    enabled: options.enabled !== false,
  })
}

export function useCreateStorageConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateStorageConnectionReq) =>
      apiPost<{ data: StorageConnectionRes }>('/integrations/storage-connections', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONNECTIONS_KEY })
    },
  })
}

export function useUpdateStorageConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStorageConnectionReq }) =>
      apiPut<{ data: StorageConnectionRes }>(`/integrations/storage-connections/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONNECTIONS_KEY })
    },
  })
}

export function useDeleteStorageConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiDelete<{ data: { success: boolean } }>(`/integrations/storage-connections/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONNECTIONS_KEY })
    },
  })
}

export function useSetDefaultStorageConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiPost<{ data: StorageConnectionRes }>(`/integrations/storage-connections/${id}/default`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_CONNECTIONS_KEY })
    },
  })
}

export function useTestDirectStorageConnection() {
  return useMutation({
    mutationFn: (body: TestDirectStorageConnectionReq) =>
      apiPost<{ data: { success: boolean; latencyMs: number } }>('/integrations/storage-connections/test', body),
  })
}

export function useTestStorageConnection() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: TestStorageConnectionReq }) =>
      apiPost<{ data: { success: boolean; latencyMs: number } }>(`/integrations/storage-connections/${id}/test`, body ?? {}),
  })
}

export function useStorageConnectionLs(
  connectionId: string | null,
  path: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ['storage-connections', connectionId, 'ls', path],
    queryFn: () =>
      apiPost<{ data: WebDavEntry[] }>(`/integrations/storage-connections/${connectionId}/ls`, { path }),
    enabled: Boolean(connectionId) && options.enabled !== false,
    staleTime: 60_000,
  })
}

export function useStorageConnectionImport(connectionId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: WebDavImportReq) => {
      if (!connectionId) throw new Error('No storage connection selected')
      return apiPost<{ data: WebDavImportRes }>(`/integrations/storage-connections/${connectionId}/import`, body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['shelves'] })
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}
