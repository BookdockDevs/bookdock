import { clientReadingCaptureSchema, sameClientBook, type ClientBookRef, type ClientReadingTimerDraft } from '@bookdock/shared'

import { readingDeviceId } from '../reader/lib/reading-timer-lease'
import type { ReadingTimerDestination, ReadingTimerSnapshot } from '../reader/lib/reading-timer-destination'
import { flushLocalReadingOutbox } from './reading-outbox'
import { localTimerCaptureGroup } from './reading-capture-group'
import { LocalLibraryRepository, localLibraryRepository } from './repository'

export function localAutomaticTimerDestination(book: ClientBookRef, onError: (error: unknown) => void, repository: LocalLibraryRepository = localLibraryRepository): ReadingTimerDestination {
  return localTimerDestination(book, 'auto', onError, repository)
}

export function localTimerDestination(book: ClientBookRef, source: 'auto' | 'manual', onError: (error: unknown) => void, repository: LocalLibraryRepository = localLibraryRepository): ReadingTimerDestination {
  if (book.scope.kind !== 'local') throw new Error('Local timer requires a local book')
  const vaultId = book.scope.vaultId
  let writes = Promise.resolve()
  let latestDraft: ReadingTimerSnapshot | undefined
  const pending = new Map<string, ReadingTimerSnapshot>()
  function ordered<T>(operation: () => Promise<T>): Promise<T> {
    const result = writes.then(operation)
    writes = result.then(() => {}, () => {})
    return result
  }
  function draft(snapshot: ReadingTimerSnapshot): ClientReadingTimerDraft {
    const { bookId, expectedUserId, replaceSessionIds, finished, ...capture } = snapshot.pendingRecord
    if (capture.source !== source || bookId !== book.bookId || expectedUserId !== undefined || replaceSessionIds !== undefined || finished !== undefined) throw new Error('Timer capture belongs to a different operation')
    return {
      capture: clientReadingCaptureSchema.parse({ ...capture, book }), phase: snapshot.phase,
      suspendedAt: snapshot.suspendedAt, expiresAt: snapshot.expiresAt, updatedAt: snapshot.updatedAt,
    }
  }
  const retry = () => flushLocalReadingOutbox(vaultId, repository)
  async function finalize(snapshot: ReadingTimerSnapshot) {
    if (snapshot.pendingRecord.source !== source) throw new Error('Timer source changed before finalization')
    const id = snapshot.pendingRecord.requestId!
    await repository.enqueueReadingCaptureGroup(localTimerCaptureGroup(book, snapshot.pendingRecord), snapshot.updatedAt)
    pending.delete(id)
    if (latestDraft?.pendingRecord.requestId === id) latestDraft = undefined
  }
  return {
    scopeKey: JSON.stringify(['local', vaultId]), onError,
    retry() {
      const requested = [...pending.values()]
      const requestedDraft = latestDraft
      return ordered(async () => {
        for (const snapshot of requested) if (pending.get(snapshot.pendingRecord.requestId!) === snapshot) await finalize(snapshot)
        if (requestedDraft && latestDraft === requestedDraft && !pending.has(requestedDraft.pendingRecord.requestId!)) {
          if (!await repository.saveReadingTimerDraft(draft(requestedDraft))) throw new Error('A newer timer draft owns this capture')
          if (latestDraft === requestedDraft) latestDraft = undefined
        }
        await retry()
      })
    },
    async loadDraft() {
      await writes
      const stored = (await repository.listReadingTimerDrafts(vaultId)).find((entry) => entry.capture.source === source && sameClientBook(entry.capture.book, book))
      if (!stored) return undefined
      if (stored.phase === 'queued' || stored.expiresAt <= Date.now()) {
        if (source === 'manual' || stored.capture.durationSeconds >= 60) await repository.enqueueReadingCapture(stored.capture)
        await repository.acknowledgeReadingTimerDraft(stored)
        void retry().catch(onError)
        return undefined
      }
      const { book: _book, ...capture } = stored.capture
      return { pendingRecord: { ...capture, bookId: book.bookId }, phase: stored.phase, suspendedAt: stored.suspendedAt, expiresAt: stored.expiresAt, updatedAt: stored.updatedAt }
    },
    saveDraft(snapshot) {
      latestDraft = snapshot
      return ordered(async () => {
        if (!await repository.saveReadingTimerDraft(draft(snapshot))) throw new Error('A newer timer draft owns this capture')
        if (latestDraft === snapshot) latestDraft = undefined
      })
    },
    enqueue(snapshot) {
      pending.set(snapshot.pendingRecord.requestId!, snapshot)
      return ordered(async () => { await finalize(snapshot); void retry().catch(onError) })
    },
    claim: (activityAt) => repository.claimReadingTimer(vaultId, { deviceId: readingDeviceId(), mode: source, activityAt }),
    release: (activityAt) => repository.releaseReadingTimer(vaultId, readingDeviceId(), activityAt),
  }
}
