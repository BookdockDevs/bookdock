import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { BASE_URL } from '@/api/client'
import { READING_RECORDS_KEY, localDateString, useAddReadingTime } from '@/api/hooks/reading-records'

const MIN_SESSION_SECONDS = 5
const HIDDEN_GRACE_MS = 10_000
// No relocate (page turn / scroll position change) for this long = not actively
// reading (walked away, staring at a static page) — settle and pause. Same
// trade-off as Readest's idleTimeout: a single page read for >2min only counts
// the first 2 minutes.
const IDLE_TIMEOUT_MS = 120_000

/**
 * Accumulates reading time while the reader is open and reports it in chunks:
 * - activity = relocate events (Reader calls ping()); IDLE_TIMEOUT_MS without
 *   one settles and pauses, so foreground stints with no page movement no
 *   longer count as reading (browsing TOC/settings doesn't count either)
 * - a background stint longer than HIDDEN_GRACE_MS settles the time read before
 *   it (the stint itself does not count); shorter interruptions count as reading
 * - pagehide reports via sendBeacon; unmount reports via fetch
 * - fragments shorter than MIN_SESSION_SECONDS are dropped
 * Time is attributed to the local calendar day of the session start.
 */
export function useReadingTimer(bookId: string | undefined) {
  const addTime = useAddReadingTime()
  const queryClient = useQueryClient()
  const mutateRef = useRef(addTime.mutate)
  mutateRef.current = addTime.mutate
  const queryClientRef = useRef(queryClient)
  queryClientRef.current = queryClient
  const settleRef = useRef<() => void>(() => {})
  const pingRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!bookId) return
    const id = bookId
    let accumulatedMs = 0
    // null = paused (idle or hidden); otherwise the active stretch started here
    let stretchStart: number | null = Date.now()
    let sessionStart = new Date()
    let hiddenAt: number | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    function pause(now: number) {
      if (stretchStart !== null) {
        accumulatedMs += now - stretchStart
        stretchStart = null
      }
    }
    function resume(now: number) {
      stretchStart = now
    }
    function clearIdle() {
      if (idleTimer !== null) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
    }
    function armIdle() {
      clearIdle()
      idleTimer = setTimeout(() => {
        idleTimer = null
        if (hiddenAt !== null) return
        pause(Date.now())
        settle()
      }, IDLE_TIMEOUT_MS)
    }
    function settle(useBeacon = false) {
      const seconds = Math.floor(accumulatedMs / 1000)
      const date = localDateString(sessionStart)
      const startedAt = sessionStart.getTime()
      accumulatedMs = 0
      sessionStart = new Date()
      if (seconds < MIN_SESSION_SECONDS) return
      const body = { bookId: id, date, durationSeconds: seconds, startedAt }
      if (useBeacon && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(`${BASE_URL}/reading-records`, new Blob([JSON.stringify(body)], { type: 'application/json' }))
      } else {
        mutateRef.current(body)
      }
      void queryClientRef.current.invalidateQueries({ queryKey: READING_RECORDS_KEY })
    }

    function ping() {
      if (hiddenAt !== null) return
      const now = Date.now()
      // coming back from an idle pause: settle() already reset sessionStart,
      // so this resumes as a fresh session
      if (stretchStart === null) resume(now)
      armIdle()
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        if (hiddenAt !== null) return
        hiddenAt = Date.now()
        pause(hiddenAt)
        clearIdle()
      } else if (hiddenAt !== null) {
        const hiddenMs = Date.now() - hiddenAt
        hiddenAt = null
        if (hiddenMs > HIDDEN_GRACE_MS) {
          settle()
        } else {
          // short interruption counts as reading
          accumulatedMs += hiddenMs
        }
        resume(Date.now())
        armIdle()
      }
    }

    function onPageHide() {
      pause(Date.now())
      settle(true)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    armIdle()
    settleRef.current = () => {
      pause(Date.now())
      settle()
      resume(Date.now())
    }
    pingRef.current = ping
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      clearIdle()
      pause(Date.now())
      settle()
      settleRef.current = () => {}
      pingRef.current = () => {}
    }
  }, [bookId])

  // flush reports the unreported segment now; the timer keeps running afterwards
  const flush = useCallback(() => settleRef.current(), [])
  // activity signal: every relocate (page turn / scroll) refreshes the idle timer
  const ping = useCallback(() => pingRef.current(), [])
  return { flush, ping }
}
