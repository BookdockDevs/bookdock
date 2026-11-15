import { and, asc, eq } from 'drizzle-orm'

import type { MetadataCandidate, PersonalMetadataCandidate, PersonalMetadataFields, PersonalMetadataSourceView } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { personalMetadataSources } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { fetchThroughHost } from './personal-source-fetch'
import { sourceStoragePrefix, toPersonalSourceView } from './personal-source-install'
import { runPersonalSource } from './personal-source-runtime'

function loadRow(userId: string, sourceId: string) {
  const row = getDb()
    .select()
    .from(personalMetadataSources)
    .where(and(eq(personalMetadataSources.userId, userId), eq(personalMetadataSources.sourceId, sourceId)))
    .get()
  if (!row) throw new AppError('PERSONAL_SOURCE_NOT_FOUND', 'Personal metadata source not found')
  return row
}

export function listPersonalSources(userId: string): PersonalMetadataSourceView[] {
  // Without an explicit order the unique (user_id, source_id) index drives the
  // scan, which lists sources alphabetically instead of by install time.
  return getDb()
    .select()
    .from(personalMetadataSources)
    .where(eq(personalMetadataSources.userId, userId))
    .orderBy(asc(personalMetadataSources.createdAt), asc(personalMetadataSources.sourceId))
    .all()
    .map(toPersonalSourceView)
}

export async function removePersonalSource(userId: string, sourceId: string): Promise<void> {
  const row = loadRow(userId, sourceId)
  getDb().delete(personalMetadataSources).where(eq(personalMetadataSources.id, row.id)).run()
  const storage = getStorage()
  const prefix = sourceStoragePrefix(userId, sourceId)
  await storage.delete(`${prefix}/entry.js`).catch(() => {})
  await storage.delete(`${prefix}/icon`).catch(() => {})
}

export async function getPersonalSourceIcon(userId: string, sourceId: string): Promise<{ data: Buffer; contentType: string }> {
  const row = loadRow(userId, sourceId)
  if (!row.iconType) throw new AppError('PERSONAL_SOURCE_NOT_FOUND', 'Source has no icon')
  const storage = getStorage()
  const key = `${sourceStoragePrefix(userId, sourceId)}/icon`
  if (!(await storage.exists(key))) throw new AppError('PERSONAL_SOURCE_NOT_FOUND', 'Source icon is missing')
  const parts: Buffer[] = []
  for await (const chunk of await storage.get(key)) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  return { data: Buffer.concat(parts), contentType: row.iconType }
}

async function loadEntryText(userId: string, sourceId: string): Promise<string> {
  const storage = getStorage()
  const key = `${sourceStoragePrefix(userId, sourceId)}/entry.js`
  if (!(await storage.exists(key))) throw new AppError('PERSONAL_SOURCE_INVALID_PACKAGE', 'Source entry file is missing')
  const parts: Buffer[] = []
  for await (const chunk of await storage.get(key)) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  return Buffer.concat(parts).toString('utf8')
}

function boundedText(value: string | undefined, max: number): string | undefined {
  const text = value?.trim()
  return text ? text.slice(0, max) : undefined
}

function normalizeTags(value: string[] | undefined): string[] | undefined {
  const tags = (value ?? [])
    .map((tag) => tag.trim().slice(0, 100))
    .filter((tag, index, all) => tag !== '' && all.indexOf(tag) === index)
    .slice(0, 50)
  return tags.length > 0 ? tags : undefined
}

// Sources frequently return protocol-relative ("//cdn/x.jpg") or http cover
// URLs. The browser would resolve a protocol-relative URL against the Bookdock
// origin and the cover proxy rejects it, so personal covers are normalized
// rather than dropped; anything that is still not a public https URL is.
function normalizeCoverUrl(value: string | undefined): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  const upgraded = text.startsWith('//') ? `https:${text}` : text.replace(/^http:\/\//i, 'https://')
  try {
    const url = new URL(upgraded)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
  } catch { return undefined }
  return upgraded
}

// Search values and detail values both flow through here: empty and
// whitespace-only text is dropped, descriptions keep their source whitespace,
// and a missing source URL falls back to the package repository. Every
// optional field the contract exposes has to be copied here, or a search-only
// source loses it before the lookup UI ever sees the candidate.
function adaptCandidate(sourceId: string, fallbackSourceUrl: string | null, candidate: PersonalMetadataCandidate): MetadataCandidate {
  return {
    id: candidate.id.slice(0, 256),
    provider: `personal:${sourceId}`,
    title: candidate.title.slice(0, 500),
    authors: (candidate.authors ?? []).map((author) => author.trim()).filter(Boolean).slice(0, 10),
    description: boundedText(candidate.description, 20_000),
    publisher: boundedText(candidate.publisher, 200),
    published: boundedText(candidate.published, 50),
    isbn: boundedText(candidate.isbn, 20),
    language: boundedText(candidate.language, 20),
    coverUrl: normalizeCoverUrl(candidate.coverUrl),
    sourceUrl: boundedText(candidate.sourceUrl, 2048) ?? fallbackSourceUrl ?? '',
    series: boundedText(candidate.series, 200),
    seriesIndex: boundedText(candidate.seriesIndex, 50),
    category: boundedText(candidate.category, 200),
    tags: normalizeTags(candidate.tags),
  }
}

// Detail values reach the lookup UI without going through adaptCandidate, so
// they get the same bounds; only the search result supplies ids and the source
// URL fallback.
function adaptDetail(fields: PersonalMetadataFields): PersonalMetadataFields {
  return {
    title: boundedText(fields.title, 500),
    authors: (fields.authors ?? []).map((author) => author.trim()).filter(Boolean).slice(0, 10),
    description: boundedText(fields.description, 20_000),
    publisher: boundedText(fields.publisher, 200),
    published: boundedText(fields.published, 50),
    isbn: boundedText(fields.isbn, 20),
    language: boundedText(fields.language, 20),
    coverUrl: normalizeCoverUrl(fields.coverUrl),
    sourceUrl: boundedText(fields.sourceUrl, 2048),
    series: boundedText(fields.series, 200),
    seriesIndex: boundedText(fields.seriesIndex, 50),
    category: boundedText(fields.category, 200),
    tags: normalizeTags(fields.tags),
  }
}

export async function searchPersonalSource(userId: string, sourceId: string, query: string): Promise<MetadataCandidate[]> {
  const row = loadRow(userId, sourceId)
  const entry = await loadEntryText(userId, sourceId)
  const result = await runPersonalSource(entry, 'search', query, { fetch: fetchThroughHost })
  const candidates = result as PersonalMetadataCandidate[]
  return candidates.map((candidate) => adaptCandidate(sourceId, row.repository, candidate))
}

export async function getPersonalSourceDetail(userId: string, sourceId: string, id: string): Promise<PersonalMetadataFields | null> {
  const row = loadRow(userId, sourceId)
  if (!row.hasDetail) return null
  const entry = await loadEntryText(userId, sourceId)
  const result = await runPersonalSource(entry, 'getDetail', id, { fetch: fetchThroughHost })
  return result ? adaptDetail(result as PersonalMetadataFields) : null
}
