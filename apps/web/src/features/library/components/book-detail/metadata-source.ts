import type { BookMetadataSourceRes, FileMetadataSourceRes, MetadataSourceValues } from '@bookdock/shared'

import { parseAuthorList, type MetaDraft } from './types'

export type DraftTextField = 'title' | 'authors' | 'publisher' | 'published' | 'isbn' | 'language' | 'subjects' | 'series' | 'seriesIndex' | 'description'

export const PRIVATE_ALL_TEXT_FIELDS: DraftTextField[] = [
  'title', 'authors', 'description', 'publisher', 'published', 'language', 'isbn', 'subjects', 'series', 'seriesIndex',
]

export const PRIVATE_B_TEXT_FIELDS: DraftTextField[] = ['title', 'authors']

export const CATALOG_VERSION_TEXT_FIELDS: DraftTextField[] = [
  'title', 'authors', 'description', 'publisher', 'published', 'language', 'isbn', 'subjects', 'series', 'seriesIndex',
]

export function sourceTextForField(field: DraftTextField, values: Partial<MetadataSourceValues>): string {
  switch (field) {
    case 'title': return typeof values.title === 'string' ? values.title : ''
    case 'authors': return Array.isArray(values.authors) ? values.authors.join('、') : ''
    case 'description': return typeof values.description === 'string' ? values.description : ''
    case 'publisher': return typeof values.publisher === 'string' ? values.publisher : ''
    case 'published': return typeof values.published === 'string' ? values.published : ''
    case 'isbn': return typeof values.isbn === 'string' ? values.isbn : ''
    case 'language': return typeof values.language === 'string' ? values.language : ''
    case 'subjects': return Array.isArray(values.subjects) ? values.subjects.join(', ') : ''
    case 'series': return typeof values.series === 'string' ? values.series : ''
    case 'seriesIndex': return typeof values.seriesIndex === 'number' && Number.isFinite(values.seriesIndex) ? String(values.seriesIndex) : ''
  }
}

export function sourceHasValue(field: DraftTextField, values: Partial<MetadataSourceValues>): boolean {
  switch (field) {
    case 'title': return typeof values.title === 'string' && values.title.trim().length > 0
    case 'authors': return Array.isArray(values.authors) && values.authors.some((a) => a.trim().length > 0)
    case 'description': return typeof values.description === 'string' && values.description.trim().length > 0
    case 'publisher': return typeof values.publisher === 'string' && values.publisher.trim().length > 0
    case 'published': return typeof values.published === 'string' && values.published.trim().length > 0
    case 'isbn': return typeof values.isbn === 'string' && values.isbn.trim().length > 0
    case 'language': return typeof values.language === 'string' && values.language.trim().length > 0
    case 'subjects': return Array.isArray(values.subjects) && values.subjects.some((s) => s.trim().length > 0)
    case 'series': return typeof values.series === 'string' && values.series.trim().length > 0
    case 'seriesIndex': return typeof values.seriesIndex === 'number' && Number.isFinite(values.seriesIndex)
  }
}

function normalizeListText(text: string): string[] {
  return text.split(/[,，、；;]/).map((s) => s.trim()).filter(Boolean)
}

export function draftFieldDiffers(field: DraftTextField, draftValue: string, values: Partial<MetadataSourceValues>): boolean {
  const sourceText = sourceTextForField(field, values)
  if (field === 'authors') {
    const a = parseAuthorList(draftValue).map((s) => s.trim()).filter(Boolean)
    const b = parseAuthorList(sourceText).map((s) => s.trim()).filter(Boolean)
    if (a.length !== b.length) return true
    return a.some((v, i) => v !== b[i])
  }
  if (field === 'subjects') {
    const a = normalizeListText(draftValue)
    const b = normalizeListText(sourceText)
    if (a.length !== b.length) return true
    return a.some((v, i) => v !== b[i])
  }
  if (field === 'seriesIndex') {
    const a = draftValue.trim()
    if (a === '' && sourceText === '') return false
    const an = a === '' ? NaN : Number(a)
    const bn = sourceText === '' ? NaN : Number(sourceText)
    if (Number.isNaN(an) || Number.isNaN(bn)) return a !== sourceText
    return an !== bn
  }
  if (field === 'description') return draftValue !== sourceText
  return draftValue.trim() !== sourceText.trim()
}

export function canRestoreField(field: DraftTextField, draftValue: string, source: BookMetadataSourceRes | null | undefined): boolean {
  if (!source) return false
  const values = source.values as Partial<MetadataSourceValues>
  if (!sourceHasValue(field, values)) return false
  return draftFieldDiffers(field, draftValue, values)
}

export function applySourceFieldToDraft(draft: MetaDraft, field: DraftTextField, source: BookMetadataSourceRes): MetaDraft {
  return { ...draft, [field]: sourceTextForField(field, source.values as Partial<MetadataSourceValues>) }
}

export function applySourceAllToDraft(draft: MetaDraft, source: BookMetadataSourceRes, fields: DraftTextField[]): MetaDraft {
  const next = { ...draft }
  const values = source.values as Partial<MetadataSourceValues>
  for (const field of fields) {
    const has = Object.prototype.hasOwnProperty.call(values, field)
    if (!has) continue
    const v = (values as Record<string, unknown>)[field]
    if (v === null || v === undefined) {
      next[field] = ''
    } else {
      next[field] = sourceTextForField(field, values)
    }
  }
  return next
}

export function sourceProvenanceLabel(
  source: BookMetadataSourceRes | null | undefined,
  field: DraftTextField,
): 'file' | 'filename' | 'shared' | null {
  if (!source) return null
  if (source.kind === 'shared') return 'shared'
  const file = source as FileMetadataSourceRes
  const p = (file.provenance as Record<string, string> | undefined)?.[field]
  if (p === 'file' || p === 'filename' || p === 'shared') return p
  return null
}
