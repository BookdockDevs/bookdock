import { manualSessionRecord } from '../reader/lib/manual-timer-controller'
import { localTimerCaptureGroup } from './reading-capture-group'
import { LocalLibraryRepository, localLibraryRepository } from './repository'

const active = new WeakMap<LocalLibraryRepository, Map<string, { requested: boolean; promise: Promise<void> }>>()

export function flushLocalReadingOutbox(vaultId: string, repository = localLibraryRepository): Promise<void> {
  let vaults = active.get(repository)
  if (!vaults) { vaults = new Map(); active.set(repository, vaults) }
  const prior = vaults.get(vaultId)
  if (prior) { prior.requested = true; return prior.promise }
  const run = { requested: true, promise: Promise.resolve() }
  vaults.set(vaultId, run)
  run.promise = (async () => {
    do {
      run.requested = false
      let failure: unknown
      for (const snapshot of await repository.listManualTimerSnapshots(vaultId)) {
        if (snapshot.phase !== 'suspended' || snapshot.expiresAt === null || snapshot.expiresAt > Date.now()) continue
        try {
          const record = manualSessionRecord({ ...snapshot, bookId: snapshot.book.bookId })
          if (record) await repository.enqueueReadingCaptureGroup(localTimerCaptureGroup(snapshot.book, record), snapshot.updatedAt)
          else await repository.acknowledgeManualTimerSnapshot(snapshot)
        } catch (error) { failure ??= error }
      }
      for (const draft of await repository.listReadingTimerDrafts(vaultId)) {
        if (draft.phase !== 'queued' && draft.expiresAt > Date.now()) continue
        try {
          if (draft.capture.source !== 'auto' || draft.capture.durationSeconds >= 60) await repository.enqueueReadingCapture(draft.capture)
          await repository.acknowledgeReadingTimerDraft(draft)
        } catch (error) {
          failure ??= error
        }
      }
      for (const capture of await repository.listPendingReadingCaptures(vaultId)) {
        try {
          await repository.writeReadingSession(capture)
          await repository.acknowledgeReadingCapture(capture.book, capture.requestId)
        } catch (error) {
          failure ??= error
        }
      }
      for (const group of await repository.listPendingReadingCaptureGroups(vaultId)) {
        try {
          await repository.commitReadingCaptureGroup(group)
          await repository.acknowledgeReadingCaptureGroup(group.book, group.id)
        } catch (error) {
          failure ??= error
        }
      }
      if (failure) throw failure
    } while (run.requested)
  })().finally(() => { if (vaults.get(vaultId) === run) vaults.delete(vaultId) })
  return run.promise
}
