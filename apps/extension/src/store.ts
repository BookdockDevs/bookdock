import { t } from './i18n'
import { CHUNK_BYTES, JOB_LIFETIME_MS, LEASE_MS, TRANSFER_TIMEOUT_MS, canRetry, validateFile } from './model'
import type { Chunk, Connection, UploadJob, UploadResult } from './model'

let opening: Promise<IDBDatabase> | undefined

function database(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('bookdock-extension', 1)
    // `blocked` rejects first but the open can still complete afterwards; without the flag that
    // connection would be handed to a promise nobody holds and never closed.
    let rejected = false
    request.onupgradeneeded = () => {
      request.result.createObjectStore('settings')
      request.result.createObjectStore('jobs', { keyPath: 'id' })
      request.result.createObjectStore('chunks', { keyPath: ['jobId', 'index'] })
    }
    request.onsuccess = () => {
      if (rejected) { request.result.close(); return }
      request.result.onversionchange = () => { request.result.close(); opening = undefined }
      resolve(request.result)
    }
    request.onerror = () => { rejected = true; opening = undefined; reject(new Error(t('error.storageUnavailable'))) }
    request.onblocked = () => { rejected = true; opening = undefined; reject(new Error(t('error.storageUnavailable'))) }
  })
  return opening
}

/** Storage failures are reported in the user's language; the driver's own text is English. */
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error(t('error.storageUnavailable')))
  })
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await database()
  const tx = db.transaction(stores, mode)
  const complete = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error(t('error.storageUnavailable')))
    tx.onerror = () => {}
  })
  // Attach immediately: a request may abort before its rejection is observed.
  void complete.catch(() => {})
  try {
    const value = await operation(tx)
    await complete
    return value
  } catch (error) {
    try { tx.abort() } catch { /* The transaction may already have aborted. */ }
    await complete.catch(() => {})
    throw error
  }
}

function chunkRange(id: string): IDBKeyRange {
  return IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])
}

export async function getConnection(): Promise<Connection | undefined> {
  return transaction(['settings'], 'readonly', (tx) => result<Connection | undefined>(tx.objectStore('settings').get('connection')))
}

export async function saveConnection(connection: Connection): Promise<void> {
  await transaction(['settings'], 'readwrite', async (tx) => { await result(tx.objectStore('settings').put(connection, 'connection')) })
}

export async function disconnect(): Promise<void> {
  await transaction(['settings', 'jobs', 'chunks'], 'readwrite', async (tx) => {
    tx.objectStore('settings').delete('connection')
    tx.objectStore('jobs').clear()
    tx.objectStore('chunks').clear()
  })
}

export async function getJob(id: string): Promise<UploadJob | undefined> {
  return transaction(['jobs'], 'readonly', (tx) => result<UploadJob | undefined>(tx.objectStore('jobs').get(id)))
}

export async function listJobs(): Promise<UploadJob[]> {
  return transaction(['jobs'], 'readonly', (tx) => result<UploadJob[]>(tx.objectStore('jobs').getAll()))
}

export async function createJob(connection: Connection, name: string, size: number, sourceTabId: number | null, sourceFrameId = 0): Promise<UploadJob> {
  validateFile(name, size, connection.uploadMaxBytes)
  return (await createJobs(connection, [{ name, size }], { sourceTabId, sourceFrameId }))[0]!
}

export async function createJobs(connection: Connection, files: { name: string; size: number }[], options: { sourceTabId: number | null; sourceFrameId?: number; batchId?: string; autoStart?: boolean; notices?: { ignored: number; oversized: number } }): Promise<UploadJob[]> {
  if (!files.length || files.length > 2000) throw new Error(t('error.generic'))
  for (const file of files) {
    if (file.size === 0) validateFile(file.name, 1, connection.uploadMaxBytes)
    else validateFile(file.name, file.size, connection.uploadMaxBytes)
  }
  await sweepJobs()
  const batchId = options.batchId ?? crypto.randomUUID()
  const additions: UploadJob[] = files.map((file, index) => ({
    id: crypto.randomUUID(), batchId, name: file.name, size: file.size, connectionId: connection.id,
    sourceTabId: options.sourceTabId, sourceFrameId: options.sourceFrameId ?? 0,
    createdAt: Date.now(), updatedAt: Date.now(), received: 0, chunkCount: 0,
    state: file.size ? 'receiving' : 'failed', error: file.size ? undefined : t('error.generic'),
    autoStart: options.autoStart !== false,
    ...(index === 0 && options.notices ? { batchNotices: options.notices } : {}),
  }))
  await transaction(['settings', 'jobs'], 'readwrite', async (tx) => {
    const current = await result<Connection | undefined>(tx.objectStore('settings').get('connection'))
    if (!current || current.id !== connection.id) throw new Error(t('error.connChanged'))
    const jobs = await result<UploadJob[]>(tx.objectStore('jobs').getAll())
    // Only live batches count. Finished ones linger for 24h for the popup's history list, and
    // counting those turned the fifth drop of the day into "try again" — advice that never works.
    const live = new Set(jobs.filter((job) => !['success', 'duplicate', 'failed'].includes(job.state)).map((job) => job.batchId))
    if (!options.batchId && live.size >= 4) throw new Error(t('error.tooManyBatches'))
    if (jobs.some((job) => job.batchId === batchId && job.connectionId !== connection.id)) throw new Error(t('error.connChanged'))
    const offset = jobs.filter((job) => job.batchId === batchId).length
    for (const [index, job] of additions.entries()) { job.order = offset + index; tx.objectStore('jobs').add(job) }
  })
  return additions
}

export async function appendChunk(id: string, index: number, bytes: Uint8Array<ArrayBuffer>, owner?: { tabId: number; frameId: number }): Promise<void> {
  if (!Number.isSafeInteger(index) || index < 0 || !bytes.length || bytes.length > CHUNK_BYTES) throw new Error(t('error.generic'))
  await transaction(['settings', 'jobs', 'chunks'], 'readwrite', async (tx) => {
    const job = await result<UploadJob | undefined>(tx.objectStore('jobs').get(id))
    const connection = await result<Connection | undefined>(tx.objectStore('settings').get('connection'))
    if (!job || job.state !== 'receiving') throw new Error(t('error.transferLost'))
    if (owner ? job.sourceTabId !== owner.tabId || job.sourceFrameId !== owner.frameId : job.sourceTabId !== null) throw new Error(t('error.generic'))
    if (!connection || connection.id !== job.connectionId) throw new Error(t('error.connChanged'))
    if (index !== job.chunkCount || job.received + bytes.length > job.size) throw new Error(t('error.generic'))
    tx.objectStore('chunks').add({ jobId: id, index, blob: new Blob([bytes]) } satisfies Chunk)
    tx.objectStore('jobs').put({ ...job, received: job.received + bytes.length, chunkCount: index + 1, updatedAt: Date.now() })
  })
}

export async function finishTransfer(id: string, owner?: { tabId: number; frameId: number }): Promise<void> {
  await transaction(['settings', 'jobs'], 'readwrite', async (tx) => {
    const job = await result<UploadJob | undefined>(tx.objectStore('jobs').get(id))
    const connection = await result<Connection | undefined>(tx.objectStore('settings').get('connection'))
    if (!job || job.state !== 'receiving' || job.received !== job.size) throw new Error(t('error.transferLost'))
    if (owner ? job.sourceTabId !== owner.tabId || job.sourceFrameId !== owner.frameId : job.sourceTabId !== null) throw new Error(t('error.generic'))
    if (!connection || connection.id !== job.connectionId) throw new Error(t('error.connChanged'))
    tx.objectStore('jobs').put({ ...job, state: job.autoStart !== false ? 'ready' : 'pending', updatedAt: Date.now() })
  })
}

export async function claimJob(id: string, lease: string): Promise<{ job: UploadJob; file: File; connection: Connection }> {
  return transaction(['settings', 'jobs', 'chunks'], 'readwrite', async (tx) => {
    const job = await result<UploadJob | undefined>(tx.objectStore('jobs').get(id))
    const connection = await result<Connection | undefined>(tx.objectStore('settings').get('connection'))
    if (!job || job.received !== job.size || !['ready', 'failed', 'uploading'].includes(job.state)) throw new Error(t('error.transferLost'))
    if (!connection || job.connectionId !== connection.id) throw new Error(t('error.connChanged'))
    if (job.state === 'uploading' && (job.leaseUntil ?? 0) > Date.now()) throw new Error(t('error.generic'))
    const chunks = await result<Chunk[]>(tx.objectStore('chunks').getAll(chunkRange(id)))
    if (chunks.length !== job.chunkCount || chunks.some((chunk, index) => chunk.index !== index)) throw new Error(t('error.transferLost'))
    const file = new File(chunks.map((chunk) => chunk.blob), job.name, { type: job.name.toLowerCase().endsWith('.epub') ? 'application/epub+zip' : 'text/plain' })
    if (file.size !== job.size) throw new Error(t('error.transferLost'))
    tx.objectStore('jobs').put({ ...job, state: 'uploading', lease, leaseUntil: Date.now() + LEASE_MS, updatedAt: Date.now(), error: undefined })
    return { job, file, connection }
  })
}

export async function renewLease(id: string, lease: string): Promise<boolean> {
  return transaction(['settings', 'jobs'], 'readwrite', async (tx) => {
    const job = await result<UploadJob | undefined>(tx.objectStore('jobs').get(id))
    const connection = await result<Connection | undefined>(tx.objectStore('settings').get('connection'))
    if (!job || job.lease !== lease || job.state !== 'uploading' || connection?.id !== job.connectionId) return false
    tx.objectStore('jobs').put({ ...job, leaseUntil: Date.now() + LEASE_MS, updatedAt: Date.now() })
    return true
  })
}

export async function failJob(id: string, lease: string, error: string, retryable = true): Promise<void> {
  await transaction(['jobs'], 'readwrite', async (tx) => {
    const job = await result<UploadJob | undefined>(tx.objectStore('jobs').get(id))
    if (job && (job.lease === lease || job.state === 'ready')) tx.objectStore('jobs').put({ ...job, state: 'failed', error, retryable: retryable ? undefined : false, lease: undefined, leaseUntil: undefined, updatedAt: Date.now() })
  })
}

export async function removeJob(id: string): Promise<void> {
  await transaction(['jobs', 'chunks'], 'readwrite', async (tx) => {
    tx.objectStore('jobs').delete(id)
    tx.objectStore('chunks').delete(chunkRange(id))
  })
}

export async function completeJob(id: string, lease: string, uploaded: UploadResult): Promise<void> {
  await transaction(['jobs', 'chunks'], 'readwrite', async (tx) => {
    const job = await result<UploadJob | undefined>(tx.objectStore('jobs').get(id))
    if (!job || job.lease !== lease || job.state !== 'uploading') throw new Error(t('error.generic'))
    tx.objectStore('jobs').put({ ...job, state: uploaded.duplicated ? 'duplicate' : 'success', result: uploaded, lease: undefined, leaseUntil: undefined, updatedAt: Date.now() })
    tx.objectStore('chunks').delete(chunkRange(id))
  })
}

export async function interruptTransfer(id: string): Promise<void> {
  await transaction(['jobs', 'chunks'], 'readwrite', async (tx) => {
    const job = await result<UploadJob | undefined>(tx.objectStore('jobs').get(id))
    if (job?.state !== 'receiving') return
    tx.objectStore('jobs').put({ ...job, state: 'failed', error: t('error.transferLost'), updatedAt: Date.now() })
    tx.objectStore('chunks').delete(chunkRange(id))
  })
}

/**
 * Move rows back into the uploader. Returns how many were actually requeued, so
 * a caller can tell "nothing left to retry" from "retrying".
 *
 * A failed row is only requeued when its bytes survived (see `canRetry`).
 * Requeueing the rest would put the row back into `ready`, wake the uploader,
 * and fail on the same check microseconds later: a visible no-op.
 */
export async function queueBatch(batchId: string, failedOnly = false, onlyId?: string): Promise<number> {
  return transaction(['settings', 'jobs'], 'readwrite', async (tx) => {
    const connection = await result<Connection | undefined>(tx.objectStore('settings').get('connection'))
    const jobs = await result<UploadJob[]>(tx.objectStore('jobs').getAll())
    let queued = 0
    for (const job of jobs) {
      if (job.batchId !== batchId || (onlyId && job.id !== onlyId)) continue
      if (failedOnly) {
        // No connection means no destination: requeueing would only bounce off claimJob.
        if (job.state !== 'failed' || !connection || !canRetry(job, connection.id)) continue
        tx.objectStore('jobs').put({ ...job, state: 'ready', error: undefined, retryable: undefined, autoStart: true, updatedAt: Date.now() })
        queued += 1
      } else if (job.state === 'pending') {
        tx.objectStore('jobs').put({ ...job, state: 'ready', error: undefined, autoStart: true, updatedAt: Date.now() })
        queued += 1
      } else if (job.state === 'receiving') tx.objectStore('jobs').put({ ...job, autoStart: true })
    }
    return queued
  })
}

export async function cancelBatch(batchId: string): Promise<void> {
  await transaction(['jobs', 'chunks'], 'readwrite', async (tx) => {
    const jobs = await result<UploadJob[]>(tx.objectStore('jobs').getAll())
    for (const job of jobs) {
      if (job.batchId !== batchId || ['success', 'duplicate', 'failed'].includes(job.state)) continue
      tx.objectStore('jobs').put({ ...job, state: 'failed', error: t('error.cancelled'), lease: undefined, leaseUntil: undefined, updatedAt: Date.now() })
      if (job.state === 'receiving') tx.objectStore('chunks').delete(chunkRange(job.id))
    }
  })
}

export async function removeBatch(batchId: string): Promise<void> {
  await transaction(['jobs', 'chunks'], 'readwrite', async (tx) => {
    const jobs = await result<UploadJob[]>(tx.objectStore('jobs').getAll())
    for (const job of jobs) if (job.batchId === batchId) {
      tx.objectStore('jobs').delete(job.id)
      tx.objectStore('chunks').delete(chunkRange(job.id))
    }
  })
}

export async function sweepJobs(closedTabId?: number): Promise<void> {
  await transaction(['jobs', 'chunks'], 'readwrite', async (tx) => {
    const jobs = await result<UploadJob[]>(tx.objectStore('jobs').getAll())
    const now = Date.now()
    for (const job of jobs) {
      if (now - job.createdAt > JOB_LIFETIME_MS) {
        tx.objectStore('jobs').delete(job.id)
        tx.objectStore('chunks').delete(chunkRange(job.id))
      } else if (job.state === 'receiving' && (now - job.updatedAt > TRANSFER_TIMEOUT_MS || job.sourceTabId === closedTabId)) {
        tx.objectStore('jobs').put({ ...job, state: 'failed', error: t('error.transferLost'), updatedAt: now })
        tx.objectStore('chunks').delete(chunkRange(job.id))
      } else if (job.state === 'uploading' && (job.leaseUntil ?? 0) <= now) {
        tx.objectStore('jobs').put({ ...job, state: 'failed', lease: undefined, leaseUntil: undefined, error: t('error.generic'), updatedAt: now })
      }
    }
  })
}
