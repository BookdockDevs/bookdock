import { z } from 'zod'

export const metadataSourceFieldSchema = z.enum([
  'title',
  'authors',
  'description',
  'publisher',
  'published',
  'language',
  'isbn',
  'subjects',
  'series',
  'seriesIndex',
])
export type MetadataSourceField = z.infer<typeof metadataSourceFieldSchema>

export const metadataSourceProvenanceSchema = z.enum(['file', 'filename', 'shared', 'missing'])
export type MetadataSourceProvenance = z.infer<typeof metadataSourceProvenanceSchema>

export interface MetadataSourceValues {
  title: string | null
  authors: string[] | null
  description: string | null
  publisher: string | null
  published: string | null
  language: string | null
  isbn: string | null
  subjects: string[] | null
  series: string | null
  seriesIndex: number | null
}

export type MetadataSourceProvenanceMap = Record<keyof MetadataSourceValues, MetadataSourceProvenance>

export interface FileMetadataSourceRes {
  kind: 'file'
  format: 'epub' | 'txt'
  fileName: string | null
  normalizeTitleApplied: boolean
  values: MetadataSourceValues
  provenance: MetadataSourceProvenanceMap
}

export interface SharedMetadataSourceRes {
  kind: 'shared'
  sourceLibraryId: string
  sourceLibraryBookVersionId: string
  bookVersionId: string
  values: Pick<MetadataSourceValues, 'title' | 'authors'>
  provenance: Pick<MetadataSourceProvenanceMap, 'title' | 'authors'>
}

export type BookMetadataSourceRes = FileMetadataSourceRes | SharedMetadataSourceRes

export type CatalogVersionMetadataSourceRes = FileMetadataSourceRes

export const metadataSourceValuesSchema: z.ZodType<MetadataSourceValues> = z.object({
  title: z.string().nullable(),
  authors: z.array(z.string()).nullable(),
  description: z.string().nullable(),
  publisher: z.string().nullable(),
  published: z.string().nullable(),
  language: z.string().nullable(),
  isbn: z.string().nullable(),
  subjects: z.array(z.string()).nullable(),
  series: z.string().nullable(),
  seriesIndex: z.number().nullable(),
})
