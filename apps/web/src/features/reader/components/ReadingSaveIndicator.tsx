import { useTranslation } from '@/hooks/useTranslation'

import { retryReadingRecords, useReadingSaveState } from '../lib/reading-record-queue'

export default function ReadingSaveIndicator() {
  const _ = useTranslation()
  const pending = useReadingSaveState((state) => state.pending)
  const saveFailed = useReadingSaveState((state) => state.saveFailed)
  const storageFailed = useReadingSaveState((state) => state.storageFailed)
  if (!(pending && saveFailed) && !storageFailed) return null
  return (
    <button
      type="button"
      onClick={() => void retryReadingRecords(true)}
      className="pointer-events-auto max-w-48 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800"
      aria-live="polite"
    >
      {_(storageFailed ? 'reader.readingSaveStorageFailed' : 'reader.readingSavePending')}
    </button>
  )
}
