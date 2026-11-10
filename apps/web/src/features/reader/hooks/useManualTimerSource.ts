import { localManualTimer } from '@/features/local-library/manual-timer'
import { deviceScope } from '@/features/reading-data/book-source'
import { useLocalReader } from '@/features/reading-data/reader-source-context'

import { useManualTimerStore } from '../lib/manual-timer-store'

export function useManualTimerSource() {
  const local = useLocalReader()
  const scope = deviceScope(local?.ref)
  return scope ? localManualTimer(scope.vaultId).useStore : useManualTimerStore
}
