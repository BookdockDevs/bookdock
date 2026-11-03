import type { ReadingImportScope, ReadingImportSource } from '@bookdock/shared'

import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import type { ImportProposal } from './reading-imports.service'

const PREVIEW_TTL_MS = 10 * 60 * 1000
// Snapshots hold a fully parsed source (a whole library's notes); without caps
// a user could stack unbounded large previews, and expired ones linger until
// the next save. New previews evict the user's oldest, then the global oldest.
const MAX_PREVIEWS_PER_USER = 5
const MAX_PREVIEWS_TOTAL = 100

interface PreviewSnapshot {
  userId: string
  source: ReadingImportSource
  datasetKey: string
  scope: ReadingImportScope
  proposal: ImportProposal
  expiresAt: number
}

const previews = new Map<string, PreviewSnapshot>()

function discardExpired(now: number) {
  for (const [id, preview] of previews) if (preview.expiresAt <= now) previews.delete(id)
}

// An idle server would otherwise keep expired snapshots until the next save
// or read touches this module; one low-frequency sweep releases them. Unref'd
// so it never keeps the process alive on its own.
const SWEEP_INTERVAL_MS = 60_000
const sweepTimer = setInterval(() => discardExpired(Date.now()), SWEEP_INTERVAL_MS)
sweepTimer.unref?.()

export function saveImportPreview(snapshot: Omit<PreviewSnapshot, 'expiresAt'>): string {
  const now = Date.now()
  discardExpired(now)
  const mine: Array<[string, PreviewSnapshot]> = []
  for (const entry of previews) if (entry[1].userId === snapshot.userId) mine.push(entry)
  mine.sort((a, b) => a[1].expiresAt - b[1].expiresAt)
  while (mine.length >= MAX_PREVIEWS_PER_USER) {
    const [id] = mine.shift()!
    previews.delete(id)
  }
  while (previews.size >= MAX_PREVIEWS_TOTAL) {
    const oldest = [...previews.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]
    if (!oldest) break
    previews.delete(oldest[0])
  }
  const id = createId('rip')
  previews.set(id, { ...snapshot, expiresAt: now + PREVIEW_TTL_MS })
  return id
}

export function consumeImportPreview(id: string, userId: string): Omit<PreviewSnapshot, 'expiresAt'> {
  const snapshot = readImportPreview(id, userId)
  previews.delete(id)
  return snapshot
}

/** Like `consumeImportPreview`, but leaves the snapshot in place. An import that
 * reported content conflicts stays replayable: the reader can re-apply the same
 * preview with those records marked for overwrite instead of re-downloading the
 * whole source. Expiry still bounds how long that offer lasts. */
export function readImportPreview(id: string, userId: string): Omit<PreviewSnapshot, 'expiresAt'> {
  const now = Date.now()
  discardExpired(now)
  const preview = previews.get(id)
  if (!preview || preview.userId !== userId) throw new AppError('VALIDATION_ERROR', 'Import preview expired or unavailable')
  const { expiresAt: _expiresAt, ...snapshot } = preview
  return snapshot
}
