import { z } from 'zod'

export const CONTENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const CONTENT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const CONTENT_FILES_MAX_COUNT = 20
export const CONTENT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export const contentFileIdSchema = z.string().regex(/^cfile_[A-Za-z0-9_-]{21}$/)
export const contentDraftIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/)
export const contentFileUploadSchema = z.object({
  domain: z.enum(['review', 'idea']),
  kind: z.enum(['image', 'attachment']),
  draftId: contentDraftIdSchema,
  bookVersionId: z.string().min(1).max(128),
  targetId: z.string().min(1).max(128).optional(),
}).strict().refine((value) => value.domain === 'review' || value.kind === 'image', { message: 'Ideas accept images only' })

export type ContentFileUpload = z.infer<typeof contentFileUploadSchema>
export type ContentFileDomain = ContentFileUpload['domain']
export interface ContentFile {
  id: string
  kind: 'image' | 'attachment'
  name: string
  mimeType: string
  size: number
  url: string
}

export const contentFileAssociationSchema = z.object({
  draftId: contentDraftIdSchema.optional(),
  imageIds: z.array(contentFileIdSchema).max(CONTENT_FILES_MAX_COUNT).optional(),
})

export function contentFileUrl(id: string): string {
  return `/api/v1/content-files/${id}`
}

export function contentFileIdFromUrl(url: string): string | null {
  const prefix = '/api/v1/content-files/'
  if (!url.startsWith(prefix)) return null
  const id = url.slice(prefix.length)
  return contentFileIdSchema.safeParse(id).success ? id : null
}
