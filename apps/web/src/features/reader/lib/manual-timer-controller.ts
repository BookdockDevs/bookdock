import { create } from 'zustand'

import type { ClientBookRef, ClientManualTimerSnapshot, ReadingRecordCreateReq } from '@bookdock/shared'

import { localDateString } from '@/api/hooks/reading-records'

import { addReadingCoverage } from './reading-coverage'
import { readingTimerGraceExpiresAt } from './reading-timer-grace'

export type ManualTimerPhase = 'idle' | 'running' | 'paused' | 'suspended'

interface TimerPosition {
  cfi: string | null
  fraction: number | null
  chapterIndex?: number | null
  segmentStart?: number
  revisionId?: string
  wordCount?: number
}

type ManualSessionFields = Omit<ClientManualTimerSnapshot, 'book' | 'updatedAt' | 'expiresAt' | 'phase' | 'lastResumeAt'> & {
  bookId: string
  phase: 'running' | 'paused' | 'suspended'
  lastResumeAt: number | null
}

export type ManualTimerIdentity = { userId: string; book?: never } | { userId?: never; book: ClientBookRef }
export type ManualSession = ManualSessionFields & ManualTimerIdentity
export type ManualTimerSnapshot = ManualSession & { expiresAt: number | null; pendingRecord: ReadingRecordCreateReq | null }

export interface ManualTimerAdapter {
  newRequestId(): string
  timezone(): string
  deviceId(): string
  ownerKey(): string | null
  identity(bookId: string): ManualTimerIdentity | null
  isCurrent(session: ManualSession): boolean
  load(): Record<string, ManualSession> | Promise<Record<string, ManualSession>>
  persist(sessions: Record<string, ManualTimerSnapshot>): void | Promise<void>
  claim(session: ManualSession, explicit: boolean): Promise<boolean>
  release(session: ManualSession): void
  enqueue(session: ManualSession, record: ReadingRecordCreateReq): void
  retry?(): Promise<void>
  onError(error: unknown): void
}

export interface ManualTimerSummary {
  bookId: string
  durationSeconds: number
}

export interface ManualTimerStore {
  ready: boolean
  storageError: boolean
  retry: () => void
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
  restore: () => void | Promise<void>
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

export function manualSessionRecord(session: ManualSession, deviceId?: string): ReadingRecordCreateReq | null {
  if (Math.round(session.elapsedMs / 1000) <= 0) return null
  return {
    requestId: session.requestId, deviceId: session.deviceId ?? deviceId, source: 'manual',
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

export function createManualTimerStore(adapter: ManualTimerAdapter) {
  let ticker: ReturnType<typeof setInterval> | null = null
  let restoredOwner: string | null | undefined
  let restoring: Promise<void> | undefined
  let suppressPersistence = false
  let lastLeaseAt = 0
  const positions = new Map<string, TimerPosition>()
  const claimVersions = new Map<string, number>()

  function ensureTicker() {
    if (ticker !== null) return
    ticker = setInterval(() => useManualTimerStore.getState().tick(Date.now()), 1000)
  }

  function resetManualTimerTicker() {
    if (ticker !== null) clearInterval(ticker)
    ticker = null
  }

  function reportError(error: unknown) {
    useManualTimerStore.setState({ storageError: true })
    adapter.onError(error)
  }

  function persistSessions() {
    const sessions = Object.fromEntries(Object.entries(useManualTimerStore.getState().sessions)
      .filter(([, item]) => adapter.isCurrent(item))
      .map(([id, item]) => {
        const snapshot = freeze(item, Date.now())
        return [id, { ...snapshot, phase: item.phase === 'running' ? 'suspended' : item.phase,
          suspendedAt: item.phase === 'running' ? Date.now() : item.suspendedAt,
          expiresAt: item.phase === 'paused' ? null : readingTimerGraceExpiresAt(item.phase === 'running' ? Date.now() : item.suspendedAt ?? Date.now()),
          pendingRecord: manualSessionRecord(snapshot, adapter.deviceId()),
        }]
      })) as Record<string, ManualTimerSnapshot>
    try { const pending = adapter.persist(sessions); if (pending) void pending.catch(reportError) } catch (error) { reportError(error) }
  }

  function acquireManual(bookId: string, requestId: string, explicit = false) {
    const version = (claimVersions.get(bookId) ?? 0) + 1
    claimVersions.set(bookId, version)
    const candidate = useManualTimerStore.getState().sessions[bookId]
    if (!candidate) return
    void adapter.claim(candidate, explicit).then((granted) => {
      if (claimVersions.get(bookId) !== version) return
      const session = useManualTimerStore.getState().sessions[bookId]
      if (granted || session?.requestId !== requestId || session.phase !== 'running'
        || !adapter.isCurrent(session)) return
      useManualTimerStore.setState((state) => ({ sessions: {
        ...state.sessions, [bookId]: { ...freeze(session, Date.now()), phase: 'paused', transferred: true },
      } }))
    }).catch(reportError)
  }

  const useManualTimerStore = create<ManualTimerStore>((set, get) => ({
    sessions: {},
    ready: false,
    storageError: false,
    retry: () => {
      void (adapter.retry?.() ?? Promise.resolve()).then(() => { set({ storageError: false }); if (!get().ready) return get().restore() }).catch(reportError)
    },
    now: Date.now(),
    lastSummary: null,

    restore: () => {
      const owner = adapter.ownerKey()
      if (restoredOwner === owner) return restoring
      restoredOwner = owner
      positions.clear()
      claimVersions.clear()
      suppressPersistence = true
      set({ sessions: {}, ready: false, lastSummary: null })
      suppressPersistence = false
      function apply(sessions: Record<string, ManualSession>) {
        if (adapter.ownerKey() !== owner) return
        set({ sessions, ready: true, storageError: false, lastSummary: null, now: Date.now() })
        if (Object.keys(sessions).length) { ensureTicker(); get().tick(Date.now()) }
        else resetManualTimerTicker()
      }
      try {
        const loaded = adapter.load()
        if (loaded instanceof Promise) {
          set({ ready: false })
          restoring = loaded.then(apply).catch((error) => { restoredOwner = undefined; reportError(error) }).finally(() => { restoring = undefined })
          return restoring
        }
        apply(loaded)
      } catch (error) { restoredOwner = undefined; reportError(error) }
    },

    start: (bookId, pos) => {
      const identity = adapter.identity(bookId)
      if (!identity || !get().ready || get().sessions[bookId]) return
      pos = positions.get(bookId) ?? pos
      for (const session of Object.values(get().sessions)) {
        if (session.phase === 'running') get().suspend(session.bookId)
      }
      const now = Date.now()
      const requestId = adapter.newRequestId()
      set((state) => ({ sessions: { ...state.sessions, [bookId]: {
        bookId, ...identity, requestId, deviceId: adapter.deviceId(), timezone: adapter.timezone(), date: localDateString(new Date(now)), phase: 'running', startedAt: now,
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
      adapter.release(session)
    },

    resume: (bookId, explicit = true) => {
      const session = get().sessions[bookId]
      claimVersions.set(bookId, (claimVersions.get(bookId) ?? 0) + 1)
      if (!session || session.phase === 'running' || !adapter.isCurrent(session)) return
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
      adapter.release(session)
    },

    terminate: (bookId) => {
      claimVersions.set(bookId, (claimVersions.get(bookId) ?? 0) + 1)
      const current = get().sessions[bookId]
      if (!current) return
      const session = freeze(current, Date.now())
      const durationSeconds = Math.round(session.elapsedMs / 1000)
      // Persist the queued write before removing the recoverable live session.
      const record = manualSessionRecord(session, adapter.deviceId())
      if (record) adapter.enqueue(session, record)
      set((state) => {
        const { [bookId]: _removed, ...sessions } = state.sessions
        return { sessions, lastSummary: durationSeconds > 0 ? { bookId, durationSeconds } : null }
      })
      if (current.phase === 'running') adapter.release(current)
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
      if (session.phase === 'running') adapter.release(session)
      if (!Object.keys(get().sessions).length) resetManualTimerTicker()
    },

    updatePosition: (bookId, pos) => {
      if (pos.fraction === null || !Number.isFinite(pos.fraction) || pos.fraction < 0 || pos.fraction > 1) return
      positions.set(bookId, pos)
      const session = get().sessions[bookId]
      if (!session) return
      if (session.revisionId && pos.revisionId && session.revisionId !== pos.revisionId) {
        get().pause(bookId)
        return
      }
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

  const unsubscribe = useManualTimerStore.subscribe((state, previous) => {
    if (!suppressPersistence && (state.sessions !== previous.sessions || state.now !== previous.now && Object.values(state.sessions).some((session) => session.phase === 'running'))) persistSessions()
  })
  return { useStore: useManualTimerStore, resetTicker: resetManualTimerTicker, dispose: () => { resetManualTimerTicker(); unsubscribe() } }
}
