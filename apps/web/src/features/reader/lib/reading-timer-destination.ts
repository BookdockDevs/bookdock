import type { ReadingRecordCreateReq } from '@bookdock/shared'

export interface ReadingTimerSnapshot {
  pendingRecord: ReadingRecordCreateReq
  phase: 'suspended' | 'queued'
  suspendedAt: number
  expiresAt: number
  updatedAt: number
}

export interface ReadingTimerDestination {
  readonly scopeKey: string
  loadDraft(): Promise<ReadingTimerSnapshot | undefined>
  saveDraft(snapshot: ReadingTimerSnapshot): Promise<void>
  enqueue(snapshot: ReadingTimerSnapshot): Promise<void>
  retry(): Promise<void>
  claim(activityAt: number): Promise<boolean>
  release(activityAt: number): Promise<void>
  onError(error: unknown): void
}
