import type { ClientLibraryBookView, BookMetadata, CatalogVersion, CatalogVersionUpdateReq } from '@bookdock/shared'

import { draftFrom, draftToBookmeta, parseAuthorList, type MetaDraft } from './types'

export type EditableMetadataField = Exclude<keyof MetaDraft, 'coverPaletteId' | 'seriesIndex'>

export function metadataFieldPatch(book: Pick<ClientLibraryBookView, 'title' | 'author' | 'authors' | 'coverPaletteId'>, bookmeta: BookMetadata | undefined, field: EditableMetadataField, value: string, seriesIndex = '') {
  if (field === 'title') return { title: value.trim() }
  if (field === 'authors') {
    const authors = parseAuthorList(value)
    return { authors, author: authors[0] ?? '' }
  }

  const draft = { ...draftFrom(book, bookmeta), [field]: value, seriesIndex }
  const edited = draftToBookmeta(draft)
  const metadata: BookMetadata = { ...bookmeta }
  delete metadata[field]
  Object.assign(metadata, field in edited ? { [field]: edited[field] } : {})
  if (field === 'series') {
    delete metadata.seriesIndex
    if (seriesIndex.trim()) metadata.seriesIndex = Number(seriesIndex)
  }
  return { bookmeta: metadata }
}

/** A shared catalog version owns its own values: clearing a publication field
 * writes an explicit null mask rather than falling back onto the work row,
 * which is only a projection of the default version. Unrelated meta keys ride
 * along so a single-field edit never drops what the editor cannot show. */
export function catalogMetadataFieldPatch(version: CatalogVersion, field: EditableMetadataField, value: string, seriesIndex: string): CatalogVersionUpdateReq {
  if (field === 'title') return { title: value.trim() }
  if (field === 'authors') return { authors: parseAuthorList(value) }
  if (field === 'description') return { description: value }
  const parsed = metadataFieldPatch({ title: version.effective.title, author: version.effective.author, authors: version.effective.authors }, {}, field, value, seriesIndex).bookmeta ?? {}
  const meta = { ...version.meta }
  for (const key of field === 'series' ? ['series', 'seriesIndex'] as const : [field]) {
    meta[key] = parsed[key] ?? null
  }
  return { meta }
}
