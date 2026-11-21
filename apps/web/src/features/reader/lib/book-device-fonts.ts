// Per-book device font selections are device-local: a book can pin this
// device's fonts without touching the synced account font ids, and the choice
// never leaves the browser. One localStorage document keyed by book id.

export interface BookDeviceFontSelection {
  primary?: string
  cjk?: string
}

const STORAGE_KEY = 'bd-book-device-fonts'

function readAll(): Record<string, BookDeviceFontSelection> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, BookDeviceFontSelection>
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, BookDeviceFontSelection>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // Storage may be unavailable; the session still works without persistence.
  }
}

export function getBookDeviceFonts(bookId: string): BookDeviceFontSelection | undefined {
  return readAll()[bookId]
}

export function setBookDeviceFonts(bookId: string, selection: BookDeviceFontSelection | null) {
  const all = readAll()
  if (selection && (selection.primary || selection.cjk)) all[bookId] = selection
  else delete all[bookId]
  writeAll(all)
}

export function clearBookDeviceFont(bookId: string, slot: keyof BookDeviceFontSelection) {
  const all = readAll()
  const current = all[bookId]
  if (!current) return
  const next = { ...current }
  delete next[slot]
  setBookDeviceFonts(bookId, next)
}
