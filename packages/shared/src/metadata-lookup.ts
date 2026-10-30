import { z } from 'zod'

export const metadataProviderSchema = z.enum(['openlibrary', 'googlebooks', 'qidian', 'bangumi', 'douban', 'weread'])
export type MetadataProvider = z.infer<typeof metadataProviderSchema>
export const weReadSearchScopeSchema = z.enum(['all', 'ebooks'])
export type WeReadSearchScope = z.infer<typeof weReadSearchScopeSchema>

export const metadataSearchSchema = z.object({
  provider: metadataProviderSchema,
  query: z.string().trim().min(1).max(200),
  weReadScope: weReadSearchScopeSchema.optional(),
})
export const metadataDetailSchema = z.discriminatedUnion('provider', [z.object({ provider: z.literal('douban'), id: z.string().regex(/^\d{1,20}$/) }), z.object({ provider: z.literal('weread'), id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) })])

export const metadataConfigUpdateSchema = z.object({ provider: z.enum(['googlebooks', 'weread']), key: z.string().trim().min(1).max(1024).nullable() })
export const metadataConnectionTestSchema = z.object({ provider: z.enum(['googlebooks', 'weread']).default('googlebooks'), key: z.string().trim().min(1).max(1024).optional() })
export const metadataCoverSchema = z.object({ provider: metadataProviderSchema, url: z.string().max(2048) })
export interface MetadataConfiguration {
  googlebooks: boolean
  weread: boolean
  keys?: {
    googlebooks?: string | null
    weread?: string | null
  }
}

export interface MetadataCandidate {
  id: string
  provider: MetadataProvider
  title: string
  authors: string[]
  description?: string
  publisher?: string
  published?: string
  isbn?: string
  language?: string
  coverUrl?: string
  sourceUrl: string
}

export interface MetadataSearchResponse {
  data: MetadataCandidate[]
}
