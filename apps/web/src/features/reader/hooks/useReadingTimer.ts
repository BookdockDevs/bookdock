import { useCallback, useEffect, useRef } from 'react'

import type { ReadingRecordCreateReq } from '@bookdock/shared'

import { localDateString } from '@/api/hooks/reading-records'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

import { addReadingCoverage } from '../lib/reading-coverage'
import { useManualTimerStore } from '../lib/manual-timer-store'
import { newReadingRequestId, queueReadingRecord, readingTimezone, retryReadingRecords, useReadingSaveState } from '../lib/reading-record-queue'
import { readingTimerGraceExpiresAt } from '../lib/reading-timer-grace'
import { claimReadingTimer, readingDeviceId, releaseReadingTimer } from '../lib/reading-timer-lease'
import type { ReadingTimerDestination, ReadingTimerSnapshot } from '../lib/reading-timer-destination'

const IDLE_TIMEOUT_MS = 120_000
const MIN_SESSION_MS = 60_000

interface ReadingPosition {
  fraction?: number
  segmentStart?: number
  cfi?: string
  revisionId?: string
  wordCount?: number
}

export function useReadingTimer(bookId: string | undefined, destination?: ReadingTimerDestination, manualStore?: typeof useManualTimerStore) {
  const selectedManualStore = manualStore ?? useManualTimerStore
  const userId = useAuthStore((state) => state.user?.id)
  const owner = destination?.scopeKey ?? userId
  const observedPositionRef = useRef<ReadingPosition | undefined>(undefined)
  const settleRef = useRef<(options?: { finished?: boolean }) => void>(() => {})
  const pingRef = useRef<(position?: ReadingPosition) => void>(() => {})

  useEffect(() => {
    if (!bookId || !owner) return
    const id = bookId
    const ownerId = owner
    const timezone = readingTimezone()
    const draftKey = `bd-reading-auto:${ownerId}:${readingDeviceId()}`
    let requestId: string = newReadingRequestId()
    let startedAt: number | null = null
    let stretchStart: number | null = null
    let fragments: Array<{ startedAt: number; endedAt: number }> = []
    let coverage: Array<[number, number]> = []
    let firstPosition: ReadingPosition | undefined
    let lastPosition: ReadingPosition | undefined
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let lastActivityAt = 0
    let granted = !destination
    let hydrated = !destination
    let loading = false
    let closed = false
    let claimVersion = 0
    let lastClaimAt = 0
    let suspendedAt: number | null = null

    function readDrafts(): Record<string, { userId: string; phase: string; suspendedAt: number; expiresAt: number; pendingRecord: ReadingRecordCreateReq }> {
      const stored = JSON.parse(localStorage.getItem(draftKey) ?? '{}')
      if (stored?.requestId) {
        const at = stored.endedAt ?? Date.now()
        return { [stored.bookId]: { userId: ownerId, phase: 'suspended', suspendedAt: at, expiresAt: readingTimerGraceExpiresAt(at), pendingRecord: stored } }
      }
      return stored
    }

    function manualOwns(sessions = selectedManualStore.getState().sessions, ready = selectedManualStore.getState().ready) {
      if (destination && !manualStore) return false
      if (destination && manualStore && !ready) return true
      return Object.values(sessions).some((session) =>
        (destination || session.userId === ownerId) && (session.phase === 'running' || (session.bookId === id && session.phase === 'paused')))
    }
    function active() {
      return !closed && !document.hidden && !manualOwns() && granted
        && (destination || useAuthStore.getState().user?.id === ownerId)
    }
    function clearIdle() {
      if (idleTimer !== null) clearTimeout(idleTimer)
      idleTimer = null
    }
    function pause(now: number) {
      if (stretchStart !== null && now > stretchStart) fragments.push({ startedAt: stretchStart, endedAt: now })
      stretchStart = null
    }
    function body(now: number): ReadingRecordCreateReq | null {
      const effective = stretchStart !== null && now > stretchStart
        ? [...fragments, { startedAt: stretchStart, endedAt: now }] : fragments
      const elapsed = effective.reduce((total, fragment) => total + fragment.endedAt - fragment.startedAt, 0)
      if (startedAt === null || elapsed < 1000) return null
      return {
        bookId: id, requestId, source: 'auto', deviceId: readingDeviceId(),
        date: localDateString(new Date(startedAt)), durationSeconds: Math.floor(elapsed / 1000),
        startedAt, endedAt: effective.at(-1)?.endedAt ?? startedAt,
        fragments: effective.map((fragment) => ({ ...fragment })), coverage: coverage.map(([from, to]) => [from, to]), timezone,
        revisionId: lastPosition?.revisionId, wordCount: lastPosition?.wordCount,
        startFraction: firstPosition?.fraction, endFraction: lastPosition?.fraction,
        startCfi: firstPosition?.cfi, endCfi: lastPosition?.cfi,
      }
    }
    function checkpoint() {
      if (!hydrated) { restoreDestination(); return }
      if (suspendedAt !== null && readingTimerGraceExpiresAt(suspendedAt) <= Date.now()) {
        settle()
        return
      }
      try {
        const record = body(Date.now())
        if (record) {
          if (destination && (record.durationSeconds >= 86_400 || record.durationSeconds >= 60 && (record.fragments?.length ?? 0) >= 5000)) {
            const wasRunning = stretchStart !== null
            settle()
            if (wasRunning) resume(Date.now())
            return
          }
          const at = suspendedAt ?? Date.now()
          if (destination) {
            void destination.saveDraft({ pendingRecord: record, phase: 'suspended', suspendedAt: at, expiresAt: readingTimerGraceExpiresAt(at), updatedAt: Date.now() }).catch(destination.onError)
            return
          }
          const drafts = readDrafts()
          drafts[id] = { userId: ownerId, phase: 'suspended', suspendedAt: at, expiresAt: readingTimerGraceExpiresAt(at), pendingRecord: record }
          localStorage.setItem(draftKey, JSON.stringify(drafts))
        }
      } catch {
        useReadingSaveState.setState({ storageFailed: true })
      }
    }
    function settle(finished?: boolean) {
      const now = Date.now()
      pause(now)
      const record = body(now)
      if (record) {
        if (finished) record.finished = true
        if (destination) {
          const at = suspendedAt ?? now
          void destination.enqueue({ pendingRecord: record, phase: 'queued', suspendedAt: at, expiresAt: readingTimerGraceExpiresAt(at), updatedAt: now }).catch(destination.onError)
        } else if (record.durationSeconds * 1000 >= MIN_SESSION_MS || finished) queueReadingRecord(ownerId, record)
      }
      if (!destination) try {
        const drafts = readDrafts()
        delete drafts[id]
        localStorage.setItem(draftKey, JSON.stringify(drafts))
      } catch { useReadingSaveState.setState({ storageFailed: true }) }
      requestId = newReadingRequestId()
      startedAt = null
      fragments = []
      coverage = []
      firstPosition = lastPosition
      suspendedAt = null
    }
    function suspend(at = Date.now()) {
      pause(at)
      suspendedAt ??= at
      checkpoint()
    }
    function resume(now: number) {
      if (!active() || stretchStart !== null || lastPosition?.fraction === undefined) return
      if (startedAt === null) startedAt = now
      stretchStart = now
    }
    function armIdle() {
      clearIdle()
      idleTimer = setTimeout(() => {
        suspend(lastActivityAt + IDLE_TIMEOUT_MS)
        release()
      }, IDLE_TIMEOUT_MS)
    }
    function ping(position?: ReadingPosition) {
      if (position?.fraction === undefined || !Number.isFinite(position.fraction) || position.fraction < 0 || position.fraction > 1) return
      if (!hydrated || closed || document.hidden || manualOwns() || !destination && useAuthStore.getState().user?.id !== ownerId) return
      if (!destination) granted = true
      const now = Date.now()
      if ((suspendedAt !== null && readingTimerGraceExpiresAt(suspendedAt) <= now)
        || (lastPosition?.revisionId && position?.revisionId && lastPosition.revisionId !== position.revisionId)) {
        settle()
        firstPosition = undefined
        lastPosition = undefined
      }
      suspendedAt = null
      lastActivityAt = now
      const previous = lastPosition?.fraction
      if (position) {
        if (stretchStart !== null && previous !== undefined && position.fraction !== undefined
          && position.segmentStart !== undefined && position.segmentStart !== position.fraction) {
          coverage = addReadingCoverage(coverage, previous, position.fraction)
        }
        lastPosition = position
        firstPosition ??= position
      }
      resume(now)
      armIdle()
      checkpoint()
      if (now - lastClaimAt >= 1000) claimAuto()
    }
    function claimAuto() {
      lastClaimAt = Date.now()
      const version = ++claimVersion
      void (destination ? destination.claim(lastActivityAt) : claimReadingTimer('auto', false, lastActivityAt)).then((allowed) => {
        if (closed || claimVersion !== version) return
        granted = allowed
        if (!allowed) { pause(Date.now()); settle(); clearIdle() }
        else if (destination && !document.hidden) resume(Date.now())
      }).catch((error) => { if (destination) { granted = false; pause(Date.now()); checkpoint(); destination.onError(error) } })
    }

    function release() {
      if (destination) void destination.release(Date.now()).catch(destination.onError)
      else releaseReadingTimer()
    }

    function onVisibilityChange() {
      if (document.hidden) {
        claimVersion++
        clearIdle()
        suspend()
        release()
      } else {
        // A foreground transition cannot prove reading activity. Wait for relocate.
        granted = !destination
      }
    }
    function onPageHide() {
      claimVersion++
      clearIdle()
      suspend()
      release()
    }

    function restoreRecord(draft: ReadingRecordCreateReq, at: number) {
      requestId = draft.requestId!
      startedAt = draft.startedAt ?? null
      suspendedAt = at
      fragments = (draft.fragments ?? []).map((fragment) => ({ ...fragment }))
      coverage = (draft.coverage ?? []).map(([from, to]) => [from, to])
      firstPosition = { fraction: draft.startFraction, cfi: draft.startCfi, revisionId: draft.revisionId, wordCount: draft.wordCount }
      lastPosition = { fraction: draft.endFraction, cfi: draft.endCfi, revisionId: draft.revisionId, wordCount: draft.wordCount }
    }

    function restoreDestination() {
      if (!destination || closed || hydrated || loading) return
      loading = true
      void destination.loadDraft().then((snapshot: ReadingTimerSnapshot | undefined) => {
        if (closed) return
        if (snapshot) restoreRecord(snapshot.pendingRecord, snapshot.suspendedAt)
        hydrated = true
        if (observedPositionRef.current) ping(observedPositionRef.current)
      }).catch(destination.onError).finally(() => { loading = false })
    }

    // Re-entry restores captured fragments, never the time spent away.
    if (!destination) try {
      const snapshot = readDrafts()[id]
      const draft = snapshot?.pendingRecord
      if (snapshot?.userId === ownerId && draft?.bookId === id && draft.requestId && draft.source === 'auto') {
        if (snapshot.expiresAt <= Date.now()) {
          if (draft.durationSeconds >= 60) queueReadingRecord(ownerId, draft)
          const drafts = readDrafts()
          delete drafts[id]
          localStorage.setItem(draftKey, JSON.stringify(drafts))
        } else {
          restoreRecord(draft, snapshot.suspendedAt)
        }
      }
    } catch {
      useReadingSaveState.setState({ storageFailed: true })
    }
    if (destination) { restoreDestination(); void destination.retry().catch(destination.onError) }
    else void retryReadingRecords()
    const unsubscribe = destination && !manualStore ? undefined : selectedManualStore.subscribe((state, previous) => {
      if (state.sessions === previous.sessions && state.ready === previous.ready) return
      if (manualOwns()) { claimVersion++; clearIdle(); settle() }
      // Ending/discarding manual starts a new automatic interval without backfill.
      else if (manualOwns(previous.sessions, previous.ready)) {
        granted = !destination
        lastActivityAt = Date.now()
        if (destination) queueMicrotask(() => {
          if (closed || manualOwns()) return
          if (!lastPosition && observedPositionRef.current) ping(observedPositionRef.current)
          else claimAuto()
        })
        else resume(lastActivityAt)
        armIdle()
      }
    })
    const checkpointTimer = setInterval(checkpoint, 5000)
    const retryTimer = destination ? setInterval(() => { void destination.retry().catch(destination.onError) }, 30_000) : undefined
    const leaseTimer = setInterval(() => {
      if (stretchStart === null || Date.now() - lastActivityAt >= IDLE_TIMEOUT_MS) return
      claimAuto()
    }, 10_000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    settleRef.current = (options?: { finished?: boolean }) => {
      const wasRunning = stretchStart !== null
      if (options?.finished) {
        settle(true)
        if (wasRunning) resume(Date.now())
      } else if ((body(Date.now())?.durationSeconds ?? 0) >= 60) {
        settle()
        if (wasRunning) resume(Date.now())
      } else checkpoint()
    }
    pingRef.current = ping
    if (observedPositionRef.current) ping(observedPositionRef.current)
    return () => {
      closed = true
      unsubscribe?.()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      clearInterval(checkpointTimer)
      if (retryTimer !== undefined) clearInterval(retryTimer)
      clearInterval(leaseTimer)
      clearIdle()
      if (useUiStore.getState().readingTimerMode === 'off' || useUiStore.getState().readingTimerMode === 'manual') settle()
      else suspend()
      if (!manualOwns()) release()
      settleRef.current = () => {}
      pingRef.current = () => {}
      observedPositionRef.current = undefined
    }
  }, [bookId, owner, destination, selectedManualStore, manualStore])

  return {
    flush: useCallback((options?: { finished?: boolean }) => settleRef.current(options), []),
    ping: useCallback((position?: ReadingPosition) => {
      if (position?.fraction !== undefined && Number.isFinite(position.fraction) && position.fraction >= 0 && position.fraction <= 1) observedPositionRef.current = position
      pingRef.current(position)
    }, []),
  }
}
