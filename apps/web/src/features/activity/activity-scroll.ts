import { useCallback, useEffect, useRef } from 'react'

import { restoreScrollWithRetry } from '@/features/archive/archive-scroll'

const STORAGE_KEY = 'bd-activity-scroll'
const MAX_RECORDS = 32

export function activityScrollKey(viewerId: string | undefined, scope: 'personal' | 'library', targetId: string | undefined, type: string, historyIndex: number | undefined) {
  if (!viewerId || !targetId || historyIndex === undefined) return null
  return JSON.stringify([viewerId, scope, targetId, type, historyIndex])
}

function readRecords(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as unknown : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
  } catch {
    return {}
  }
}

function writeRecords(records: Record<string, number>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(records).slice(-MAX_RECORDS))))
  } catch {
    // Scroll restoration is optional; private-mode storage can be unavailable.
  }
}

export function saveActivityScroll(key: string, top: number) {
  const records = readRecords()
  records[key] = Math.max(0, top)
  writeRecords(records)
}

export function takeActivityScroll(key: string): number | null {
  const records = readRecords()
  if (!(key in records)) return null
  const top = records[key]!
  delete records[key]
  writeRecords(records)
  return top
}

export function useActivityScrollPreservation(key: string | null) {
  const liveTop = useRef(typeof window === 'undefined' ? 0 : window.scrollY)
  const explicitlySavedKey = useRef<string | null>(null)

  useEffect(() => {
    const onScroll = () => { liveTop.current = window.scrollY }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!key) return
    const saved = takeActivityScroll(key)
    let cancelRestore = () => {}
    if (saved !== null) {
      cancelRestore = restoreScrollWithRetry({
        read: () => window.scrollY,
        apply: (top) => { window.scrollTo({ top, behavior: 'instant' }) },
        target: saved,
      })
    }
    return () => {
      cancelRestore()
      if (explicitlySavedKey.current === key) {
        explicitlySavedKey.current = null
      }
    }
  }, [key])

  return useCallback(() => {
    if (key) {
      liveTop.current = window.scrollY
      explicitlySavedKey.current = key
      saveActivityScroll(key, liveTop.current)
    }
  }, [key])
}
