import { useUiStore } from '@/stores/ui.store'

export function readingTimerGraceExpiresAt(suspendedAt: number): number {
  return suspendedAt + useUiStore.getState().manualTimerGraceMinutes * 60_000
}
