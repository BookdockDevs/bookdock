import { z } from 'zod'

export type StorageProviderType = 'webdav'

export interface StorageConnectionRes {
  id: string
  name: string
  provider: StorageProviderType
  endpoint: string
  username: string
  basePath: string
  hasSecrets: boolean
  createdAt: number
  updatedAt: number
}

export const createStorageConnectionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  provider: z.literal('webdav').default('webdav'),
  endpoint: z.string().trim().url('Must be a valid URL').max(1000),
  username: z.string().trim().min(1, 'Username is required').max(200),
  password: z.string().max(500).optional(),
  basePath: z.string().trim().max(1000).optional(),
})
export type CreateStorageConnectionReq = z.infer<typeof createStorageConnectionSchema>

export const updateStorageConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  endpoint: z.string().trim().url('Must be a valid URL').max(1000).optional(),
  username: z.string().trim().min(1).max(200).optional(),
  password: z.string().max(500).optional(),
  basePath: z.string().trim().max(1000).optional(),
})
export type UpdateStorageConnectionReq = z.infer<typeof updateStorageConnectionSchema>

export const testStorageConnectionSchema = z.object({
  endpoint: z.string().trim().url('Must be a valid URL').max(1000).optional(),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(500).optional(),
  basePath: z.string().trim().max(1000).optional(),
})
export type TestStorageConnectionReq = z.infer<typeof testStorageConnectionSchema>

export const testDirectStorageConnectionSchema = z.object({
  endpoint: z.string().trim().url('Must be a valid URL').max(1000),
  username: z.string().trim().min(1, 'Username is required').max(200),
  password: z.string().max(500).optional(),
  basePath: z.string().trim().max(1000).optional(),
})
export type TestDirectStorageConnectionReq = z.infer<typeof testDirectStorageConnectionSchema>

