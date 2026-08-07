import { create } from 'zustand'

import { apiPost, apiPut } from '@/api/client'
import { READING_RECORDS_KEY, READING_SESSIONS_KEY, localDateString } from '@/api/hooks/reading-records'
import { queryClient } from '@/lib/query-client'
import { useUiStore } from '@/stores/ui.store'

/**
 * Manual reading timer (manual-reading-timer.md): the user controls the
 * session boundary with the pill instead of the auto heuristics. Sessions are
 * keyed by bookId and survive Reader unmounts (book switch) so a session keeps
 * its grace countdown and can be resumed on re-entry.
 *
 * Lifecycle:
 * - start(): capture start position, phase=running
 * - pause()/resume(): user-controlled stop/continue (time freezes)
 * - suspend(): leaving the page/reader — grace countdown starts; on expiry the
 *   session terminates with the last known position
 * - terminate(): writes the interval (progress PUT) + the exact session bounds
 *   (records POST with endedAt/startCfi/endCfi), then clears the session
 * - pagehide terminates immediately so a closed tab never loses the session
 */
export type ManualTimerPhase = 'idle' | 'running' | 'paused' | 'suspended'

export interface ManualSession {
  bookId: string
  phase: 'running' | 'paused' | 'suspended'
  /** Session start (unixtime ms) — the accounting origin for date + startedAt */
  startedAt: number
  /** Time counted so far, excluding the current running stretch */
  elapsedMs: number
  /** When the current running stretch started (phase=running only) */
  lastResumeAt: number | null
  /** When the session entered suspension (grace countdown base) */
  suspendedAt: number | null
  startCfi: string | null
  startFraction: number | null
  startChapterIndex: number | null
  /** Latest known position — the end point of the session when it terminates */
  lastCfi: string | null
  lastFraction: number | null
  lastChapterIndex: number | null
}

export interface ManualTimerSummary {
  bookId: string
  durationSeconds: number
}

interface ManualTimerStore {
  sessions: Record<string, ManualSession>
  now: number
  lastSummary: ManualTimerSummary | null
  start: (bookId: string, pos: { cfi: string | null; fraction: number | null; chapterIndex?: number | null }) => void
  pause: (bookId: string) => void
  resume: (bookId: string) => void
  suspend: (bookId: string) => void
  terminate: (bookId: string) => void
  discard: (bookId: string) => void
  updatePosition: (bookId: string, pos: { cfi: string | null; fraction: number | null; chapterIndex?: number | null }) => void
  tick: (now: number) => void
  clearSummary: () => void
}

export function sessionDurationMs(session: ManualSession, now: number): number {
  const running = session.phase === 'running' && session.lastResumeAt !== null
    ? now - session.lastResumeAt
    : 0
  return session.elapsedMs + Math.max(0, running)
}

export function graceLeftMs(session: ManualSession, now: number): number {
  if (session.phase !== 'suspended' || session.suspendedAt === null) return 0
  const graceMs = useUiStore.getState().manualTimerGraceMinutes * 60_000
  return Math.max(0, session.suspendedAt + graceMs - now)
}

async function writeTermination(session: ManualSession) {
  const now = Date.now()
  const durationSeconds = Math.max(1, Math.round(sessionDurationMs(session, now) / 1000))
  const endFraction = session.lastFraction ?? session.startFraction
  const endCfi = session.lastCfi
  const date = localDateString(new Date(session.startedAt))
  if (session.startFraction !== null) {
    await apiPut(`/progress/${session.bookId}`, {
      percent: Number(((endFraction ?? 0) * 100).toFixed(2)),
      fraction: endFraction ?? 0,
      segmentStartFraction: session.startFraction,
      ...(endCfi ? { cfi: endCfi } : {}),
    }).catch(() => undefined)
  }
  await apiPost('/reading-records', {
    bookId: session.bookId,
    date,
    durationSeconds,
    startedAt: session.startedAt,
    endedAt: now,
    ...(session.startCfi ? { startCfi: session.startCfi } : {}),
    ...(endCfi ? { endCfi } : {}),
    ...(session.startFraction !== null ? { startFraction: session.startFraction } : {}),
    // endFraction is independent of startFraction: a session started before
    // any relocate (e.g. immediately after mount) still ends with a position
    ...(endFraction !== null ? { endFraction } : {}),
    ...(session.startChapterIndex !== null ? { startChapterIndex: session.startChapterIndex } : {}),
    ...(session.lastChapterIndex !== null ? { endChapterIndex: session.lastChapterIndex } : {}),
  }).catch(() => undefined)
  queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
  queryClient.invalidateQueries({ queryKey: READING_SESSIONS_KEY })
  queryClient.invalidateQueries({ queryKey: ['progress', session.bookId], refetchType: 'none' })
}

let ticker: ReturnType<typeof setInterval> | null = null

function ensureTicker() {
  if (ticker !== null) return
  ticker = setInterval(() => {
    useManualTimerStore.getState().tick(Date.now())
  }, 1000)
}

function stopTickerIfIdle() {
  if (ticker !== null && Object.keys(useManualTimerStore.getState().sessions).length === 0) {
    clearInterval(ticker)
    ticker = null
  }
}

/** Test hook: drop the module-level ticker so fake-timer suites start clean */
export function resetManualTimerTicker() {
  if (ticker !== null) {
    clearInterval(ticker)
    ticker = null
  }
}

export const useManualTimerStore = create<ManualTimerStore>((set, get) => ({
  sessions: {},
  now: Date.now(),
  lastSummary: null,

  start: (bookId, pos) => {
    if (get().sessions[bookId]) return
    const now = Date.now()
    set((s) => ({
      sessions: {
        ...s.sessions,
        [bookId]: {
          bookId,
          phase: 'running',
          startedAt: now,
          elapsedMs: 0,
          lastResumeAt: now,
          suspendedAt: null,
          startCfi: pos.cfi,
          startFraction: pos.fraction,
          startChapterIndex: pos.chapterIndex ?? null,
          lastCfi: pos.cfi,
          lastFraction: pos.fraction,
          lastChapterIndex: pos.chapterIndex ?? null,
        },
      },
    }))
    ensureTicker()
  },

  pause: (bookId) => {
    const session = get().sessions[bookId]
    if (!session || session.phase !== 'running' || session.lastResumeAt === null) return
    const lastResumeAt = session.lastResumeAt
    set((s) => ({
      sessions: {
        ...s.sessions,
        [bookId]: {
          ...session,
          phase: 'paused',
          elapsedMs: session.elapsedMs + (Date.now() - lastResumeAt),
          lastResumeAt: null,
        },
      },
    }))
  },

  resume: (bookId) => {
    const session = get().sessions[bookId]
    if (!session || session.phase === 'running') return
    const now = Date.now()
    set((s) => ({
      sessions: {
        ...s.sessions,
        [bookId]: {
          ...session,
          phase: 'running',
          lastResumeAt: now,
          suspendedAt: null,
        },
      },
    }))
  },

  suspend: (bookId) => {
    const session = get().sessions[bookId]
    if (!session || session.phase !== 'running' || session.lastResumeAt === null) return
    const lastResumeAt = session.lastResumeAt
    const now = Date.now()
    set((s) => ({
      sessions: {
        ...s.sessions,
        [bookId]: {
          ...session,
          phase: 'suspended',
          elapsedMs: session.elapsedMs + (now - lastResumeAt),
          lastResumeAt: null,
          suspendedAt: now,
        },
      },
    }))
  },

  terminate: (bookId) => {
    const session = get().sessions[bookId]
    if (!session) return
    set((s) => {
      const { [bookId]: _gone, ...rest } = s.sessions
      return { sessions: rest, lastSummary: { bookId, durationSeconds: Math.max(1, Math.round(sessionDurationMs(session, Date.now()) / 1000)) } }
    })
    void writeTermination(session)
    stopTickerIfIdle()
  },

  // Long-press discard (Pill v2): drops the session with no network writes —
  // fully isolated from terminate()'s writeTermination path
  discard: (bookId) => {
    if (!get().sessions[bookId]) return
    set((s) => {
      const { [bookId]: _gone, ...rest } = s.sessions
      return { sessions: rest }
    })
    stopTickerIfIdle()
  },

  updatePosition: (bookId, pos) => {
    const session = get().sessions[bookId]
    if (!session) return
    if (pos.cfi === session.lastCfi && pos.fraction === session.lastFraction) return
    set((s) => ({
      sessions: {
        ...s.sessions,
        [bookId]: {
          ...session,
          lastCfi: pos.cfi,
          lastFraction: pos.fraction,
          lastChapterIndex: pos.chapterIndex ?? session.lastChapterIndex,
        },
      },
    }))
  },

  tick: (now) => {
    const { sessions } = get()
    let expired: string | null = null
    for (const session of Object.values(sessions)) {
      if (session.phase === 'suspended' && graceLeftMs(session, now) === 0) {
        expired = session.bookId
        break
      }
    }
    set({ now })
    if (expired !== null) get().terminate(expired)
  },

  clearSummary: () => set({ lastSummary: null }),
}))
