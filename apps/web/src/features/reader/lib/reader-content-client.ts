import {
  READER_MANIFEST_FORMAT_VERSION,
  READER_TEXT_BATCH_MAX_BYTES,
  READER_TEXT_BATCH_MAX_ENTRIES,
  READER_TEXT_ENTRY_MAX_BYTES,
  readerMarkupEntryResponseSchema,
  readerManifestSchema,
  readerTextBatchResSchema,
  type ReaderManifest,
  type ReaderManifestEntry,
  type ReaderTextBatchRes,
} from '@bookdock/shared'

import {
  idbChapterTextStore,
  idbReaderBlobStore,
  READER_CONTENT_BUDGET_BYTES,
} from './idb-chapter-store'
import type { ChapterTextEntry } from './chapter-text-cache'
import {
  assertSessionEpoch,
  getContentAccountScope,
  getSessionEpoch,
  onSessionScopeChange,
  ReaderSessionChangedError,
} from '@/lib/session-scope'

const TEXT_MEMORY_BUDGET = 32 * 1024 * 1024
const TEXT_MEMORY_MAX_ENTRIES = 128
const BLOB_MEMORY_BUDGET = 32 * 1024 * 1024
const BLOB_MEMORY_MAX_ENTRIES = 128

// Markup derivation can change without changing the source revision or wire schema.
const MARKUP_CACHE_VERSION = 3
const preparedTextHandoff = new Map<string, string>()

export function primeReaderContentText(manifest: ReaderManifest, accountScope: string, path: string, text: string): void {
  preparedTextHandoff.clear()
  const prefix = `${accountScope}|${manifest.bookId}|${manifest.revisionId}|v${manifest.formatVersion}|markup-v${MARKUP_CACHE_VERSION}`
  preparedTextHandoff.set(`${prefix}|resource-dimensions|${path}`, text)
  preparedTextHandoff.set(`${prefix}|no-resource-dimensions|${path}`, text)
}

export function clearPreparedReaderContentText(): void {
  preparedTextHandoff.clear()
}

const SCHEDULER_TOTAL = 6
const SCHEDULER_BACKGROUND = 2
const SCHEDULER_SEARCH = 2
const SCHEDULER_NON_FOREGROUND_BYTES = 8 * 1024 * 1024
const READER_REQUEST_TIMEOUT_MS = 30_000
const TEXT_WINDOW_TARGET_BYTES = 256 * 1024
const TEXT_WINDOW_MAX_FILES = 16

export type ReaderContentPriority = 'foreground' | 'search' | 'background'

export class ReaderContentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ReaderContentError'
  }
}

interface ScheduledTask {
  key: string
  priority: ReaderContentPriority
  size: number
  sequence: number
  run: (signal: AbortSignal) => Promise<unknown>
  controller: AbortController
  consumers: Set<() => void>
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

class ReaderPrefetchSupersededError extends Error {
  constructor() {
    super('Reader prefetch window was superseded')
    this.name = 'ReaderPrefetchSupersededError'
  }
}

class ReaderContentScheduler {
  private queue: ScheduledTask[] = []
  private pending = new Map<string, ScheduledTask>()
  private active = 0
  private activeBackground = 0
  private activeSearch = 0
  private nonForegroundBytes = 0
  private sequence = 0
  private draining = false

  hasPending(key: string): boolean {
    return this.pending.has(key)
  }

  private subscribe<T>(task: ScheduledTask, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Reader request was cancelled', 'AbortError'))
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const release = () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        task.consumers.delete(release)
        if (task.consumers.size === 0 && this.pending.get(task.key) === task) {
          this.pending.delete(task.key)
          const queuedIndex = this.queue.indexOf(task)
          if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1)
          const reason = new DOMException('Reader request has no remaining consumers', 'AbortError')
          task.controller.abort(reason)
          if (queuedIndex >= 0) task.reject(reason)
          this.drain()
        }
      }
      const onAbort = () => {
        release()
        reject(signal?.reason ?? new DOMException('Reader request was cancelled', 'AbortError'))
      }
      task.consumers.add(release)
      signal?.addEventListener('abort', onAbort, { once: true })
      task.promise.then(
        (value) => { if (!settled) { release(); resolve(value as T) } },
        (error) => { if (!settled) { release(); reject(error) } },
      )
    })
  }

  cancelQueuedBackground(): void {
    const cancelled = this.queue.filter((task) => task.priority === 'background')
    if (cancelled.length === 0) return
    this.queue = this.queue.filter((task) => task.priority !== 'background')
    for (const task of cancelled) {
      if (this.pending.get(task.key) === task) this.pending.delete(task.key)
      task.controller.abort(new ReaderPrefetchSupersededError())
      task.reject(new ReaderPrefetchSupersededError())
    }
  }

  cancelQueued(): void {
    const cancelled = [...this.queue]
    this.queue = []
    for (const task of cancelled) {
      if (this.pending.get(task.key) === task) this.pending.delete(task.key)
      task.controller.abort(new ReaderPrefetchSupersededError())
      task.reject(new ReaderPrefetchSupersededError())
    }
  }

  abortAll(): void {
    this.cancelQueued()
    for (const task of this.pending.values()) {
      task.controller.abort(new DOMException('Reader session was destroyed', 'AbortError'))
    }
  }

  whenSettled(key: string): Promise<void> | undefined {
    const task = this.pending.get(key)
    return task?.promise.then(() => {}, () => {})
  }

  schedule<T>(key: string, priority: ReaderContentPriority, size: number, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const existing = this.pending.get(key)
    if (existing) {
      this.promote(key, priority)
      return this.subscribe<T>(existing, signal)
    }
    let resolveTask!: (value: T) => void
    let rejectTask!: (reason: unknown) => void
    const promise = new Promise<T>((resolve, reject) => {
      resolveTask = resolve
      rejectTask = reject
    })
    const task: ScheduledTask = {
      key,
      priority,
      size,
      sequence: this.sequence++,
      run,
      controller: new AbortController(),
      consumers: new Set(),
      promise: Promise.resolve(),
      resolve: resolveTask as (value: unknown) => void,
      reject: rejectTask,
    }
    task.promise = promise
    this.queue.push(task)
    this.pending.set(key, task)
    const consumer = this.subscribe<T>(task, signal)
    this.drain()
    return consumer
  }

  promote(key: string, priority: ReaderContentPriority): void {
    if (priority === 'background') return
    const task = this.queue.find((item) => item.key === key)
    if (!task) return
    if (priority === 'foreground' || task.priority === 'background') task.priority = priority
    this.drain()
  }

  private capacity(task: ScheduledTask): boolean {
    if (this.active >= SCHEDULER_TOTAL) return false
    if (task.priority === 'foreground') return true
    if (task.priority === 'search') {
      if (this.activeSearch >= SCHEDULER_SEARCH) return false
      return this.nonForegroundBytes + Math.min(task.size, SCHEDULER_NON_FOREGROUND_BYTES) <= SCHEDULER_NON_FOREGROUND_BYTES
    }
    if (this.activeBackground >= SCHEDULER_BACKGROUND) return false
    return this.nonForegroundBytes + Math.min(task.size, SCHEDULER_NON_FOREGROUND_BYTES) <= SCHEDULER_NON_FOREGROUND_BYTES
  }

  private drain(): void {
    if (this.draining) return
    this.draining = true
    try {
      this.queue.sort((a, b) => {
        const rank = { foreground: 0, search: 1, background: 2 } as const
        return rank[a.priority] - rank[b.priority] || a.sequence - b.sequence
      })
      let started = true
      while (started) {
        started = false
        for (let index = 0; index < this.queue.length; index += 1) {
          const task = this.queue[index]!
          if (!this.capacity(task)) continue
          this.queue.splice(index, 1)
          this.start(task)
          started = true
          break
        }
      }
    } finally {
      this.draining = false
    }
  }

  private start(task: ScheduledTask): void {
    this.active += 1
    if (task.priority === 'background') this.activeBackground += 1
    if (task.priority === 'search') this.activeSearch += 1
    const budgetBytes = task.priority === 'foreground' ? 0 : Math.min(task.size, SCHEDULER_NON_FOREGROUND_BYTES)
    if (task.priority !== 'foreground') this.nonForegroundBytes += budgetBytes
    const finish = (settle: (value: unknown) => void, value: unknown) => {
      this.active -= 1
      if (task.priority === 'background') this.activeBackground -= 1
      if (task.priority === 'search') this.activeSearch -= 1
      if (task.priority !== 'foreground') this.nonForegroundBytes -= budgetBytes
      // Remove before resolving: a consumer may schedule the same key again
      // immediately and must not receive this settled promise.
      if (this.pending.get(task.key) === task) this.pending.delete(task.key)
      task.consumers.clear()
      settle(value)
      this.drain()
    }
    Promise.resolve()
      .then(() => task.run(task.controller.signal))
      .then(
        (value) => finish(task.resolve, value),
        (error) => finish(task.reject, error),
      )
  }
}

function readerEndpointUrl(contentUrl: string, endpoint: 'manifest' | 'entry' | 'texts', params?: Record<string, string>): string {
  const [pathPart, query = ''] = contentUrl.split('?', 2)
  if (!pathPart) throw new ReaderContentError('READER_ENTRY_FAILED', 'Reader content URL is invalid')
  const search = new URLSearchParams(query)
  if (params) {
    for (const [key, value] of Object.entries(params)) search.set(key, value)
  }
  const path = pathPart.replace(/\/file$/, `/reader/${endpoint}`)
  return `${path}?${search.toString()}`
}

async function readErrorResponse(response: Response): Promise<ReaderContentError> {
  let code = `HTTP_${response.status}`
  let message = response.statusText || `HTTP ${response.status}`
  try {
    const body = await response.json() as { error?: { code?: unknown; message?: unknown } }
    if (typeof body.error?.code === 'string') code = body.error.code
    if (typeof body.error?.message === 'string') message = body.error.message
  } catch {
    // A missing API envelope (e.g. the route is not deployed) is classified by
    // status and handled by the caller's controlled fallback.
  }
  return new ReaderContentError(code, message, response.status)
}

function mediaTypeFromManifest(entry: ReaderManifestEntry | null): string {
  return entry?.mediaType ?? 'application/octet-stream'
}

function createManifestEntryMap(manifest: ReaderManifest): Map<string, ReaderManifestEntry> {
  const map = new Map<string, ReaderManifestEntry>()
  for (const entry of manifest.entries) {
    if (!map.has(entry.path)) map.set(entry.path, entry)
    const lower = entry.path.toLowerCase()
    if (!map.has(lower)) map.set(lower, entry)
  }
  return map
}

function unwrapCachedMarkupEnvelope(text: string): string {
  if (!text.startsWith('{"data":')) return text
  try {
    const parsed = readerMarkupEntryResponseSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data.data.text : text
  } catch {
    return text
  }
}

export async function fetchReaderManifest(contentUrl: string, signal?: AbortSignal): Promise<{ manifest: ReaderManifest; epoch: number; accountScope: string }> {
  const epoch = getSessionEpoch()
  const accountScope = getContentAccountScope()
  let payload: unknown
  try {
    payload = await fetchWithTimeout(readerEndpointUrl(contentUrl, 'manifest'), {
      credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
    }, async (response) => {
      if (!response.ok) throw await readErrorResponse(response)
      try {
        const body = await response.json() as { data?: ReaderManifest }
        if (!body.data) throw new Error('missing data')
        return body.data
      } catch (error) {
        if (error instanceof ReaderContentError && error.code === 'READER_NETWORK_ERROR') throw error
        if (error instanceof TypeError) throw error
        throw new ReaderContentError('READER_MANIFEST_INVALID', 'Reader manifest is invalid')
      }
    })
  } catch (error) {
    // Preserve classified server and validation errors; only the request
    // transport boundary is normalized by this catch.
    if (signal?.aborted) throw signal.reason ?? new DOMException('Reader manifest request was cancelled', 'AbortError')
    if (error instanceof ReaderContentError) throw error
    throw new ReaderContentError('READER_NETWORK_ERROR', 'Reader manifest request failed')
  }
  const parsed = readerManifestSchema.safeParse(payload)
  if (!parsed.success || parsed.data.formatVersion !== READER_MANIFEST_FORMAT_VERSION) {
    throw new ReaderContentError('READER_MANIFEST_INVALID', 'Reader manifest version is not supported')
  }
  assertSessionEpoch(epoch)
  return { manifest: parsed.data, epoch, accountScope }
}

export async function fetchLatestReaderManifest(contentUrl: string, signal?: AbortSignal) {
  const [pathPart, query = ''] = contentUrl.split('?', 2)
  if (!pathPart) throw new ReaderContentError('READER_ENTRY_FAILED', 'Reader content URL is invalid')
  const search = new URLSearchParams(query)
  search.delete('revisionId')
  return fetchReaderManifest(`${pathPart}?${search}`, signal)
}

async function fetchWithTimeoutOnce(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Reader request was cancelled', 'AbortError')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new DOMException('Reader request timed out', 'TimeoutError')), READER_REQUEST_TIMEOUT_MS)
  const signal = init.signal
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const finish = () => {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
  const translateError = (error: unknown): never => {
    if (controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError') {
      throw new ReaderContentError('READER_NETWORK_ERROR', 'Reader request timed out')
    }
    throw error
  }
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    return new Proxy(response, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (property === 'text' || property === 'json' || property === 'arrayBuffer') {
          return async () => {
            try { return await value.call(target) } catch (error) { return translateError(error) } finally { finish() }
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  } catch (error) {
    finish()
    return translateError(error)
  }
}

async function fetchWithTimeout<T>(input: RequestInfo | URL, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Reader request was cancelled', 'AbortError')
    try {
      const response = await fetchWithTimeoutOnce(input, init)
      return await consume(response)
    } catch (error) {
      const retryable = !init.signal?.aborted
        && (error instanceof TypeError
          || (error instanceof ReaderContentError && (
            error.code === 'READER_NETWORK_ERROR'
            || (error.status !== undefined && error.status >= 500 && error.code === `HTTP_${error.status}`)
          )))
      if (attempt === 0 && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Reader request was cancelled', 'AbortError')
        continue
      }
      throw error
    }
  }
}

function isReaderAccessRevoked(error: ReaderContentError): boolean {
  return error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN'
    || error.code === 'BOOK_NOT_FOUND' || error.code === 'BOOK_FILE_MISSING'
    || error.code === 'BOOK_NOT_ACCESSIBLE'
}

export function canFallbackReaderContent(error: unknown): boolean {
  if (error instanceof ReaderSessionChangedError) return false
  if (!(error instanceof ReaderContentError)) return false
  if (error.code === 'READER_ENTRY_FAILED' || error.code === 'READER_REVISION_CHANGED'
    || isReaderAccessRevoked(error)) return false
  if (error.status === undefined) return true
  if (error.status >= 500) return true
  // A missing new endpoint on an older server has no API envelope.
  if (error.status === 404 && error.code === 'HTTP_404') return true
  if (error.code === 'READER_MANIFEST_INVALID' || error.code === 'READER_NETWORK_ERROR') return true
  return false
}

interface TextMemoryEntry {
  text: string
  bytes: number
}

interface BatchWaiter {
  promise: Promise<void>
  resolve: () => void
  batchKey: string
  join: (priority: ReaderContentPriority, signal: AbortSignal) => Promise<void>
}

async function waitForSharedWork(promises: Promise<unknown>[], signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false
  let onAbort!: () => void
  const cancelled = new Promise<false>((resolve) => {
    onAbort = () => resolve(false)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    await Promise.race([Promise.all(promises).then(() => true as const), cancelled])
    return !signal.aborted
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export class ReaderContentSession {
  private resourcePrefetchFilter: ((mediaType: string, path: string) => boolean) | null = null
  private resourcePrefetchConsumers = new Map<string, AbortController>()
  private includeResourceDimensions: boolean
  readonly manifest: ReaderManifest
  readonly accountScope: string
  readonly epoch: number
  readonly namespace: string
  get textNamespace(): string {
    return `${this.namespace}|markup-v${MARKUP_CACHE_VERSION}|${this.includeResourceDimensions ? 'resource-dimensions' : 'no-resource-dimensions'}`
  }
  readonly source = 'manifest' as const
  private scheduler = new ReaderContentScheduler()
  private textMemory = new Map<string, TextMemoryEntry>()
  private textBytes = 0
  private blobMemory = new Map<string, { blob: Blob; bytes: number }>()
  private blobBytes = 0
  private startup = new Map<string, string>()
  private entryByPath: Map<string, ReaderManifestEntry>
  private batchWaiters = new Map<string, BatchWaiter>()
  private searchDepth = 0
  private prefetchGeneration = 0
  private prefetchController: AbortController | null = null
  private prefetchRun: Promise<void> = Promise.resolve()
  private destroyed = false
  private consumers = 0
  private accessRevoked = false
  private revisionChanged = false
  private revisionChangeListeners = new Set<(revisionId: string) => void>()
  private backgroundPaused = false
  private unsubscribeSessionScope: () => void = () => {}

  constructor(manifest: ReaderManifest, accountScope: string, epoch: number, contentUrl: string, cleanReadingRequested = false) {
    this.manifest = manifest
    this.accountScope = accountScope
    this.epoch = epoch
    this.namespace = `${accountScope}|${manifest.bookId}|${manifest.revisionId}|v${manifest.formatVersion}`
    this.includeResourceDimensions = !cleanReadingRequested
    this.contentUrl = contentUrl
    this.unsubscribeSessionScope = onSessionScopeChange(() => {
      if (getSessionEpoch() !== this.epoch) this.destroy()
    })
    this.entryByPath = createManifestEntryMap(manifest)
    for (const file of manifest.startupFiles) {
      this.startup.set(file.path, file.text)
      const lower = file.path.toLowerCase()
      if (!this.startup.has(lower)) this.startup.set(lower, file.text)
    }
    consumePreparedReaderContentText(this)
  }

  setResourcePrefetchFilter(filter: ((mediaType: string, path: string) => boolean) | null): void {
    this.resourcePrefetchFilter = filter
    const includeDimensions = filter === null
    if (this.includeResourceDimensions !== includeDimensions) {
      this.includeResourceDimensions = includeDimensions
      this.textMemory.clear()
      this.textBytes = 0
    }
    if (!filter) return
    for (const [path, controller] of this.resourcePrefetchConsumers) {
      const entry = this.manifestEntry(path)
      if (entry && filter(entry.mediaType, path)) controller.abort(new DOMException('Resource is excluded by the active reader mode', 'AbortError'))
    }
  }

  mediaUrl(path: string): string {
    this.assertReadable()
    const [pathPart, query = ''] = this.contentUrl.split('?', 2)
    const params = new URLSearchParams(query)
    params.set('path', path)
    params.set('revisionId', this.manifest.revisionId)
    return `${pathPart.replace(/\/file$/, '/reader/media')}?${params.toString()}`
  }

  private readonly contentUrl: string

  get size(): number {
    return this.manifest.size
  }

  get hasRevisionChanged(): boolean {
    return this.revisionChanged
  }

  onRevisionChanged(listener: (revisionId: string) => void): () => void {
    this.revisionChangeListeners.add(listener)
    return () => this.revisionChangeListeners.delete(listener)
  }

  retain(): () => void {
    this.assertReadable()
    this.consumers += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.consumers = Math.max(0, this.consumers - 1)
      if (this.consumers === 0) this.destroy()
    }
  }

  beginSearch(): void {
    this.searchDepth += 1
  }

  endSearch(): void {
    this.searchDepth = Math.max(0, this.searchDepth - 1)
  }

  private manifestEntry(path: string): ReaderManifestEntry | null {
    return this.entryByPath.get(path) ?? this.entryByPath.get(path.toLowerCase()) ?? null
  }

  private priority(requested: ReaderContentPriority): ReaderContentPriority {
    return requested === 'background' && this.searchDepth > 0 ? 'search' : requested
  }

  private assertCurrent(expected: number): void {
    if (this.destroyed) throw new ReaderSessionChangedError()
    assertSessionEpoch(expected)
  }

  assertReadable(): void {
    this.assertCurrent(this.epoch)
    if (this.accessRevoked) throw new ReaderContentError('BOOK_NOT_ACCESSIBLE', 'Book access was revoked', 404)
  }

  pauseBackgroundPrefetch(): void {
    this.backgroundPaused = true
    this.prefetchGeneration += 1
    this.prefetchController?.abort()
    this.prefetchController = null
    this.scheduler.cancelQueuedBackground()
  }

  resumeBackgroundPrefetch(): void {
    this.backgroundPaused = false
  }

  private handleContentError(error: unknown): void {
    if (!(error instanceof ReaderContentError)) return
    if (error.code === 'READER_REVISION_CHANGED' && !this.revisionChanged) {
      this.revisionChanged = true
      for (const listener of this.revisionChangeListeners) listener(this.manifest.revisionId)
      this.revisionChangeListeners.clear()
      this.prefetchGeneration += 1
      this.scheduler.cancelQueuedBackground()
    }
    if (!isReaderAccessRevoked(error) || this.accessRevoked) return
    this.accessRevoked = true
    this.prefetchGeneration += 1
    this.scheduler.cancelQueued()
  }

  private async readBatchWaiter(path: string, requested: ReaderContentPriority, deadline: number, signal?: AbortSignal): Promise<string | undefined> {
    const waiter = this.batchWaiters.get(path)
    if (!waiter) return undefined
    const consumer = new AbortController()
    const abortConsumer = () => consumer.abort(signal?.reason)
    signal?.addEventListener('abort', abortConsumer, { once: true })
    if (signal?.aborted) abortConsumer()
    const joined = waiter.join(this.priority(requested), consumer.signal).catch(() => {})
    const remaining = deadline - Date.now()
    if (remaining > 0) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        waiter.promise.catch(() => {}),
        joined,
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, remaining) }),
      ])
      if (timeout !== undefined) clearTimeout(timeout)
    }
    consumer.abort(new DOMException('Batch result is no longer needed', 'AbortError'))
    signal?.removeEventListener('abort', abortConsumer)
    if (signal?.aborted) throw signal.reason ?? new DOMException('Reader batch wait was cancelled', 'AbortError')
    this.assertReadable()
    return this.touchText(path) ?? undefined
  }

  private rememberText(path: string, text: string): string {
    const existing = this.textMemory.get(path)
    if (existing) {
      this.textBytes -= existing.bytes
      this.textMemory.delete(path)
    }
    const bytes = text.length * 2
    this.textMemory.set(path, { text, bytes })
    this.textBytes += bytes
    while (this.textMemory.size > TEXT_MEMORY_MAX_ENTRIES || this.textBytes > TEXT_MEMORY_BUDGET) {
      const oldest = this.textMemory.keys().next().value
      if (oldest === undefined) break
      const entry = this.textMemory.get(oldest)
      this.textMemory.delete(oldest)
      this.textBytes -= entry?.bytes ?? 0
    }
    return text
  }

  primePreparedText(path: string, text: string): void {
    this.rememberText(path, text)
  }

  private touchText(path: string): string | null {
    const entry = this.textMemory.get(path)
    if (!entry) return null
    this.textMemory.delete(path)
    this.textMemory.set(path, entry)
    return entry.text
  }

  private rememberBlob(path: string, blob: Blob): Blob {
    const existing = this.blobMemory.get(path)
    if (existing) {
      this.blobBytes -= existing.bytes
      this.blobMemory.delete(path)
    }
    this.blobMemory.set(path, { blob, bytes: blob.size })
    this.blobBytes += blob.size
    while (this.blobMemory.size > BLOB_MEMORY_MAX_ENTRIES || this.blobBytes > BLOB_MEMORY_BUDGET) {
      const oldest = this.blobMemory.keys().next().value
      if (oldest === undefined) break
      const entry = this.blobMemory.get(oldest)
      this.blobMemory.delete(oldest)
      this.blobBytes -= entry?.bytes ?? 0
    }
    return blob
  }

  private touchBlob(path: string): Blob | null {
    const entry = this.blobMemory.get(path)
    if (!entry) return null
    this.blobMemory.delete(path)
    this.blobMemory.set(path, entry)
    return entry.blob
  }

  async loadText(path: string, requested: ReaderContentPriority = 'foreground', signal?: AbortSignal): Promise<string | null> {
    this.assertReadable()
    if (signal?.aborted) throw signal.reason ?? new DOMException('Reader request was cancelled', 'AbortError')
    const batchWaitDeadline = Date.now() + 2_000
    const startup = this.startup.get(path) ?? this.startup.get(path.toLowerCase())
    if (startup !== undefined) return startup
    const memory = this.touchText(path)
    if (memory !== null) return memory

    const beforeCacheRead = await this.readBatchWaiter(path, requested, batchWaitDeadline, signal)
    if (beforeCacheRead !== undefined) return beforeCacheRead

    const key = `${this.textNamespace}|${path}`
    try {
      const cached: ChapterTextEntry | undefined = await idbChapterTextStore.get(key)
      this.assertReadable()
      if (cached?.text) {
        const text = unwrapCachedMarkupEnvelope(cached.text)
        if (text !== cached.text) {
          await idbChapterTextStore.put(key, text, () => !this.destroyed && getSessionEpoch() === this.epoch).catch(() => {})
          this.assertReadable()
        }
        return this.rememberText(path, text)
      }
    } catch (error) {
      if (error instanceof ReaderSessionChangedError) throw error
    }

    const afterCacheRead = await this.readBatchWaiter(path, requested, batchWaitDeadline, signal)
    if (afterCacheRead !== undefined) return afterCacheRead

    this.assertReadable()
    const memoryAgain = this.touchText(path)
    if (memoryAgain !== null) return memoryAgain
    return this.scheduler.schedule(
      `text:${path}`,
      this.priority(requested),
      this.manifestEntry(path)?.size ?? 0,
      async (signal) => {
        return await fetchWithTimeout(readerEndpointUrl(this.contentUrl, 'entry', {
          path,
          ...(!this.includeResourceDimensions ? { includeResourceDimensions: 'false' } : {}),
        }), {
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
          headers: { Accept: 'application/json,application/xhtml+xml,text/html,text/css,application/xml,text/plain,*/*;q=0.5' },
        }, async (response) => {
          if (!response.ok) {
            const error = await readErrorResponse(response)
            if (response.status === 404 && error.code === 'READER_ENTRY_NOT_FOUND') return null
            this.handleContentError(error)
            throw error
          }
          const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
          let text: string
          if (contentType.includes('application/json')) {
            const parsed = readerMarkupEntryResponseSchema.safeParse(await response.json())
            if (!parsed.success) throw new ReaderContentError('READER_ENTRY_FAILED', 'Chapter layout metadata is invalid')
            text = parsed.data.data.text
          } else {
            text = await response.text()
          }
          if (signal.aborted) throw signal.reason ?? new DOMException('Reader request was cancelled', 'AbortError')
          this.assertReadable()
          this.rememberText(path, text)
          void idbChapterTextStore.put(key, text, () => !this.destroyed && !this.accessRevoked && getSessionEpoch() === this.epoch).catch(() => {})
          void idbChapterTextStore.enforceBudget(this.namespace, READER_CONTENT_BUDGET_BYTES).catch(() => {})
          return text
        })
      },
      signal,
    ).catch((error) => { this.handleContentError(error); throw error })
  }

  async loadBlob(path: string, type?: string, requested: ReaderContentPriority = 'foreground', signal?: AbortSignal): Promise<Blob | null> {
    this.assertReadable()
    if (signal?.aborted) throw signal.reason ?? new DOMException('Reader request was cancelled', 'AbortError')
    const memory = this.touchBlob(path)
    if (memory) return memory
    const key = `${this.namespace}|${path}`
    const entry = this.manifestEntry(path)
    const mediaType = type || mediaTypeFromManifest(entry)
    try {
      const cached = await idbReaderBlobStore.get(key)
      this.assertReadable()
      if (cached) {
        const blob = new Blob([cached.data], { type: cached.mediaType || mediaType })
        return this.rememberBlob(path, blob)
      }
    } catch (error) {
      if (error instanceof ReaderSessionChangedError) throw error
    }
    this.assertReadable()
    const memoryAgain = this.touchBlob(path)
    if (memoryAgain) return memoryAgain
    return this.scheduler.schedule(
      `blob:${path}`,
      this.priority(requested),
      this.manifestEntry(path)?.size ?? 0,
      async (signal) => {
        return await fetchWithTimeout(readerEndpointUrl(this.contentUrl, 'entry', {
          path,
          ...(!this.includeResourceDimensions ? { includeResourceDimensions: 'false' } : {}),
        }), {
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
        }, async (response) => {
          if (!response.ok) {
            const error = await readErrorResponse(response)
            if (response.status === 404 && error.code === 'READER_ENTRY_NOT_FOUND') return null
            this.handleContentError(error)
            throw error
          }
          const data = await response.arrayBuffer()
          if (signal.aborted) throw signal.reason ?? new DOMException('Reader request was cancelled', 'AbortError')
          this.assertReadable()
          const responseType = response.headers.get('content-type')?.split(';', 1)[0] || mediaType
          const blob = new Blob([data], { type: responseType })
          this.rememberBlob(path, blob)
          // Large audio/video is for the current view only: it is neither
          // prefetched nor made durable across sessions.
          const heavy = (responseType.startsWith('audio/') || responseType.startsWith('video/'))
            && data.byteLength > 1024 * 1024
          if (!heavy) {
            void idbReaderBlobStore.put(key, data, responseType, () => !this.destroyed && getSessionEpoch() === this.epoch).catch(() => {})
          }
          return blob
        })
      },
      signal,
    ).catch((error) => { this.handleContentError(error); throw error })
  }

  prefetchTextWindow(paths: Iterable<string>): void {
    this.startTextPrefetch(paths, true)
  }

  /** Text-only, bounded background batches. Foreground callers share their waiters. */
  prefetchTexts(paths: string[]): void {
    this.startTextPrefetch(paths, false)
  }

  private startTextPrefetch(paths: Iterable<string>, useWindow: boolean): void {
    if (this.accessRevoked || this.revisionChanged || this.destroyed) return
    const generation = ++this.prefetchGeneration
    const previousRun = this.prefetchRun
    this.prefetchController?.abort()
    const controller = new AbortController()
    this.prefetchController = controller
    this.scheduler.cancelQueuedBackground()
    this.prefetchRun = previousRun.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return
      if (useWindow) await this.prefetchWindowInternal(paths, generation, controller.signal)
      else await this.prefetchTextsInternal([...paths], generation, controller.signal)
    }).catch(() => {})
  }

  private beginTextPrefetch(generation: number, signal: AbortSignal): boolean {
    this.assertReadable()
    return !signal.aborted && generation === this.prefetchGeneration
      && this.searchDepth === 0 && !document.hidden && !this.backgroundPaused
      && !this.accessRevoked && !this.revisionChanged
  }

  private async prefetchWindowInternal(paths: Iterable<string>, generation: number, signal: AbortSignal): Promise<void> {
    await Promise.resolve()
    if (!this.beginTextPrefetch(generation, signal)) return

    let coveredBytes = 0
    let coveredFiles = 0
    const missing: string[] = []
    const mediaPrefetch = { bytes: 0, paths: new Set<string>() }
    const seen = new Set<string>()
    let firstRequest: Promise<void> | undefined
    const candidates = paths[Symbol.iterator]()
    while (coveredFiles < TEXT_WINDOW_MAX_FILES && coveredBytes < TEXT_WINDOW_TARGET_BYTES) {
      const candidate = candidates.next()
      if (candidate.done) break
      const path = candidate.value
      if (!path || seen.has(path)) continue
      seen.add(path)
      const entry = this.manifestEntry(path)
      if (!entry || !Number.isSafeInteger(entry.size) || entry.size <= 0
        || !/^(application\/(xhtml\+xml|xml)|text\/html)/i.test(entry.mediaType)
        || entry.size > READER_TEXT_ENTRY_MAX_BYTES) break
      if (coveredFiles > 0 && entry.size > TEXT_WINDOW_TARGET_BYTES - coveredBytes) break

      const inMemory = this.startup.has(path) || this.startup.has(path.toLowerCase())
        || this.textMemory.has(path) || this.batchWaiters.has(path)
        || this.scheduler.hasPending(`text:${path}`)
      if (!inMemory) {
        let cached: ChapterTextEntry | undefined
        try {
          cached = await idbChapterTextStore.get(`${this.textNamespace}|${path}`)
          this.assertReadable()
        } catch {
          if (!this.beginTextPrefetch(generation, signal)) return
        }
        if (signal.aborted || generation !== this.prefetchGeneration) return
        if (cached?.text) this.rememberText(path, unwrapCachedMarkupEnvelope(cached.text))
        else {
          missing.push(path)
          if (!firstRequest) {
            firstRequest = this.fetchTextBatches([path], generation, signal, mediaPrefetch, true)
            void firstRequest.catch(() => {})
          }
        }
      }

      coveredFiles += 1
      coveredBytes += entry.size
      if (entry.size > TEXT_WINDOW_TARGET_BYTES) break
    }
    if (firstRequest) await firstRequest
    if (missing.length > 1 && this.beginTextPrefetch(generation, signal)) {
      await this.fetchTextBatches(missing.slice(1), generation, signal, mediaPrefetch, false, false)
    }
  }

  private async prefetchTextsInternal(paths: string[], generation: number, signal: AbortSignal): Promise<void> {
    await Promise.resolve()
    if (!this.beginTextPrefetch(generation, signal)) return
    const unique = [...new Set(paths)].filter((path) => path
      && !this.startup.has(path) && !this.startup.has(path.toLowerCase())
      && !this.textMemory.has(path) && !this.batchWaiters.has(path)
      && !this.scheduler.hasPending(`text:${path}`))

    const missing: string[] = []
    for (const path of unique) {
      try {
        const cached = await idbChapterTextStore.get(`${this.textNamespace}|${path}`)
        this.assertReadable()
        if (!this.beginTextPrefetch(generation, signal)) return
        if (cached?.text) {
          this.rememberText(path, cached.text)
          continue
        }
      } catch {
        // treat as a miss
      }
      this.assertReadable()
      missing.push(path)
    }
    if (missing.length === 0 || !this.beginTextPrefetch(generation, signal)) return

    await this.fetchTextBatches(missing, generation, signal, { bytes: 0, paths: new Set() })
  }

  private async fetchTextBatches(
    paths: string[],
    generation: number,
    signal: AbortSignal,
    mediaPrefetch?: { bytes: number; paths: Set<string> },
    prioritizeFirst = false,
    splitFirst = true,
  ): Promise<void> {
    const batches: Array<Array<{ path: string; size: number }>> = []
    let current: Array<{ path: string; size: number }> = []
    let total = 0
    for (const path of paths) {
      const entry = this.manifestEntry(path)
      if (!entry || entry.size > READER_TEXT_ENTRY_MAX_BYTES) continue
      if (entry.size > READER_TEXT_BATCH_MAX_BYTES) {
        if (current.length > 0) batches.push(current)
        current = []
        total = 0
        batches.push([{ path, size: entry.size }])
        continue
      }
      if (current.length >= READER_TEXT_BATCH_MAX_ENTRIES || total + entry.size > READER_TEXT_BATCH_MAX_BYTES) {
        if (current.length > 0) batches.push(current)
        current = []
        total = 0
      }
      current.push({ path, size: entry.size })
      total += entry.size
    }
    if (current.length > 0) batches.push(current)

    if (prioritizeFirst && splitFirst && batches[0] && batches[0].length > 1) {
      const [first, ...rest] = batches[0]
      batches[0] = [first!]
      if (rest.length > 0) batches.splice(1, 0, rest)
    }

    if (splitFirst && batches[0] && batches[0].length > 1) {
      const [first, ...rest] = batches[0]
      batches[0] = [first!]
      if (rest.length > 0) batches.splice(1, 0, rest)
    }

    for (const selected of batches) {
      if (!this.beginTextPrefetch(generation, signal)) return
      let unresolved: typeof selected = []
      while (this.beginTextPrefetch(generation, signal)) {
        unresolved = []
        const sharedWaits: Promise<unknown>[] = []
        for (const item of selected) {
          const path = item.path
          if (this.startup.has(path) || this.startup.has(path.toLowerCase()) || this.textMemory.has(path)) continue
          const waiter = this.batchWaiters.get(path)
          if (waiter) {
            sharedWaits.push(waiter.promise)
            continue
          }
          const textTask = this.scheduler.whenSettled(`text:${path}`)
          if (textTask) {
            sharedWaits.push(textTask)
            continue
          }
          unresolved.push(item)
        }
        if (sharedWaits.length === 0) break
        if (!await waitForSharedWork(sharedWaits, signal)) return
      }
      if (!this.beginTextPrefetch(generation, signal)) return
      if (unresolved.length === 0) continue
      if (unresolved.length === 1 && unresolved[0]!.size > READER_TEXT_BATCH_MAX_BYTES) {
        await this.loadText(unresolved[0]!.path, 'background', signal).catch(() => null)
        continue
      }
      const batchBytes = unresolved.reduce((sum, item) => sum + item.size, 0)

      const batchKey = `batch:${unresolved.map((item) => item.path).join('|')}`
      const waiters = unresolved.map(({ path }) => {
        const existing = this.batchWaiters.get(path)
        if (existing) return { path, waiter: existing, created: false }
        let resolve!: () => void
        const promise = new Promise<void>((done) => { resolve = done })
        const waiter: BatchWaiter = {
          promise,
          resolve,
          batchKey,
          join: (priority, consumerSignal) => this.scheduler.schedule(
            batchKey,
            priority,
            batchBytes,
            async () => undefined,
            consumerSignal,
          ).then(() => {}),
        }
        this.batchWaiters.set(path, waiter)
        return { path, waiter, created: true }
      })

      const cleanup = () => {
        for (const { path, waiter, created } of waiters) {
          if (created && this.batchWaiters.get(path) === waiter) this.batchWaiters.delete(path)
          waiter.resolve()
        }
      }
      try {
        await this.scheduler.schedule(batchKey, this.priority('background'), batchBytes, async (requestSignal) => {
        return await fetchWithTimeout(readerEndpointUrl(this.contentUrl, 'texts'), {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: requestSignal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            revisionId: this.manifest.revisionId,
            includeResourceDimensions: this.includeResourceDimensions,
            paths: unresolved.map((item) => item.path),
          }),
        }, async (response) => {
          if (!response.ok) {
            const error = await readErrorResponse(response)
            this.handleContentError(error)
            throw error
          }
          const payload = await response.json() as { data?: unknown }
          if (requestSignal.aborted) throw requestSignal.reason ?? new DOMException('Reader request was cancelled', 'AbortError')
          const parsed = readerTextBatchResSchema.safeParse(payload.data)
          if (!parsed.success) throw new ReaderContentError('READER_ENTRY_FAILED', 'Reader text batch is invalid')
          const body: { data: ReaderTextBatchRes } = { data: parsed.data }
          if (body.data.revisionId !== this.manifest.revisionId) {
            const error = new ReaderContentError('READER_REVISION_CHANGED', 'Reader text batch belongs to another content revision', 409)
            this.handleContentError(error)
            throw error
          }
          this.assertReadable()
          const writes: Promise<void>[] = []
          for (const item of body.data?.items ?? []) {
            if ('text' in item) {
              this.rememberText(item.path, item.text)
              this.batchWaiters.get(item.path)?.resolve()
              writes.push(idbChapterTextStore.put(
                `${this.textNamespace}|${item.path}`,
                item.text,
                () => !this.destroyed && getSessionEpoch() === this.epoch,
              ).catch(() => {}))
              const firstImage = item.resources?.[0]
              const imageEntry = firstImage ? this.manifestEntry(firstImage.path) : undefined
              if (mediaPrefetch && this.beginTextPrefetch(generation, signal)
                && firstImage && imageEntry && imageEntry.mediaType.startsWith('image/')
                && (!this.resourcePrefetchFilter || !this.resourcePrefetchFilter(imageEntry.mediaType, firstImage.path))
                && imageEntry.size <= 256 * 1024 && !mediaPrefetch.paths.has(imageEntry.path)
                && mediaPrefetch.bytes + imageEntry.size <= 512 * 1024) {
                mediaPrefetch.bytes += imageEntry.size
                mediaPrefetch.paths.add(imageEntry.path)
                if (!this.resourcePrefetchConsumers.has(imageEntry.path)) {
                  const controller = new AbortController()
                  this.resourcePrefetchConsumers.set(imageEntry.path, controller)
                  void this.loadBlob(firstImage.path, imageEntry.mediaType, 'background', AbortSignal.any([signal, controller.signal]))
                    .catch(() => {})
                    .finally(() => {
                      if (this.resourcePrefetchConsumers.get(imageEntry.path) === controller) this.resourcePrefetchConsumers.delete(imageEntry.path)
                    })
                }
              }
            }
          }
          void Promise.all(writes).then(() => idbChapterTextStore.enforceBudget(this.namespace, READER_CONTENT_BUDGET_BYTES)).catch(() => {})
          return body
        })
        }, signal)
      } catch (error) {
        this.handleContentError(error)
        throw error
      } finally {
        const settled = this.scheduler.whenSettled(batchKey)
        if (settled) void settled.then(cleanup)
        else cleanup()
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.prefetchGeneration += 1
    this.prefetchController?.abort()
    this.prefetchController = null
    this.prefetchRun = Promise.resolve()
    this.unsubscribeSessionScope()
    this.revisionChangeListeners.clear()
    this.scheduler.abortAll()
    for (const controller of this.resourcePrefetchConsumers.values()) controller.abort(new DOMException('Reader session was destroyed', 'AbortError'))
    this.resourcePrefetchConsumers.clear()
    for (const waiter of this.batchWaiters.values()) waiter.resolve()
    this.batchWaiters.clear()
    this.textMemory.clear()
    this.textBytes = 0
    this.blobMemory.clear()
    this.blobBytes = 0
  }
}

export function consumePreparedReaderContentText(session: ReaderContentSession): void {
  const textPrefix = `${session.textNamespace}|`
  const handoff = [...preparedTextHandoff].find(([key]) => key.startsWith(textPrefix))
  if (!handoff) return
  preparedTextHandoff.delete(handoff[0])
  session.primePreparedText(handoff[0].slice(textPrefix.length), handoff[1])
}
