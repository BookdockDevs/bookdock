import type { BookListItem, BookMetadata, CatalogVersion, CatalogVersionUpdateReq } from '@bookdock/shared'

import { draftFrom, draftToBookmeta, parseAuthorList, type MetaDraft } from './types'

export type EditableMetadataField = Exclude<keyof MetaDraft, 'coverPaletteId' | 'seriesIndex'>

export function metadataFieldPatch(book: Pick<BookListItem, 'title' | 'author' | 'authors' | 'coverPaletteId'>, bookmeta: BookMetadata | undefined, field: EditableMetadataField, value: string, seriesIndex = '') {
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

export function catalogMetadataFieldPatch(version: CatalogVersion, field: EditableMetadataField, value: string, seriesIndex: string, inherit: boolean): CatalogVersionUpdateReq {
  if (field === 'title') return { title: inherit ? null : value.trim() }
  if (field === 'authors') return { authors: inherit ? null : parseAuthorList(value) }
  if (field === 'description') return { description: inherit ? null : value }
  const parsed = metadataFieldPatch({ title: version.effective.title, author: version.effective.author, authors: version.effective.authors }, {}, field, value, seriesIndex).bookmeta ?? {}
  const meta = { ...version.meta }
  for (const key of field === 'series' ? ['series', 'seriesIndex'] as const : [field]) {
    if (inherit) delete meta[key]
    else meta[key] = parsed[key] ?? null
  }
  return { meta }
}
