import { z } from 'zod'

export const DICTIONARY_MAX_FILES = 12
export const DICTIONARY_MAX_UPLOAD_BYTES = 256 * 1024 * 1024
export type DictionaryScope = 'user' | 'instance'

export const dictionaryLookupSchema = z.object({ word: z.string().trim().min(1).max(100) }).strict()
export const dictionaryUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  scope: z.enum(['user', 'instance']).optional(),
}).strict().refine((data) => data.enabled !== undefined || data.name !== undefined || data.scope !== undefined, {
  message: 'At least one field must be provided',
})
export type DictionaryUpdateReq = z.infer<typeof dictionaryUpdateSchema>

// The service validates that `ids` exactly matches the user's current list,
// so no separate count cap is needed here.
export const dictionaryOrderSchema = z.object({ ids: z.array(z.string().min(1).max(100)) }).strict()

export interface DictionaryItem {
  id: string
  name: string
  fileNames: string[]
  size: number
  enabled: boolean
  createdAt: number
  scope: DictionaryScope
  mine: boolean
}

export interface DictionaryList { items: DictionaryItem[]; lastUsedId: string | null }
export interface DictionaryLookupResult { query: string; headword: string | null; html: string }
