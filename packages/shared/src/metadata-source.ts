import { z } from 'zod'

import { normalizeBookTitle } from './book-title'

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

export function emptyFileMetadataValues(): MetadataSourceValues {
  return {
    title: null,
    authors: null,
    description: null,
    publisher: null,
    published: null,
    language: null,
    isbn: null,
    subjects: null,
    series: null,
    seriesIndex: null,
  }
}

export function missingFileMetadataProvenance(): MetadataSourceProvenanceMap {
  return {
    title: 'missing',
    authors: 'missing',
    description: 'missing',
    publisher: 'missing',
    published: 'missing',
    language: 'missing',
    isbn: 'missing',
    subjects: 'missing',
    series: 'missing',
    seriesIndex: 'missing',
  }
}

export function applyFilenameMetadataFallback(
  values: MetadataSourceValues,
  provenance: MetadataSourceProvenanceMap,
  fileName: string | null,
  normalizeTitleApplied: boolean,
): void {
  if (!normalizeTitleApplied || !fileName || (values.title && values.authors)) return
  const derived = normalizeBookTitle(fileName)
  if (!values.title && derived.title) {
    values.title = derived.title
    provenance.title = 'filename'
  }
  if (!values.authors) {
    if (derived.authors && derived.authors.length > 0) {
      values.authors = derived.authors
      provenance.authors = 'filename'
    } else if (derived.author) {
      values.authors = [derived.author]
      provenance.authors = 'filename'
    }
  }
}

export function buildTxtFileMetadataSource(
  fileName: string | null,
  normalizeTitleApplied: boolean,
  fallbackRawTitle = false,
): FileMetadataSourceRes {
  const values = emptyFileMetadataValues()
  const provenance = missingFileMetadataProvenance()
  applyFilenameMetadataFallback(values, provenance, fileName, normalizeTitleApplied)
  if (fallbackRawTitle && !normalizeTitleApplied && fileName) {
    const title = fileName.replace(/\.txt$/i, '') || fileName
    if (title) {
      values.title = title
      provenance.title = 'filename'
    }
  }
  return { kind: 'file', format: 'txt', fileName, normalizeTitleApplied, values, provenance }
}
