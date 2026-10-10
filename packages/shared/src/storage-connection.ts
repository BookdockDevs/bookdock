import { z } from 'zod'

export type StorageProviderType = 'webdav' | 's3'

export interface StorageConnectionRes {
  id: string
  name: string
  provider: StorageProviderType
  endpoint: string
  username: string
  basePath: string
  region: string
  bucket: string
  hasSecrets: boolean
  createdAt: number
  updatedAt: number
}

const storageProviderSchema = z.enum(['webdav', 's3'])
const regionSchema = z.string().trim().max(100).optional()
const bucketSchema = z.string().trim().max(255).optional()

function requireS3Bucket(
  data: { provider?: string; bucket?: string },
  ctx: z.RefinementCtx,
): void {
  if (data.provider === 's3' && (!data.bucket || data.bucket.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bucket'],
      message: 'Bucket is required for S3 connections',
    })
  }
}

export const createStorageConnectionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  provider: storageProviderSchema.default('webdav'),
  endpoint: z.string().trim().url('Must be a valid URL').max(1000),
  username: z.string().trim().min(1, 'Username is required').max(200),
  password: z.string().max(500).optional(),
  basePath: z.string().trim().max(1000).optional(),
  region: regionSchema,
  bucket: bucketSchema,
}).superRefine(requireS3Bucket)
export type CreateStorageConnectionReq = z.infer<typeof createStorageConnectionSchema>

export const updateStorageConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  endpoint: z.string().trim().url('Must be a valid URL').max(1000).optional(),
  username: z.string().trim().min(1).max(200).optional(),
  password: z.string().max(500).optional(),
  basePath: z.string().trim().max(1000).optional(),
  region: regionSchema,
  bucket: bucketSchema,
})
export type UpdateStorageConnectionReq = z.infer<typeof updateStorageConnectionSchema>

export const testStorageConnectionSchema = z.object({
  provider: storageProviderSchema.optional(),
  endpoint: z.string().trim().url('Must be a valid URL').max(1000).optional(),
  username: z.string().trim().max(200).optional(),
  password: z.string().max(500).optional(),
  basePath: z.string().trim().max(1000).optional(),
  region: regionSchema,
  bucket: bucketSchema,
})
export type TestStorageConnectionReq = z.infer<typeof testStorageConnectionSchema>

export const testDirectStorageConnectionSchema = z.object({
  provider: storageProviderSchema.default('webdav'),
  endpoint: z.string().trim().url('Must be a valid URL').max(1000),
  username: z.string().trim().min(1, 'Username is required').max(200),
  password: z.string().max(500).optional(),
  basePath: z.string().trim().max(1000).optional(),
  region: regionSchema,
  bucket: bucketSchema,
}).superRefine(requireS3Bucket)
export type TestDirectStorageConnectionReq = z.infer<typeof testDirectStorageConnectionSchema>
