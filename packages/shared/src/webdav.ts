import { z } from 'zod'

export interface WebDavConfig {
  url: string
  username: string
  encryptedPassword?: string
  basePath: string
}

export interface WebDavConfigRes {
  configured: boolean
  url: string
  username: string
  basePath: string
  hasPassword: boolean
}

export interface WebDavEntry {
  name: string
  path: string
  type: 'dir' | 'file'
  size: number
  updatedAt?: number
  isSupported: boolean
}

export interface WebDavImportItemResult {
  path: string
  name: string
  status: 'success' | 'duplicate' | 'error'
  bookId?: string
  correspondingBookId?: string
  errorMessage?: string
}

export interface WebDavImportRes {
  results: WebDavImportItemResult[]
  total: number
  successCount: number
  duplicateCount: number
  errorCount: number
}

export const webdavConfigUpdateSchema = z.object({
  url: z.string().url().max(1000),
  username: z.string().max(200),
  password: z.string().max(500).optional(),
  basePath: z.string().max(1000).optional(),
})
export type WebDavConfigUpdateReq = z.infer<typeof webdavConfigUpdateSchema>

export const webdavTestReqSchema = z.object({
  url: z.string().url().max(1000).optional(),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  basePath: z.string().max(1000).optional(),
})
export type WebDavTestReq = z.infer<typeof webdavTestReqSchema>

export const webdavLsReqSchema = z.object({
  path: z.string().max(1000).default('/'),
})
export type WebDavLsReq = z.infer<typeof webdavLsReqSchema>

export const webdavImportReqSchema = z.object({
  files: z.array(z.string().min(1).max(1000)).min(1).max(100),
  libraryId: z.string().optional(),
  shelfId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
})
export type WebDavImportReq = z.infer<typeof webdavImportReqSchema>
