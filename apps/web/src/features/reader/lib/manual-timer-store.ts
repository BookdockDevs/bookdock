import { useAuthStore } from '@/stores/auth.store'

import { createManualTimerStore, type ManualSession } from './manual-timer-controller'
import { newReadingRequestId, queueReadingRecord, readingTimezone, retryReadingRecords, useReadingSaveState } from './reading-record-queue'
import { claimReadingTimer, readingDeviceId, releaseReadingTimer } from './reading-timer-lease'

export { graceLeftMs, sessionDurationMs } from './manual-timer-controller'
export type { ManualSession, ManualTimerPhase, ManualTimerSummary } from './manual-timer-controller'

const key = (userId: string) => `bd-reading-manual:${userId}:${readingDeviceId()}`
const controller = createManualTimerStore({
  newRequestId: newReadingRequestId, timezone: readingTimezone, deviceId: readingDeviceId,
  ownerKey: () => useAuthStore.getState().user?.id ?? null,
  identity: () => { const userId = useAuthStore.getState().user?.id; return userId ? { userId } : null },
  isCurrent: (session) => session.userId !== undefined && session.userId === useAuthStore.getState().user?.id,
  load() {
    const userId = useAuthStore.getState().user?.id
    if (!userId) return {}
    const stored = JSON.parse(localStorage.getItem(key(userId)) ?? '{}')
    return Object.fromEntries(Object.entries(stored).filter(([, value]) => {
      const session = value as ManualSession
      return session.userId === userId && Array.isArray(session.fragments) && typeof session.requestId === 'string'
    })) as Record<string, ManualSession>
  },
  persist(sessions) {
    const userId = useAuthStore.getState().user?.id
    if (userId) localStorage.setItem(key(userId), JSON.stringify(sessions))
  },
  claim: (_session, explicit) => claimReadingTimer('manual', explicit),
  release: (session) => { if (session.userId === useAuthStore.getState().user?.id) releaseReadingTimer() },
  enqueue: (session, record) => { if (session.userId) queueReadingRecord(session.userId, record, true) },
  retry: () => retryReadingRecords(true),
  onError: () => useReadingSaveState.setState({ storageFailed: true }),
})

export const useManualTimerStore = controller.useStore
export const resetManualTimerTicker = controller.resetTicker
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) void useManualTimerStore.getState().restore()
})
