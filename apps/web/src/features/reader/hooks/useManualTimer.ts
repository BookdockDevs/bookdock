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
 * runs module-level, surviving Reader unmounts), and terminates on pagehide so
 * a closed tab never loses the session.
 */
export function useManualTimer(bookId: string | undefined) {
  const session = useManualTimerStore((s) => (bookId ? s.sessions[bookId] : undefined))
  const now = useManualTimerStore((s) => s.now)
  const lastSummary = useManualTimerStore((s) => s.lastSummary)
  const clearSummary = useManualTimerStore((s) => s.clearSummary)
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
      useManualTimerStore.getState().updatePosition(bookId, pos)
    })
  }, [bookId, renderer])

  // Grace re-entry: a suspended session for this book resumes on mount
  useEffect(() => {
    if (!bookId) return
    const existing = useManualTimerStore.getState().sessions[bookId]
    if (existing?.phase === 'suspended') useManualTimerStore.getState().resume(bookId)
  }, [bookId])

  useEffect(() => {
    if (!bookId) return
    const id = bookId
    const store = () => useManualTimerStore.getState()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        store().suspend(id)
      } else {
        store().resume(id)
      }
    }
    const onPageHide = () => store().terminate(id)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      // Leaving the reader (book switch / unmount) suspends instead of
      // terminating — the grace countdown keeps running module-level and the
      // session can be resumed on re-entry
      store().suspend(id)
    }
  }, [bookId])

  const phase: ManualTimerPhase = session?.phase ?? 'idle'
  const durationMs = session ? sessionDurationMs(session, now) : 0
  const graceMs = session ? graceLeftMs(session, now) : 0

  return {
    phase,
    elapsedMs: durationMs,
    graceMs,
    graceMinutes,
    lastSummary: lastSummary?.bookId === bookId ? lastSummary : null,
    clearSummary,
    start: () => bookId && useManualTimerStore.getState().start(bookId, lastPosRef.current),
    pause: () => bookId && useManualTimerStore.getState().pause(bookId),
    resume: () => bookId && useManualTimerStore.getState().resume(bookId),
    terminate: () => bookId && useManualTimerStore.getState().terminate(bookId),
    discard: () => bookId && useManualTimerStore.getState().discard(bookId),
  }
}
