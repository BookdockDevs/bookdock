import { z } from 'zod'

const packagePath = z.string().min(1).max(512).refine((value) => {
  return !value.startsWith('/') && !value.includes('\\') && !value.includes(':') && !value.includes('\0') && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}, 'Expected a relative package path')

export const personalMetadataSourceManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  name: z.string().trim().min(1).max(200),
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/).max(100),
  apiVersion: z.literal(1),
  entry: packagePath,
  icon: packagePath.optional(),
  repository: z.string().url().max(2048).optional(),
  description: z.string().max(2000).optional(),
  author: z.string().max(200).optional(),
})

const optionalText = z.string().optional()

export const personalMetadataFieldsSchema = z.object({
  title: z.string().trim().min(1).optional(),
  authors: z.array(z.string()).optional(),
  description: optionalText,
  publisher: optionalText,
  published: optionalText,
  isbn: optionalText,
  language: optionalText,
  coverUrl: optionalText,
  sourceUrl: optionalText,
})

export const personalMetadataCandidateSchema = personalMetadataFieldsSchema.extend({
  id: z.string().min(1),
  title: z.string().trim().min(1),
})

export type PersonalMetadataSourceManifest = z.infer<typeof personalMetadataSourceManifestSchema>
export type PersonalMetadataFields = z.infer<typeof personalMetadataFieldsSchema>
export type PersonalMetadataCandidate = z.infer<typeof personalMetadataCandidateSchema>

export const personalSourceGitHubInstallSchema = z.object({ url: z.string().trim().min(1).max(2048) })

export interface PersonalMetadataSourceView {
  sourceId: string
  name: string
  version: string
  description?: string
  author?: string
  repository?: string
  originType: 'github' | 'zip'
  originRef?: string
  gitRef?: string
  gitCommit?: string
  hasIcon: boolean
  hasDetail: boolean
  createdAt: number
}
