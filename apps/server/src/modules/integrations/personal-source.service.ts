import { and, eq } from 'drizzle-orm'

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
  return getDb()
    .select()
    .from(personalMetadataSources)
    .where(eq(personalMetadataSources.userId, userId))
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

// Search values and detail values both flow through here: empty and
// whitespace-only text is dropped, descriptions keep their source whitespace,
// and a missing source URL falls back to the package repository.
function adaptCandidate(sourceId: string, fallbackSourceUrl: string | null, candidate: PersonalMetadataCandidate): MetadataCandidate {
  const bounded = (value: string | undefined, max: number): string | undefined => {
    const text = value?.trim()
    return text ? text.slice(0, max) : undefined
  }
  const coverUrl = bounded(candidate.coverUrl, 2048)
  return {
    id: candidate.id.slice(0, 256),
    provider: `personal:${sourceId}`,
    title: candidate.title.slice(0, 500),
    authors: (candidate.authors ?? []).map((author) => author.trim()).filter(Boolean).slice(0, 10),
    description: bounded(candidate.description, 20_000),
    publisher: bounded(candidate.publisher, 200),
    published: bounded(candidate.published, 50),
    isbn: bounded(candidate.isbn, 20),
    language: bounded(candidate.language, 20),
    coverUrl: coverUrl?.startsWith('https://') ? coverUrl : undefined,
    sourceUrl: bounded(candidate.sourceUrl, 2048) ?? fallbackSourceUrl ?? '',
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
  return result as PersonalMetadataFields | null
}
