import { z } from 'zod'

export interface StorageBackendConfigRes {
  enabled: boolean
  connectionId: string | null
  connectionName: string | null
  connectionEndpoint: string | null
  basePath: string
  cacheMaxMb: number
  status: 'active' | 'disabled' | 'error'
  lastTestedAt?: number
  latencyMs?: number
  totalBookCount: number
  totalBookBytes: number
  totalCoverBytes: number
  remoteBookCount: number
  remoteBytes: number
  localCachedCount: number
  localCachedBytes: number
  savedDiskBytes: number
  localTotalBytes: number
  availableDiskBytes?: number
  failedTransferCount?: number
}

export const updateStorageBackendSchema = z.object({
  enabled: z.boolean(),
  connectionId: z.string().trim().min(1).nullable(),
  basePath: z.string().trim().min(1).max(1000).default('/Bookdock/storage'),
  cacheMaxMb: z.number().int().min(128).max(1048576).default(2048),
}).refine((v) => !v.enabled || (v.connectionId !== null && v.connectionId.length > 0), {
  message: 'connectionId is required when storage backend is enabled',
  path: ['connectionId'],
})
export type UpdateStorageBackendReq = z.infer<typeof updateStorageBackendSchema>

export const testStorageBackendSchema = z.object({
  connectionId: z.string().trim().min(1),
  basePath: z.string().trim().min(1).max(1000).default('/Bookdock/storage'),
})
export type TestStorageBackendReq = z.infer<typeof testStorageBackendSchema>

export interface StorageMigrationStatusRes {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed'
  totalBooks: number
  migratedBooks: number
  freedBytes: number
  currentBookTitle?: string
  lastError?: string
}

export const inspectStorageTargetSchema = z.object({
  target: z.enum(['local', 'remote']),
  connectionId: z.string().trim().min(1).optional().nullable(),
  basePath: z.string().trim().min(1).max(1000).optional(),
})
export type InspectStorageTargetReq = z.infer<typeof inspectStorageTargetSchema>

export interface StorageTargetInspectionRes {
  target: 'local' | 'remote'
  ready: boolean
  totalBooks: number
  existingBooks: number
  missingBooks: number
  missingBytes: number
  reason?: 'ready' | 'missing_local_files' | 'missing_remote_files' | 'connection_error'
  message?: string
}

export interface StorageRestoreStatusRes {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed'
  totalBooks: number
  restoredBooks: number
  restoredBytes: number
  currentBookTitle?: string
  lastError?: string
}

export interface ClearStorageCacheRes {
  success: boolean
  freedBytes: number
  freedCount: number
}
