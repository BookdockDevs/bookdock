import { useEffect, useRef } from 'react'

import { useReaderApi } from './useReaderApi'
import { useUiStore } from '@/stores/ui.store'
import {
  graceLeftMs,
  sessionDurationMs,
  useManualTimerStore,
  type ManualTimerPhase,
} from '../lib/manual-timer-store'

/**
 * Binds the manual reading timer (manual-reading-timer.md) to the current
 * book: tracks the live position for session end bounds, resumes a suspended
 * session on re-entry, suspends on visibilitychange/unmount (grace countdown
 * runs module-level, surviving Reader unmounts). Pagehide suspends and persists
 * captured fragments so refreshing never counts the time away.
 */
export function useManualTimer(bookId: string | undefined, store = useManualTimerStore) {
  const session = store((s) => (bookId ? s.sessions[bookId] : undefined))
  const now = store((s) => s.now)
  const ready = store((s) => s.ready)
  const storageError = store((s) => s.storageError)
  const retry = store((s) => s.retry)
  const lastSummary = store((s) => s.lastSummary)
  const clearSummary = store((s) => s.clearSummary)
  const graceMinutes = useUiStore((s) => s.manualTimerGraceMinutes)
  const { renderer } = useReaderApi()

  const lastPosRef = useRef<{ cfi: string | null; fraction: number | null; chapterIndex?: number | null }>({
    cfi: null,
    fraction: null,
    chapterIndex: null,
  })

  // Position tracking: the session's end bounds are the last relocate
  useEffect(() => {
    if (!bookId || !renderer) return
    return renderer.on('relocated', (e) => {
      const pos = { cfi: e.cfi ?? null, fraction: e.fraction ?? null, chapterIndex: e.chapterIndex ?? null }
      lastPosRef.current = pos
    })
  }, [bookId, renderer])

  // Grace re-entry: a suspended session for this book resumes on mount
  useEffect(() => {
    if (!bookId) return
    let active = true
    const resume = () => {
      if (!active) return
      const existing = store.getState().sessions[bookId]
      if (existing?.phase === 'suspended' && document.visibilityState !== 'hidden') store.getState().resume(bookId, false)
    }
    const restored = store.getState().restore()
    if (restored) void restored.then(resume)
    else resume()
    return () => { active = false }
  }, [bookId, store])

  useEffect(() => {
    if (!bookId) return
    const id = bookId
    const state = () => store.getState()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        state().suspend(id)
      } else if (state().sessions[id]?.phase === 'suspended') {
        state().resume(id, false)
      }
    }
    const onPageHide = () => state().suspend(id)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      // Leaving the reader (book switch / unmount) suspends instead of
      // terminating — the grace countdown keeps running module-level and the
      // session can be resumed on re-entry
      state().suspend(id)
    }
  }, [bookId, store])

  const phase: ManualTimerPhase = session?.phase ?? 'idle'
  const durationMs = session ? sessionDurationMs(session, now) : 0
  const graceMs = session ? graceLeftMs(session, now) : 0

  return {
    phase,
    ready, storageError, retry,
    session,
    transferred: session?.transferred ?? false,
    elapsedMs: durationMs,
    graceMs,
    graceMinutes,
    lastSummary: lastSummary?.bookId === bookId ? lastSummary : null,
    clearSummary,
    start: () => bookId && store.getState().start(bookId, lastPosRef.current),
    pause: () => bookId && store.getState().pause(bookId),
    resume: () => bookId && store.getState().resume(bookId),
    terminate: () => bookId && store.getState().terminate(bookId),
    discard: () => bookId && store.getState().discard(bookId),
  }
}
