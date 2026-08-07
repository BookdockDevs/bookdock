import { getStorage } from '../storage'
import { mergeInterval, type FractionInterval } from './intervals'

export interface ProgressFileData {
  cfi?: string | null
  chapter?: string | null
  percent: number
  fraction?: number | null
  intervals?: FractionInterval[]
  updatedAt: number
  [key: string]: unknown
}

function progressKey(bookId: string): string {
  return `progress/${bookId}.json`
}

export async function readProgressFile(bookId: string): Promise<ProgressFileData | null> {
  const storage = getStorage()
  const key = progressKey(bookId)
  if (!(await storage.exists(key))) return null
  const stream = await storage.get(key)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as ProgressFileData
}

/**
 * Merge [start,end] into the book's read-interval union without touching the
 * current position. Used by retroactive manual entries — deliberately NOT the
 * PUT /progress path, which also moves cfi/percent/lastReadAt.
 */
export async function mergeProgressInterval(bookId: string, interval: FractionInterval): Promise<void> {
  const [start, end] = interval[0] <= interval[1] ? interval : [interval[1], interval[0]]
  if (end <= start) return
  const existing = await readProgressFile(bookId)
  // Legacy files have no intervals: everything up to the current position
  // counts as read (same assumption as progress.service's upsert)
  const base = existing?.intervals ?? [[0, existing?.fraction ?? 0] as FractionInterval]
  const intervals = mergeInterval(base, [start, end])
  const payload: ProgressFileData = existing
    ? { ...existing, intervals, updatedAt: Date.now() }
    : { cfi: null, chapter: null, percent: 0, fraction: null, intervals, updatedAt: Date.now() }
  await getStorage().put(progressKey(bookId), Buffer.from(JSON.stringify(payload), 'utf-8'))
}
