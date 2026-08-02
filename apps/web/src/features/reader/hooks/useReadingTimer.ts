import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { BASE_URL } from '@/api/client'
import { READING_RECORDS_KEY, localDateString, useAddReadingTime } from '@/api/hooks/reading-records'

const MIN_SESSION_SECONDS = 5
const HIDDEN_GRACE_MS = 10_000

/**
 * Accumulates reading time while the reader is open and reports it in chunks:
 * - a background stint longer than HIDDEN_GRACE_MS settles the time read before it
 *   (the stint itself does not count); shorter interruptions count as reading
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

  useEffect(() => {
    if (!bookId) return
    const id = bookId
    let accumulatedMs = 0
    let resumeAt = Date.now()
    let sessionStart = new Date()
    let hiddenAt: number | null = null

    function settle(useBeacon = false) {
      const now = Date.now()
      if (hiddenAt === null) accumulatedMs += now - resumeAt
      resumeAt = now
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

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        if (hiddenAt !== null) return
        hiddenAt = Date.now()
        accumulatedMs += hiddenAt - resumeAt
        resumeAt = hiddenAt
      } else if (hiddenAt !== null) {
        const hiddenMs = Date.now() - hiddenAt
        if (hiddenMs > HIDDEN_GRACE_MS) {
          settle()
        } else {
          accumulatedMs += hiddenMs
        }
        hiddenAt = null
        resumeAt = Date.now()
      }
    }

    function onPageHide() {
      settle(true)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    settleRef.current = () => settle()
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      settle()
      settleRef.current = () => {}
    }
  }, [bookId])

  // flush reports the unreported segment now; the timer keeps running afterwards
  const flush = useCallback(() => settleRef.current(), [])
  return { flush }
}
