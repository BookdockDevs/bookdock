import type { ArchiveSearch } from '@/routes/archive'

export interface ArchiveScrollPositions {
  left: number
  main: number
  win: number
}

interface ArchiveScrollRecord {
  key: string
  positions: ArchiveScrollPositions
}

const STORAGE_KEY = 'bd-archive-scroll'

/**
 * Stable identity of one archive view: same key means the same list and the
 * same scrolled content, so a saved position still applies.
 */
export function archiveScrollKey(search: ArchiveSearch): string {
  return JSON.stringify([
    search.tab ?? null,
    search.view ?? null,
    search.bookId ?? null,
    search.from ?? null,
    search.bookType ?? null,
    search.bookSort ?? null,
    search.q ?? null,
    search.type ?? null,
    search.sort ?? null,
    search.page ?? null,
  ])
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function readRecord(): ArchiveScrollRecord | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ArchiveScrollRecord>
    if (typeof parsed.key !== 'string') return null
    const positions = parsed.positions
    if (!positions || typeof positions.left !== 'number' || typeof positions.main !== 'number' || typeof positions.win !== 'number') {
      return null
    }
    return { key: parsed.key, positions: { left: positions.left, main: positions.main, win: positions.win } }
  } catch {
    return null
  }
}

/**
 * Remember where an archive view was scrolled to. Written when leaving the
 * archive (any destination); session storage keeps it tab-local so direct
 * opens, copied links and new tabs never inherit it, while a same-tab
 * refresh keeps it.
 */
export function saveArchiveScrollRecord(key: string, positions: ArchiveScrollPositions): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ key, positions }))
  } catch {
    // Private-mode quotas and similar: positions are a nicety, never load-bearing.
  }
}

/**
 * Take the saved positions for this exact view, if any. Consumed on use so
 * a later visit to the same URL starts fresh instead of jumping stale.
 */
export function takeArchiveScrollRecord(key: string): ArchiveScrollPositions | null {
  const record = readRecord()
  if (!record || record.key !== key) return null
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    // Ignore: the next take re-checks the key before applying anything.
  }
  return record.positions
}

export interface ScrollRestoreTask {
  read: () => number
  apply: (top: number) => void
  target: number
}

const animationFrame: (callback: () => void) => void =
  typeof requestAnimationFrame !== 'undefined'
    ? (callback) => { requestAnimationFrame(() => callback()) }
    : (callback) => { setTimeout(callback, 16) }

/**
 * Apply a saved scroll position, retrying while it does not stick.
 * A single apply clamps when the destination still shows its loading
 * state, so keep re-applying up to the frame budget: a static height is
 * NOT treated as settled, because skeletons wait on the network at a
 * constant height and giving up early strands the position. Later shifts
 * past the budget (e.g. images) are out of scope.
 */
export function restoreScrollWithRetry(
  task: ScrollRestoreTask,
  schedule: (callback: () => void) => void = animationFrame,
  maxFrames = 240,
): () => void {
  if (!(task.target > 0)) return () => {}
  let frames = 0
  let cancelled = false
  const step = () => {
    if (cancelled) return
    frames += 1
    task.apply(task.target)
    if (task.read() >= task.target - 1) return
    if (frames >= maxFrames) return
    schedule(step)
  }
  step()
  // Callers cancel on unmount: a retry loop must never keep applying (in
  // particular window.scrollTo) after its page is gone.
  return () => {
    cancelled = true
  }
}
