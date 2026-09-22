import type { ReadingProgressRes, ReadingProgressUpdateReq } from '@bookdock/shared'

const STORAGE_KEY = 'bd-guest-reading-progress'

type GuestProgressMap = Record<string, ReadingProgressRes>

function readProgressMap(): GuestProgressMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as GuestProgressMap
  } catch {
    return {}
  }
}

function writeProgressMap(progress: GuestProgressMap): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // Local storage can be unavailable or full; reading must still work.
  }
}

export function getGuestProgress(bookId: string): ReadingProgressRes | null {
  return readProgressMap()[bookId] ?? null
}

export function saveGuestProgress(bookId: string, update: ReadingProgressUpdateReq): ReadingProgressRes {
  const previous = getGuestProgress(bookId)
  const next: ReadingProgressRes = {
    id: previous?.id ?? `guest-progress-${bookId}`,
    bookId,
    cfi: update.cfi ?? previous?.cfi ?? null,
    chapter: update.chapter ?? previous?.chapter ?? null,
    chapterIndex: update.chapterIndex ?? previous?.chapterIndex ?? null,
    percent: update.percent,
    fraction: update.fraction ?? previous?.fraction ?? null,
    readFraction: Math.max(previous?.readFraction ?? 0, update.fraction ?? 0),
    rateSamples: update.sample
      ? [...(previous?.rateSamples ?? []), update.sample].slice(-24)
      : previous?.rateSamples,
    updatedAt: Date.now(),
  }
  const progress = readProgressMap()
  progress[bookId] = next
  writeProgressMap(progress)
  return next
}
