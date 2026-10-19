import { create } from 'zustand'

import type { ReadingRecordCreateReq } from '@bookdock/shared'

import { localDateString } from '@/api/hooks/reading-records'
import { useAuthStore } from '@/stores/auth.store'

import { addReadingCoverage } from './reading-coverage'
import { newReadingRequestId, queueReadingRecord, readingTimezone, useReadingSaveState } from './reading-record-queue'
import { readingTimerGraceExpiresAt } from './reading-timer-grace'
import { claimReadingTimer, readingDeviceId, releaseReadingTimer } from './reading-timer-lease'

export type ManualTimerPhase = 'idle' | 'running' | 'paused' | 'suspended'

interface TimerPosition {
  cfi: string | null
  fraction: number | null
  chapterIndex?: number | null
  segmentStart?: number
  revisionId?: string
  wordCount?: number
}

export interface ManualSession {
  bookId: string
  userId: string
  requestId: string
  timezone: string
  date: string
  phase: 'running' | 'paused' | 'suspended'
  startedAt: number
  elapsedMs: number
  lastResumeAt: number | null
  suspendedAt: number | null
  startCfi: string | null
  startFraction: number | null
  startChapterIndex: number | null
  lastCfi: string | null
  lastFraction: number | null
  lastChapterIndex: number | null
  fragments: Array<{ startedAt: number; endedAt: number }>
  coverage: Array<[number, number]>
  revisionId?: string
  wordCount?: number
  transferred?: boolean
}

export interface ManualTimerSummary {
  bookId: string
  durationSeconds: number
}

interface ManualTimerStore {
  sessions: Record<string, ManualSession>
  now: number
  lastSummary: ManualTimerSummary | null
  start: (bookId: string, pos: TimerPosition) => void
  pause: (bookId: string) => void
  resume: (bookId: string, explicit?: boolean) => void
  suspend: (bookId: string) => void
  terminate: (bookId: string) => void
  discard: (bookId: string) => void
  updatePosition: (bookId: string, pos: TimerPosition) => void
  tick: (now: number) => void
  restore: () => void
  clearSummary: () => void
}

export function sessionDurationMs(session: ManualSession, now: number): number {
  return session.elapsedMs + (session.phase === 'running' && session.lastResumeAt !== null
    ? Math.max(0, now - session.lastResumeAt) : 0)
}

export function graceLeftMs(session: ManualSession, now: number): number {
  if (session.phase !== 'suspended' || session.suspendedAt === null) return 0
  return Math.max(0, readingTimerGraceExpiresAt(session.suspendedAt) - now)
}

function freeze(session: ManualSession, now: number): ManualSession {
  if (session.phase !== 'running' || session.lastResumeAt === null) return session
  return {
    ...session,
    elapsedMs: sessionDurationMs(session, now),
    lastResumeAt: null,
    fragments: now > session.lastResumeAt
      ? [...session.fragments, { startedAt: session.lastResumeAt, endedAt: now }]
      : session.fragments,
  }
}

function sessionRecord(session: ManualSession): ReadingRecordCreateReq | null {
  if (Math.round(session.elapsedMs / 1000) <= 0) return null
  return {
    requestId: session.requestId, deviceId: readingDeviceId(), source: 'manual',
    bookId: session.bookId, date: session.date, durationSeconds: Math.round(session.elapsedMs / 1000),
    startedAt: session.startedAt,
    endedAt: session.fragments.at(-1)?.endedAt ?? session.startedAt,
    timezone: session.timezone, fragments: session.fragments, coverage: session.coverage,
    revisionId: session.revisionId, wordCount: session.wordCount,
    ...(session.startCfi ? { startCfi: session.startCfi } : {}),
    ...(session.lastCfi ? { endCfi: session.lastCfi } : {}),
    ...(session.startFraction !== null ? { startFraction: session.startFraction } : {}),
    ...(session.lastFraction !== null ? { endFraction: session.lastFraction } : {}),
    ...(session.startChapterIndex !== null ? { startChapterIndex: session.startChapterIndex } : {}),
    ...(session.lastChapterIndex !== null ? { endChapterIndex: session.lastChapterIndex } : {}),
  }
}

let ticker: ReturnType<typeof setInterval> | null = null
let restoredUser: string | null = null
let lastLeaseAt = 0
const positions = new Map<string, TimerPosition>()
const claimVersions = new Map<string, number>()
const sessionsKey = (userId: string) => `bd-reading-manual:${userId}:${readingDeviceId()}`

function ensureTicker() {
  if (ticker !== null) return
  ticker = setInterval(() => useManualTimerStore.getState().tick(Date.now()), 1000)
}

export function resetManualTimerTicker() {
  if (ticker !== null) clearInterval(ticker)
  ticker = null
}

function persistSessions() {
  const userId = useAuthStore.getState().user?.id
  if (!userId) return
  const sessions = Object.fromEntries(Object.entries(useManualTimerStore.getState().sessions)
    .filter(([, item]) => item.userId === userId)
    .map(([id, item]) => {
      const snapshot = freeze(item, Date.now())
      return [id, { ...snapshot, phase: item.phase === 'running' ? 'suspended' : item.phase,
        suspendedAt: item.phase === 'running' ? Date.now() : item.suspendedAt,
        expiresAt: item.phase === 'paused' ? null : readingTimerGraceExpiresAt(item.phase === 'running' ? Date.now() : item.suspendedAt ?? Date.now()),
        pendingRecord: sessionRecord(snapshot),
      }]
    }))
  try {
    localStorage.setItem(sessionsKey(userId), JSON.stringify(sessions))
  } catch {
    useReadingSaveState.setState({ storageFailed: true })
  }
}

function acquireManual(bookId: string, requestId: string, explicit = false) {
  const version = (claimVersions.get(bookId) ?? 0) + 1
  claimVersions.set(bookId, version)
  void claimReadingTimer('manual', explicit).then((granted) => {
    if (claimVersions.get(bookId) !== version) return
    const session = useManualTimerStore.getState().sessions[bookId]
    if (granted || session?.requestId !== requestId || session.phase !== 'running'
      || session.userId !== useAuthStore.getState().user?.id) return
    useManualTimerStore.setState((state) => ({ sessions: {
      ...state.sessions, [bookId]: { ...freeze(session, Date.now()), phase: 'paused', transferred: true },
    } }))
  })
}

export const useManualTimerStore = create<ManualTimerStore>((set, get) => ({
  sessions: {},
  now: Date.now(),
  lastSummary: null,

  restore: () => {
    const userId = useAuthStore.getState().user?.id ?? null
    if (restoredUser === userId) return
    restoredUser = userId
    positions.clear()
    claimVersions.clear()
    let sessions: Record<string, ManualSession> = {}
    if (userId) {
      try {
        const stored = JSON.parse(localStorage.getItem(sessionsKey(userId)) ?? '{}')
        for (const [id, item] of Object.entries(stored)) {
          const session = item as ManualSession
          if (session.userId === userId && Array.isArray(session.fragments) && typeof session.requestId === 'string') sessions[id] = session
        }
      } catch {
        sessions = {}
      }
    }
    set({ sessions, lastSummary: null, now: Date.now() })
    if (Object.keys(sessions).length) {
      ensureTicker()
      get().tick(Date.now())
    } else {
      resetManualTimerTicker()
    }
  },

  start: (bookId, pos) => {
    const userId = useAuthStore.getState().user?.id
    if (!userId || get().sessions[bookId]) return
    pos = positions.get(bookId) ?? pos
    for (const session of Object.values(get().sessions)) {
      if (session.phase === 'running') get().suspend(session.bookId)
    }
    const now = Date.now()
    const requestId = newReadingRequestId()
    set((state) => ({ sessions: { ...state.sessions, [bookId]: {
      bookId, userId, requestId, timezone: readingTimezone(), date: localDateString(new Date(now)), phase: 'running', startedAt: now,
      elapsedMs: 0, lastResumeAt: now, suspendedAt: null,
      startCfi: pos.cfi, startFraction: pos.fraction, startChapterIndex: pos.chapterIndex ?? null,
      lastCfi: pos.cfi, lastFraction: pos.fraction, lastChapterIndex: pos.chapterIndex ?? null,
      fragments: [], coverage: [], revisionId: pos.revisionId, wordCount: pos.wordCount,
    } } }))
    ensureTicker()
    acquireManual(bookId, requestId, true)
  },

  pause: (bookId) => {
    const session = get().sessions[bookId]
    claimVersions.set(bookId, (claimVersions.get(bookId) ?? 0) + 1)
    if (!session || session.phase !== 'running') return
    set((state) => ({ sessions: { ...state.sessions, [bookId]: { ...freeze(session, Date.now()), phase: 'paused' } } }))
    releaseReadingTimer()
  },

  resume: (bookId, explicit = true) => {
    const session = get().sessions[bookId]
    claimVersions.set(bookId, (claimVersions.get(bookId) ?? 0) + 1)
    if (!session || session.phase === 'running' || session.userId !== useAuthStore.getState().user?.id) return
    if (session.phase === 'suspended' && graceLeftMs(session, Date.now()) === 0) {
      get().terminate(bookId)
      return
    }
    for (const other of Object.values(get().sessions)) {
      if (other.bookId !== bookId && other.phase === 'running') get().suspend(other.bookId)
    }
    set((state) => ({ sessions: { ...state.sessions, [bookId]: {
      ...session, phase: 'running', lastResumeAt: Date.now(), suspendedAt: null, transferred: false,
    } } }))
    acquireManual(bookId, session.requestId, explicit)
  },

  suspend: (bookId) => {
    const session = get().sessions[bookId]
    claimVersions.set(bookId, (claimVersions.get(bookId) ?? 0) + 1)
    if (!session || session.phase !== 'running') return
    const now = Date.now()
    set((state) => ({ sessions: { ...state.sessions, [bookId]: {
      ...freeze(session, now), phase: 'suspended', suspendedAt: now,
    } } }))
    releaseReadingTimer()
  },

  terminate: (bookId) => {
    claimVersions.set(bookId, (claimVersions.get(bookId) ?? 0) + 1)
    const current = get().sessions[bookId]
    if (!current) return
    const session = freeze(current, Date.now())
    const durationSeconds = Math.round(session.elapsedMs / 1000)
    // Persist the queued write before removing the recoverable live session.
    const record = sessionRecord(session)
    if (record) queueReadingRecord(session.userId, record)
    set((state) => {
      const { [bookId]: _removed, ...sessions } = state.sessions
      return { sessions, lastSummary: durationSeconds > 0 ? { bookId, durationSeconds } : null }
    })
    if (current.phase === 'running') releaseReadingTimer()
    if (!Object.keys(get().sessions).length) resetManualTimerTicker()
  },

  discard: (bookId) => {
    claimVersions.set(bookId, (claimVersions.get(bookId) ?? 0) + 1)
    const session = get().sessions[bookId]
    if (!session) return
    set((state) => {
      const { [bookId]: _removed, ...sessions } = state.sessions
      return { sessions }
    })
    if (session.phase === 'running') releaseReadingTimer()
    if (!Object.keys(get().sessions).length) resetManualTimerTicker()
  },

  updatePosition: (bookId, pos) => {
    if (pos.fraction === null || !Number.isFinite(pos.fraction) || pos.fraction < 0 || pos.fraction > 1) return
    positions.set(bookId, pos)
    const session = get().sessions[bookId]
    if (!session) return
    let coverage = session.coverage
    if (session.phase === 'running' && pos.fraction !== null && session.lastFraction !== null
      && pos.segmentStart !== undefined && pos.segmentStart !== pos.fraction) {
      coverage = addReadingCoverage(coverage, session.lastFraction, pos.fraction)
    }
    set((state) => ({ sessions: { ...state.sessions, [bookId]: {
      ...session, lastCfi: pos.cfi, lastFraction: pos.fraction,
      lastChapterIndex: pos.chapterIndex ?? session.lastChapterIndex, coverage,
      revisionId: session.revisionId ?? pos.revisionId, wordCount: session.wordCount ?? pos.wordCount,
    } } }))
  },

  tick: (now) => {
    set({ now })
    for (const session of Object.values(get().sessions)) {
      if (session.phase === 'suspended' && graceLeftMs(session, now) === 0) get().terminate(session.bookId)
    }
    if (now - lastLeaseAt >= 10_000) {
      lastLeaseAt = now
      for (const session of Object.values(get().sessions)) {
        if (session.phase === 'running') acquireManual(session.bookId, session.requestId)
      }
    }
  },

  clearSummary: () => set({ lastSummary: null }),
}))

useManualTimerStore.subscribe(persistSessions)
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) useManualTimerStore.getState().restore()
})
