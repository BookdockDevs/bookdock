import { clientManualTimerSnapshotSchema, type ClientBookRef, type ClientReadingEntry, type ClientReadingGroupEntry, type ClientManualTimerSnapshot, type ReadingRecordCreateReq } from '@bookdock/shared'

import { createManualTimerStore, type ManualSession, type ManualTimerSnapshot } from '../reader/lib/manual-timer-controller'
import { newReadingRequestId, readingTimezone } from '../reader/lib/reading-record-queue'
import { readingDeviceId } from '../reader/lib/reading-timer-lease'
import { localTimerDestination } from './automatic-timer'
import { LocalLibraryRepository, localLibraryRepository } from './repository'

export function createLocalManualTimer(vaultId: string, repository: LocalLibraryRepository = localLibraryRepository) {
  const deviceId = readingDeviceId()
  const bookRef = (bookId: string): ClientBookRef => ({ scope: { kind: 'local', vaultId }, bookId })
  const durable = new Map<string, ClientManualTimerSnapshot>()
  const pending = new Map<string, { session: ManualSession; record: ReadingRecordCreateReq; updatedAt: number }>()
  let latest: Record<string, ClientManualTimerSnapshot> = {}
  let writes = Promise.resolve()
  function ordered(operation: () => Promise<void>) {
    const result = writes.then(operation)
    writes = result.catch(() => {})
    return result
  }
  function reportError() { controller.useStore.setState({ storageError: true }) }
  function snapshot(value: ManualTimerSnapshot): ClientManualTimerSnapshot {
    const { bookId: _bookId, userId: _userId, pendingRecord: _record, ...fields } = value
    return clientManualTimerSnapshotSchema.parse({ ...fields, updatedAt: Date.now() })
  }
  async function persist(requested: Record<string, ClientManualTimerSnapshot>) {
    for (const value of Object.values(requested)) {
      if (pending.has(value.requestId)) continue
      if (!await repository.saveManualTimerSnapshot(value)) throw new Error('A newer manual timer owns this snapshot')
      durable.set(value.book.bookId, value)
    }
    for (const [bookId, value] of durable) {
      if (requested[bookId] || pending.has(value.requestId)) continue
      await repository.acknowledgeManualTimerSnapshot(value)
      if (durable.get(bookId) === value) durable.delete(bookId)
    }
  }
  async function finalize(value: { session: ManualSession; record: ReadingRecordCreateReq; updatedAt: number }) {
    const sink = localTimerDestination(bookRef(value.session.bookId), 'manual', reportError, repository)
    await sink.enqueue({ pendingRecord: value.record, phase: 'queued', suspendedAt: value.updatedAt, expiresAt: value.updatedAt, updatedAt: value.updatedAt })
    await sink.retry()
    pending.delete(value.session.requestId)
    if (durable.get(value.session.bookId)?.requestId === value.session.requestId) durable.delete(value.session.bookId)
  }
  function flush() {
    const requested = latest
    const captures = [...pending.values()]
    return ordered(async () => {
      for (const value of captures) if (pending.get(value.session.requestId) === value) await finalize(value)
      await persist(requested)
    })
  }
  const controller = createManualTimerStore({
    newRequestId: newReadingRequestId, timezone: readingTimezone, deviceId: () => deviceId,
    ownerKey: () => JSON.stringify(['local', vaultId, deviceId]),
    identity: (bookId) => ({ book: bookRef(bookId) }),
    isCurrent: (session) => session.book?.scope.kind === 'local' && session.book.scope.vaultId === vaultId,
    async load() {
      await writes
      const values = (await repository.listManualTimerSnapshots(vaultId)).filter((value) => value.deviceId === deviceId)
      for (const value of values) durable.set(value.book.bookId, value)
      latest = Object.fromEntries(values.map((value) => [value.book.bookId, value]))
      return Object.fromEntries(values.map((value) => {
        const { updatedAt: _updatedAt, expiresAt: _expiresAt, ...session } = value
        return [value.book.bookId, { ...session, bookId: value.book.bookId }]
      }))
    },
    persist(sessions) {
      const requested = Object.fromEntries(Object.entries(sessions).map(([id, value]) => [id, snapshot(value)]))
      latest = requested
      return ordered(() => persist(requested))
    },
    claim: (_session, explicit) => repository.claimReadingTimer(vaultId, { deviceId, mode: 'manual', activityAt: Date.now(), explicit }),
    release: () => { void repository.releaseReadingTimer(vaultId, deviceId, Date.now()).catch(reportError) },
    enqueue(session, record) {
      const value = { session, record, updatedAt: Date.now() }
      pending.set(session.requestId, value)
      void ordered(() => finalize(value)).catch(reportError)
    },
    retry: flush,
    onError: reportError,
  })
  return { ...controller, flush,
    async saveEntry(entry: ClientReadingEntry | ClientReadingGroupEntry) {
      const book = 'capture' in entry ? entry.capture.book : entry.group.book
      const requestId = 'capture' in entry ? entry.capture.requestId : entry.group.id
      await ordered(async () => {
        const snapshot = durable.get(book.bookId)
        const expected = snapshot?.requestId === requestId ? { expectedManualUpdatedAt: snapshot.updatedAt } : {}
        if ('capture' in entry) await repository.addReadingEntry({ ...entry, ...expected })
        else await repository.addReadingGroupEntry({ ...entry, ...expected })
        if (snapshot?.requestId === requestId) {
          durable.delete(book.bookId)
          controller.useStore.getState().discard(book.bookId)
        }
      })
    },
  }
}


const timers = new Map<string, ReturnType<typeof createLocalManualTimer>>()
export function localManualTimer(vaultId: string) {
  let timer = timers.get(vaultId)
  if (!timer) { timer = createLocalManualTimer(vaultId); timers.set(vaultId, timer) }
  return timer
}
