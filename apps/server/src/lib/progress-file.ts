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

async function readKey(key: string): Promise<ProgressFileData | null> {
  const storage = getStorage()
  if (!(await storage.exists(key))) return null
  const stream = await storage.get(key)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as ProgressFileData
}

export async function readProgressFile(userId: string, bookId: string): Promise<ProgressFileData | null> {
  return readKey(progressKey(userId, bookId))
}

export async function writeProgressFile(userId: string, bookId: string, data: ProgressFileData): Promise<void> {
  await getStorage().put(progressKey(userId, bookId), Buffer.from(JSON.stringify(data), 'utf-8'))
}

export async function deleteProgressFile(userId: string, bookId: string): Promise<void> {
  const storage = getStorage()
  const key = progressKey(userId, bookId)
  if (await storage.exists(key)) await storage.delete(key)
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
