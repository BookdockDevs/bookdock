import type { ExternalUploadRes } from '@bookdock/shared'

import { t } from './i18n'

export const CHUNK_BYTES = 256 * 1024
export const JOB_LIFETIME_MS = 24 * 60 * 60 * 1000
export const TRANSFER_TIMEOUT_MS = 2 * 60 * 1000
export const LEASE_MS = 120_000

export interface Connection {
  id: string
  baseUrl: string
  token: string
  userId: string
  username: string
  uploadMaxBytes: number
  enabled: boolean
  autoOpen?: boolean
}

export interface UploadJob {
  id: string
  batchId: string
  order?: number
  name: string
  size: number
  connectionId: string
  sourceTabId: number | null
  sourceFrameId: number
  createdAt: number
  updatedAt: number
  received: number
  chunkCount: number
  state: 'receiving' | 'pending' | 'ready' | 'uploading' | 'failed' | 'success' | 'duplicate'
  autoStart?: boolean
  result?: UploadResult
  batchNotices?: { ignored: number; oversized: number }
  lease?: string
  leaseUntil?: number
  error?: string
  /**
   * Set to false when the failure is about the file itself (too large, wrong
   * format), so the row stops offering a retry that must fail identically.
   * Absent means "unknown", which is treated as retryable.
   */
  retryable?: boolean
}

export interface Chunk {
  jobId: string
  index: number
  blob: Blob
}

export interface DropStatus {
  connected: boolean
  enabled: boolean
  uploadMaxBytes: number
  instanceOrigin?: string
}

export type DropRequest =
  | { type: 'bookdock:status' }
  | { type: 'bookdock:start-batch'; files: { name: string; size: number }[]; ignored: number; oversized: number }
  | { type: 'bookdock:chunk'; id: string; index: number; data: string }
  | { type: 'bookdock:finish'; id: string }
  | { type: 'bookdock:refresh' }

export type Reply<T> = { data: T; error?: never } | { data?: never; error: string }

export type UploadResult = ExternalUploadRes

export function normalizeInstanceUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error(t('error.urlInvalid')) }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error(t('error.urlInvalid'))
  }
  if (url.pathname !== '/') throw new Error(t('error.urlInvalid'))
  return url.origin
}

export function supportedFile(name: string): boolean {
  return /\.(epub|txt)$/i.test(name)
}

/**
 * Whether a failed job can honestly be retried.
 *
 * A retry re-sends the bytes that were banked while the file was dropped, never
 * the file on disk: the original `File` belongs to the page that received the
 * drop and is gone by the time the row turns red. So when a transfer dies
 * halfway there is nothing to resume from, and a retry can only repeat
 * `transferLost` - which is what the button used to do, in a few milliseconds,
 * with the message unchanged. Only a fully received file has something to send.
 *
 * A changed connection is equally terminal: the job is pinned to the instance
 * (and account) it was dropped for, and claimJob refuses the mismatch.
 */
export function canRetry(job: UploadJob, connectionId?: string): boolean {
  if (job.retryable === false) return false
  if (job.received <= 0 || job.received !== job.size || job.chunkCount <= 0) return false
  return !connectionId || job.connectionId === connectionId
}

export function validateFile(name: string, size: number, maxBytes: number): void {
  if (!supportedFile(name)) throw new Error(t('error.fileUnsupported'))
  if (!name || name.length > 1024 || !Number.isSafeInteger(size) || size <= 0) throw new Error(t('error.fileUnsupported'))
  if (size > maxBytes) throw new Error(t('error.fileTooLarge', { size: formatBytes(maxBytes) }))
}

/** Same output as the Web's `formatBytes`: one decimal, trailing `.0` trimmed (`100 MB`, not `100.0 MB`). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${parseFloat(value.toFixed(1))} ${units[unit]}`
}

export function readerUrl(connection: Pick<Connection, 'baseUrl' | 'userId'>, result: Pick<UploadResult, 'bookVersionId'>): string {
  if (!/^[\w-]{1,128}$/.test(result.bookVersionId)) throw new Error(t('error.generic'))
  const url = new URL(`/books/${encodeURIComponent(result.bookVersionId)}`, connection.baseUrl)
  url.searchParams.set('account', connection.userId)
  return url.href
}
