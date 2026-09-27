import { and, eq } from 'drizzle-orm'

import { getDb } from '../db/client'
import { libraries, libraryBookVersions } from '../db/schema'
import { getStorage } from '../storage'
import { mergeInterval, type FractionInterval } from './intervals'
import type { RateSample } from '@bookdock/shared'

export interface ProgressFileData {
  cfi?: string | null
  chapter?: string | null
  chapterIndex?: number | null
  percent: number
  fraction?: number | null
  intervals: FractionInterval[]
  /** Reading-speed samples; stored server-side, computed client-side. */
  rateSamples?: RateSample[]
  updatedAt: number
  [key: string]: unknown
}

/**
 * A reading position belongs to a User x BookVersion, not to a book (design
 * invariant 14). It used to be stored as `progress/{bookId}.json` - one slot per
 * book - which was safe only while one person owned one book. The moment a
 * second person could read the same BookVersion through a shared library, that
 * slot became shared state: two readers overwrote each other and each read the
 * other's place. Positions are now filed per user.
 */
function progressKey(userId: string, bookId: string): string {
  return `progress/${userId}/${bookId}.json`
}

/**
 * The pre-0.4.0 layout, kept for reading only. Those files were written when the
 * product was single-user, so a given file can only belong to the one person who
 * owned that book - a second reader of the same version never had a legitimate
 * claim on it. Account deletion still removes them (see users.service), so the
 * fallback cannot outlive the library it came from.
 */
function legacyProgressKey(bookId: string): string {
  return `progress/${bookId}.json`
}

async function readKey(key: string): Promise<ProgressFileData | null> {
  const storage = getStorage()
  if (!(await storage.exists(key))) return null
  const stream = await storage.get(key)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as ProgressFileData
}

/**
 * Reads the caller's own position, migrating a pre-0.4.0 file on first sight.
 * The write happens before the delete so a crash mid-migration keeps the old
 * file rather than losing the position.
 *
 * Ownership rule: a legacy file predates per-user positions and can only
 * belong to the version's sole private owner. Any other reader — a second
 * person opening the same shared version — gets nothing and must not adopt
 * or delete the file; otherwise the second reader inherits the owner's place
 * and destroys it. There is no boot-time sweep (the storage driver cannot
 * list keys), so this lazy check is the migration: first sight by the owner
 * moves the file, everyone else ignores it.
 */
export async function readProgressFile(userId: string, bookId: string): Promise<ProgressFileData | null> {
  const storage = getStorage()
  const current = await readKey(progressKey(userId, bookId))
  if (current) return current
  if (privateOwnerOf(bookId) !== userId) return null
  const legacyKey = legacyProgressKey(bookId)
  const legacy = await readKey(legacyKey)
  if (!legacy) return null
  await storage.put(progressKey(userId, bookId), Buffer.from(JSON.stringify(legacy), 'utf-8'))
  await storage.delete(legacyKey)
  return legacy
}

export async function writeProgressFile(userId: string, bookId: string, data: ProgressFileData): Promise<void> {
  await getStorage().put(progressKey(userId, bookId), Buffer.from(JSON.stringify(data), 'utf-8'))
}

/**
 * Removes a caller's position for a book. A not-yet-migrated legacy file is
 * only removed by the version's private owner — never by a second reader
 * deleting their own card, whose delete must not touch another user's place.
 */
export async function deleteProgressFile(userId: string, bookId: string): Promise<void> {
  const storage = getStorage()
  const key = progressKey(userId, bookId)
  if (await storage.exists(key)) await storage.delete(key)
  if (privateOwnerOf(bookId) !== userId) return
  const legacyKey = legacyProgressKey(bookId)
  if (await storage.exists(legacyKey)) await storage.delete(legacyKey)
}

/**
 * The sole private-library owner of a version, or null when there is none
 * (or, defensively, more than one — legacy keys are per version, so that
 * shape is corrupt and nobody may adopt the file).
 */
function privateOwnerOf(bookId: string): string | null {
  const rows = getDb().select({ userId: libraries.userId }).from(libraryBookVersions)
    .innerJoin(libraries, eq(libraryBookVersions.libraryId, libraries.id))
    .where(and(eq(libraryBookVersions.bookVersionId, bookId), eq(libraries.type, 'private')))
    .all()
  if (rows.length !== 1) return null
  return rows[0].userId
}

/**
 * Merge [start,end] into the read-interval union without touching the current
 * position. Used by retroactive manual entries - deliberately NOT the
 * PUT /progress path, which also moves cfi/percent/lastReadAt.
 */
export async function mergeProgressInterval(userId: string, bookId: string, interval: FractionInterval): Promise<void> {
  const [start, end] = interval[0] <= interval[1] ? interval : [interval[1], interval[0]]
  if (end <= start) return
  const existing = await readProgressFile(userId, bookId)
  const base = existing?.intervals ?? []
  const intervals = mergeInterval(base, [start, end])
  const payload: ProgressFileData = existing
    ? { ...existing, intervals, updatedAt: Date.now() }
    : { cfi: null, chapter: null, percent: 0, fraction: null, intervals, updatedAt: Date.now() }
  await writeProgressFile(userId, bookId, payload)
}
