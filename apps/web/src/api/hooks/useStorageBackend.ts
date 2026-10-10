import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ClearStorageCacheRes,
  InspectStorageTargetReq,
  StorageBackendConfigRes,
  StorageMigrationStatusRes,
  StorageRestoreStatusRes,
  StorageTargetInspectionRes,
  TestStorageBackendReq,
  UpdateStorageBackendReq,
} from '@bookdock/shared'

import { apiGet, apiPost, apiPut } from '../client'

export const STORAGE_BACKEND_CONFIG_KEY = ['storage-backend', 'config'] as const
export const STORAGE_BACKEND_MIGRATION_KEY = ['storage-backend', 'migration'] as const

export function useStorageBackendConfig(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: STORAGE_BACKEND_CONFIG_KEY,
    queryFn: () => apiGet<{ data: StorageBackendConfigRes }>('/integrations/storage-backend'),
    enabled: options.enabled !== false,
  })
}

export function useUpdateStorageBackend() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateStorageBackendReq) =>
      apiPut<{ data: StorageBackendConfigRes }>('/integrations/storage-backend', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_CONFIG_KEY })
    },
  })
}

export function useTestStorageBackend() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TestStorageBackendReq) =>
      apiPost<{ data: { success: boolean; latencyMs: number } }>('/integrations/storage-backend/test', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_CONFIG_KEY })
    },
  })
}

export function useClearStorageBackendCache() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiPost<{ data: ClearStorageCacheRes }>(
        '/integrations/storage-backend/clear-cache',
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_CONFIG_KEY })
    },
  })
}

export function useStorageMigrationStatus(options: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: STORAGE_BACKEND_MIGRATION_KEY,
    queryFn: () => apiGet<{ data: StorageMigrationStatusRes }>('/integrations/storage-backend/migration/status'),
    enabled: options.enabled !== false,
    refetchInterval: options.refetchInterval ?? 3000,
  })
}

export function useStartStorageMigration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiPost<{ data: { success: boolean } }>('/integrations/storage-backend/migration/start', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_MIGRATION_KEY })
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_CONFIG_KEY })
    },
  })
}

export function usePauseStorageMigration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiPost<{ data: { success: boolean } }>('/integrations/storage-backend/migration/pause', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_MIGRATION_KEY })
    },
  })
}

export const STORAGE_BACKEND_RESTORE_KEY = ['storage-backend', 'restore'] as const

export function useInspectStorageTarget() {
  return useMutation({
    mutationFn: (body: InspectStorageTargetReq) =>
      apiPost<{ data: StorageTargetInspectionRes }>('/integrations/storage-backend/inspect', body),
  })
}

export function useStorageRestoreStatus(options: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: STORAGE_BACKEND_RESTORE_KEY,
    queryFn: () => apiGet<{ data: StorageRestoreStatusRes }>('/integrations/storage-backend/restore/status'),
    enabled: options.enabled !== false,
    refetchInterval: options.refetchInterval ?? 3000,
  })
}

export function useStartStorageRestore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiPost<{ data: StorageRestoreStatusRes }>('/integrations/storage-backend/restore/start', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_RESTORE_KEY })
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_CONFIG_KEY })
    },
  })
}

export function usePauseStorageRestore() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiPost<{ data: StorageRestoreStatusRes }>('/integrations/storage-backend/restore/pause', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORAGE_BACKEND_RESTORE_KEY })
    },
  })
}
