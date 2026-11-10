import type { BookMetadata, ClientBookRef, FileMetadataSourceRes } from '@bookdock/shared'
import { bookMetadataSchema, metadataSourceFieldSchema, normalizeBookTitle } from '@bookdock/shared'

import { readStoredSettings } from '@/lib/settings-cache'
import { loadFoliateEngine } from '../reader/content/load-engine'
import { localEpubProvider } from '../reader/content/local-epub-provider'
import { LocalLibraryError, type LocalLibraryRepository } from './repository'

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const object = value as Record<string, unknown>
  if ('name' in object) return text(object.name)
  return Object.values(object).find((item): item is string => typeof item === 'string' && Boolean(item.trim()))?.trim() ?? null
}

function list(value: unknown): string[] | null {
  const values = (Array.isArray(value) ? value : [value]).map(text).filter((item): item is string => item !== null)
  return values.length ? [...new Set(values)] : null
}

export function publicationMetadata(metadata: Record<string, unknown>, fileName: string | null, normalizeTitle = false): FileMetadataSourceRes {
  const seriesValue = (metadata.belongsTo as { series?: unknown } | undefined)?.series
  const series = (Array.isArray(seriesValue) ? seriesValue[0] : seriesValue) as { name?: unknown; position?: unknown } | undefined
  const position = typeof series?.position === 'number' ? series.position : typeof series?.position === 'string' && series.position.trim() ? Number(series.position) : null
  const identifiers = [metadata.identifier, ...[metadata.altIdentifier].flat()]
  const isbn = identifiers.map((value) => {
    if (typeof value === 'string') return /^urn:isbn:/i.test(value) ? value.replace(/^urn:isbn:/i, '').trim() : null
    if (value && typeof value === 'object' && 'scheme' in value && String(value.scheme).toLowerCase() === 'isbn' && 'value' in value) return text(value.value)
    return null
  }).find(Boolean) ?? null
  const languages = list(metadata.language)
  const values: FileMetadataSourceRes['values'] = {
    title: text(metadata.title), authors: list(metadata.author ?? metadata.creator),
    description: text(metadata.description), publisher: text(metadata.publisher), published: text(metadata.published),
    language: languages?.[0] ?? null, isbn, subjects: list(metadata.subject),
    series: text(series?.name), seriesIndex: position !== null && Number.isFinite(position) ? position : null,
  }
  const provenance = Object.fromEntries(metadataSourceFieldSchema.options.map((field) => [field, values[field] === null ? 'missing' : 'file'])) as FileMetadataSourceRes['provenance']
  const normalizeTitleApplied = Boolean(normalizeTitle && fileName)
  if (normalizeTitleApplied && fileName && (!values.title || !values.authors)) {
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
  return { kind: 'file', format: 'epub', fileName, normalizeTitleApplied, values, provenance }
}

export function publicationBookMetadata(metadata: Record<string, unknown>, source: FileMetadataSourceRes): BookMetadata {
  const { title: _title, authors: _authors, ...values } = source.values
  const candidates = { ...values, identifier: text(metadata.identifier), subtitle: text(metadata.subtitle),
    modified: text(metadata.modified), rights: text(metadata.rights), sortAs: text(metadata.sortAs), languages: list(metadata.language) }
  const result: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(candidates)) {
    if (value === null) continue
    const parsed = bookMetadataSchema.safeParse({ [field]: value })
    if (parsed.success) Object.assign(result, parsed.data)
  }
  return bookMetadataSchema.parse(result)
}

export async function readPublicationMetadata(
  repository: LocalLibraryRepository,
  ref: ClientBookRef,
  signal: AbortSignal,
  normalizeTitle = readStoredSettings()?.library?.normalizeTitle !== false,
): Promise<FileMetadataSourceRes> {
  signal.throwIfAborted()
  const book = await repository.getBook(ref)
  if (!book.content) throw new LocalLibraryError('unavailable-content', 'Publication metadata requires available content')
  const file = await repository.getFile(ref, true)
  if (book.format === 'txt') {
    signal.throwIfAborted()
    const fileName = book.textSource?.fileName ?? null
    const normalizeTitleApplied = Boolean(normalizeTitle && fileName)
    const source = publicationMetadata({}, fileName, normalizeTitleApplied)
    if (!normalizeTitleApplied) {
      const title = fileName ? fileName.replace(/\.txt$/i, '') || fileName : null
      return { ...source, format: 'txt', values: { ...source.values, title }, provenance: { ...source.provenance, title: title ? 'filename' : 'missing' } }
    }
    return { ...source, format: 'txt' }
  }
  const lease = await localEpubProvider(`original:${JSON.stringify([ref.scope, ref.bookId, book.content.contentId])}`, file).open(await loadFoliateEngine(), signal)
  try {
    signal.throwIfAborted()
    const source = publicationMetadata(lease.book.metadata ?? {}, 'name' in file && typeof file.name === 'string' ? file.name : null, normalizeTitle)
    const current = await repository.getBook(ref)
    if (current.availability !== 'available' || current.content?.contentId !== book.content.contentId) throw new LocalLibraryError('unavailable-content', 'Publication content changed during extraction')
    signal.throwIfAborted()
    return source
  } finally { lease.release() }
}
