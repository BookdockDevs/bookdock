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

const IDLE_TIMEOUT_MS = 120_000
const MIN_SESSION_MS = 60_000

interface ReadingPosition {
  fraction?: number
  segmentStart?: number
  cfi?: string
  revisionId?: string
  wordCount?: number
}

export function useReadingTimer(bookId: string | undefined) {
  const userId = useAuthStore((state) => state.user?.id)
  const observedPositionRef = useRef<ReadingPosition | undefined>(undefined)
  const settleRef = useRef<() => void>(() => {})
  const pingRef = useRef<(position?: ReadingPosition) => void>(() => {})

  useEffect(() => {
    if (!bookId || !userId) return
    const id = bookId
    const ownerId = userId
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
    let granted = true
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

    function manualOwns() {
      return Object.values(useManualTimerStore.getState().sessions).some((session) =>
        session.userId === ownerId && (session.phase === 'running' || (session.bookId === id && session.phase === 'paused')))
    }
    function active() {
      return !closed && !document.hidden && !manualOwns() && granted
        && useAuthStore.getState().user?.id === ownerId
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
        fragments: effective, coverage, timezone,
        revisionId: lastPosition?.revisionId, wordCount: lastPosition?.wordCount,
        startFraction: firstPosition?.fraction, endFraction: lastPosition?.fraction,
        startCfi: firstPosition?.cfi, endCfi: lastPosition?.cfi,
      }
    }
    function checkpoint() {
      if (suspendedAt !== null && readingTimerGraceExpiresAt(suspendedAt) <= Date.now()) {
        settle()
        return
      }
      try {
        const record = body(Date.now())
        if (record) {
          const at = suspendedAt ?? Date.now()
          const drafts = readDrafts()
          drafts[id] = { userId: ownerId, phase: 'suspended', suspendedAt: at, expiresAt: readingTimerGraceExpiresAt(at), pendingRecord: record }
          localStorage.setItem(draftKey, JSON.stringify(drafts))
        }
      } catch {
        useReadingSaveState.setState({ storageFailed: true })
      }
    }
    function settle() {
      const now = Date.now()
      pause(now)
      const record = body(now)
      if (record && record.durationSeconds * 1000 >= MIN_SESSION_MS) queueReadingRecord(ownerId, record)
      try {
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
        releaseReadingTimer()
      }, IDLE_TIMEOUT_MS)
    }
    function ping(position?: ReadingPosition) {
      if (position?.fraction === undefined || !Number.isFinite(position.fraction) || position.fraction < 0 || position.fraction > 1) return
      if (closed || document.hidden || manualOwns() || useAuthStore.getState().user?.id !== ownerId) return
      granted = true
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
      void claimReadingTimer('auto', false, lastActivityAt).then((allowed) => {
        if (closed || claimVersion !== version) return
        granted = allowed
        if (!allowed) { pause(Date.now()); settle(); clearIdle() }
      })
    }

    function onVisibilityChange() {
      if (document.hidden) {
        claimVersion++
        clearIdle()
        suspend()
        releaseReadingTimer()
      } else {
        // A foreground transition cannot prove reading activity. Wait for relocate.
        granted = true
      }
    }
    function onPageHide() {
      claimVersion++
      clearIdle()
      suspend()
      releaseReadingTimer()
    }

    // Re-entry restores captured fragments, never the time spent away.
    try {
      const snapshot = readDrafts()[id]
      const draft = snapshot?.pendingRecord
      if (snapshot?.userId === ownerId && draft?.bookId === id && draft.requestId && draft.source === 'auto') {
        if (snapshot.expiresAt <= Date.now()) {
          if (draft.durationSeconds >= 60) queueReadingRecord(ownerId, draft)
          const drafts = readDrafts()
          delete drafts[id]
          localStorage.setItem(draftKey, JSON.stringify(drafts))
        } else {
          requestId = draft.requestId
          startedAt = draft.startedAt ?? null
          suspendedAt = snapshot.suspendedAt
          fragments = draft.fragments ?? []
          coverage = draft.coverage ?? []
          firstPosition = { fraction: draft.startFraction, cfi: draft.startCfi, revisionId: draft.revisionId, wordCount: draft.wordCount }
          lastPosition = { fraction: draft.endFraction, cfi: draft.endCfi, revisionId: draft.revisionId, wordCount: draft.wordCount }
        }
      }
    } catch {
      useReadingSaveState.setState({ storageFailed: true })
    }
    void retryReadingRecords()
    const unsubscribe = useManualTimerStore.subscribe((state, previous) => {
      if (state.sessions === previous.sessions) return
      if (manualOwns()) { claimVersion++; clearIdle(); settle() }
      // Ending/discarding manual starts a new automatic interval without backfill.
      else if (Object.values(previous.sessions).some((session) => session.bookId === id)) {
        granted = true
        lastActivityAt = Date.now()
        resume(lastActivityAt)
        armIdle()
      }
    })
    const checkpointTimer = setInterval(checkpoint, 5000)
    const leaseTimer = setInterval(() => {
      if (stretchStart === null || Date.now() - lastActivityAt >= IDLE_TIMEOUT_MS) return
      claimAuto()
    }, 10_000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    settleRef.current = () => {
      const wasRunning = stretchStart !== null
      if ((body(Date.now())?.durationSeconds ?? 0) >= 60) {
        settle()
        if (wasRunning) resume(Date.now())
      } else checkpoint()
    }
    pingRef.current = ping
    if (observedPositionRef.current) ping(observedPositionRef.current)
    return () => {
      closed = true
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      clearInterval(checkpointTimer)
      clearInterval(leaseTimer)
      clearIdle()
      if (useUiStore.getState().readingTimerMode === 'off' || useUiStore.getState().readingTimerMode === 'manual') settle()
      else suspend()
      if (!manualOwns()) releaseReadingTimer()
      settleRef.current = () => {}
      pingRef.current = () => {}
      observedPositionRef.current = undefined
    }
  }, [bookId, userId])

  return {
    flush: useCallback(() => settleRef.current(), []),
    ping: useCallback((position?: ReadingPosition) => {
      if (position?.fraction !== undefined && Number.isFinite(position.fraction) && position.fraction >= 0 && position.fraction <= 1) observedPositionRef.current = position
      pingRef.current(position)
    }, []),
  }
}
