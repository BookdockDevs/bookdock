import { create } from 'zustand'

import type { ReadingRecordCreateReq } from '@bookdock/shared'

import { ApiError, apiPost } from '@/api/client'
import { queryClient } from '@/lib/query-client'
import { withReveal } from '@/lib/reveal-hidden'
import { useAuthStore } from '@/stores/auth.store'

import { splitReadingRecord } from './reading-record-chunks'

export const useReadingSaveState = create<{
  pending: number
  saveFailed: boolean
  storageFailed: boolean
}>(() => ({ pending: 0, saveFailed: false, storageFailed: false }))

const keyFor = (userId: string) => `bd-reading-pending:${userId}`
const inFlight = new Set<string>()
const unpersisted = new Set<string>()
const memory = new Map<string, ReadingRecordCreateReq[]>()
const rejected = new Map<string, Set<string>>()

function read(userId: string): ReadingRecordCreateReq[] {
  if (unpersisted.has(userId)) return memory.get(userId) ?? []
  try {
    const stored = JSON.parse(localStorage.getItem(keyFor(userId)) ?? '[]')
    const records = Array.isArray(stored) ? stored : []
    memory.set(userId, records)
    return records
  } catch {
    useReadingSaveState.setState({ storageFailed: true })
    return memory.get(userId) ?? []
  }
}

function persist(userId: string, records: ReadingRecordCreateReq[]) {
  memory.set(userId, records)
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(records))
    unpersisted.delete(userId)
    if (useAuthStore.getState().user?.id === userId) useReadingSaveState.setState({ storageFailed: false })
  } catch {
    unpersisted.add(userId)
    if (useAuthStore.getState().user?.id === userId) useReadingSaveState.setState({ storageFailed: true })
  }
  if (useAuthStore.getState().user?.id === userId) {
    useReadingSaveState.setState({ pending: records.length, ...(records.length === 0 ? { saveFailed: false } : {}) })
  }
}

export function queueReadingRecord(userId: string, record: ReadingRecordCreateReq) {
  const records = read(userId)
  const added = splitReadingRecord(record).filter((chunk) => !records.some((item) => item.requestId === chunk.requestId))
  if (added.length) {
    persist(userId, [...records, ...added])
  }
  void retryReadingRecords()
}

export async function retryReadingRecords(explicit = false) {
  const userId = useAuthStore.getState().user?.id
  if (!userId || inFlight.has(userId)) return
  if (explicit) rejected.delete(userId)
  inFlight.add(userId)
  try {
    // Closed tabs cannot run their grace timeout. Recover only expired snapshots.
    const prefixes = [`bd-reading-manual:${userId}:`, `bd-reading-auto:${userId}:`]
    try {
      for (const key of Object.keys(localStorage).filter((item) => prefixes.some((prefix) => item.startsWith(prefix)))) {
        const sessions = JSON.parse(localStorage.getItem(key) ?? '{}')
        if (sessions?.source === 'auto' && sessions.requestId) {
          if (sessions.durationSeconds >= 60) queueReadingRecord(userId, sessions)
          localStorage.removeItem(key)
          continue
        }
        let changed = false
        for (const [bookId, value] of Object.entries(sessions)) {
          const item = value as { userId?: string; phase?: string; expiresAt?: number; pendingRecord?: ReadingRecordCreateReq }
          if (item.userId !== userId || item.phase !== 'suspended' || !item.expiresAt || item.expiresAt > Date.now()) continue
          if (item.pendingRecord?.requestId && (item.pendingRecord.source !== 'auto' || item.pendingRecord.durationSeconds >= 60)) queueReadingRecord(userId, item.pendingRecord)
          delete sessions[bookId]
          changed = true
        }
        if (changed) localStorage.setItem(key, JSON.stringify(sessions))
      }
    } catch {
      useReadingSaveState.setState({ storageFailed: true })
    }
    useReadingSaveState.setState({ pending: read(userId).length })
    for (const record of [...read(userId)]) {
      if (useAuthStore.getState().user?.id !== userId) break
      const identity = record.requestId ?? JSON.stringify(record)
      if (rejected.get(userId)?.has(identity)) {
        useReadingSaveState.setState({ saveFailed: true })
        continue
      }
      try {
        await apiPost(withReveal('/reading-records'), { ...record, expectedUserId: userId })
      } catch (error) {
        // The durable entry remains available for explicit or online retries.
        if (useAuthStore.getState().user?.id === userId) useReadingSaveState.setState({ saveFailed: true })
        if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
          const failed = rejected.get(userId) ?? new Set<string>()
          failed.add(identity)
          rejected.set(userId, failed)
          continue
        }
        break
      }
      persist(userId, read(userId).filter((item) => item.requestId !== record.requestId))
      if (useAuthStore.getState().user?.id === userId) {
        void queryClient.invalidateQueries({ queryKey: ['reading-records'] })
        void queryClient.invalidateQueries({ queryKey: ['progress', record.bookId], refetchType: 'none' })
      }
    }
  } finally {
    inFlight.delete(userId)
  }
}

export function newReadingRequestId() {
  return crypto.randomUUID()
}

export function readingTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

if (typeof window !== 'undefined') {
  void retryReadingRecords()
  window.addEventListener('online', () => void retryReadingRecords())
  window.setInterval(() => void retryReadingRecords(), 30_000)
  useAuthStore.subscribe((state, previous) => {
    if (state.user?.id === previous.user?.id) return
    useReadingSaveState.setState({ pending: 0, saveFailed: false, storageFailed: false })
    void retryReadingRecords()
  })
}
