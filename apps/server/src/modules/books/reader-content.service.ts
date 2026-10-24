import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'

import { DOMParser, Element as XmlElement, XMLSerializer } from '@xmldom/xmldom'
import sharp from 'sharp'

import {
  READER_ENTRY_MAX_BYTES,
  READER_MANIFEST_FORMAT_VERSION,
  READER_TEXT_BATCH_MAX_BYTES,
  READER_TEXT_ENTRY_MAX_BYTES,
  type ReaderManifest,
  type ReaderManifestEntry,
  type ReaderResourceDimensions,
  type ReaderTextBatchItem,
  type ReaderTextBatchRes,
} from '@bookdock/shared'

import { config } from '../../config'
import { log } from '../../lib/logger'
import { getStorage } from '../../storage'
import { isEpubMediaPath, resolveEpubResourcePath, type EpubChapterMedia } from '../../formats/epub'
import {
  decodeArchiveText,
  extractEpubStartup,
  lookupArchiveEntry,
  normalizeReaderEntryPath,
  openEpubArchive,
  readerMediaTypeForPath,
  readArchiveEntryBuffer,
  type EpubArchive,
  type EpubIndexEntry,
  type EpubStartup,
} from '../../formats/epub-index'

const DERIVATION_VERSION = 3
const DERIVED_DISK_BUDGET = 256 * 1024 * 1024
const DERIVED_MEMORY_MAX = 24
const DERIVED_MEMORY_BUDGET = 64 * 1024 * 1024
const DERIVED_WRITE_QUEUE_MAX = 16
const READER_PREBUILD_QUEUE_MAX = 32
const READER_PREBUILD_CONCURRENCY = 1
const RAW_CACHE_BUDGET = 128 * 1024 * 1024
const RAW_CACHE_ITEM_MAX = 8 * 1024 * 1024
const RAW_CACHE_ENTRIES_MAX = 4096
const LAYOUT_IMAGE_MAX_COUNT = 8
// Layout hints include large hero images; keep this separate from small-image prefetch budgets.
const LAYOUT_IMAGE_MAX_COMPRESSED_BYTES = 2 * 1024 * 1024
const LAYOUT_IMAGE_MAX_ENTRY_BYTES = 2 * 1024 * 1024
const LAYOUT_IMAGE_MAX_TOTAL_BYTES = 4 * 1024 * 1024

export interface ReaderContentBook {
  id: string
  filePath: string
  format: string
  size?: number
  revisionId: string
  contentHash?: string | null
}

interface SerializedDerivedIndex {
  version: number
  blobKey: string
  sourceSize: number
  centralDirectoryOffset: number
  entries: EpubIndexEntry[]
  startup: EpubStartup
  imageDimensions: Record<string, { width: number; height: number }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isSerializedDerivedIndex(value: unknown, blobKey: string, sourceSize: number): value is SerializedDerivedIndex {
  if (!isRecord(value)
    || value.version !== DERIVATION_VERSION
    || value.blobKey !== blobKey
    || value.sourceSize !== sourceSize
    || !isNonnegativeInteger(value.centralDirectoryOffset)
    || value.centralDirectoryOffset > sourceSize
    || !Array.isArray(value.entries)
    || !isRecord(value.startup)) return false
  const entriesValid = value.entries.every((candidate) => {
    if (!isRecord(candidate)) return false
    const pathValue = candidate.path
    const method = candidate.method
    const compression = candidate.compression
    return typeof pathValue === 'string'
      && normalizeReaderEntryPath(pathValue) === pathValue
      && isNonnegativeInteger(candidate.size)
      && isNonnegativeInteger(candidate.compressedSize)
      && (compression === 'store' || compression === 'deflate' || compression === 'unsupported')
      && isNonnegativeInteger(method)
      && isNonnegativeInteger(candidate.flags)
      && isNonnegativeInteger(candidate.crc32)
      && isNonnegativeInteger(candidate.localHeaderOffset)
      && candidate.localHeaderOffset + 30 + candidate.compressedSize <= sourceSize
  })
  const startup = value.startup
  const dimensionsValid = isRecord(value.imageDimensions)
    && Object.entries(value.imageDimensions).length <= RAW_CACHE_ENTRIES_MAX
    && Object.entries(value.imageDimensions).every(([pathValue, dimensions]) => normalizeReaderEntryPath(pathValue) === pathValue
      && isRecord(dimensions)
      && isNonnegativeInteger(dimensions.width)
      && dimensions.width > 0
      && isNonnegativeInteger(dimensions.height)
      && dimensions.height > 0)
  const startupValid = typeof startup.opfPath === 'string'
    && (startup.navPath === null || typeof startup.navPath === 'string')
    && (startup.ncxPath === null || typeof startup.ncxPath === 'string')
    && Array.isArray(startup.startupFiles)
    && startup.startupFiles.every((file) => isRecord(file) && typeof file.path === 'string' && typeof file.text === 'string')
    && Array.isArray(startup.spine)
    && startup.spine.every((item) => isRecord(item) && typeof item.path === 'string' && typeof item.mediaType === 'string' && typeof item.linear === 'boolean')
    && Array.isArray(startup.toc)
    && startup.toc.every((item) => isRecord(item) && typeof item.title === 'string' && typeof item.href === 'string' && isNonnegativeInteger(item.level))
    && Array.isArray(startup.manifest)
    && startup.manifest.every((item) => isRecord(item)
      && typeof item.id === 'string'
      && typeof item.href === 'string'
      && typeof item.mediaType === 'string'
      && (item.properties === undefined || typeof item.properties === 'string')
      && (item.mediaOverlay === undefined || typeof item.mediaOverlay === 'string'))
  return entriesValid && startupValid && dimensionsValid
}

interface PreparedArchive {
  blobKey: string
  sourceSize: number
  archive: EpubArchive
  startup: EpubStartup
  imageDimensions: Map<string, ReaderResourceDimensions>
  mediaTypes: Map<string, string>
}

const preparedMemory = new Map<string, PreparedArchive>()
let preparedMemoryBytes = 0
const preparing = new Map<string, Promise<PreparedArchive>>()
const rawCache = new Map<string, Buffer>()
let rawCacheBytes = 0
const rawInflight = new Map<string, Promise<Buffer>>()
const derivedWrites = new Map<string, { prepared: PreparedArchive; pending: boolean; running: boolean }>()
const failedDerivedWrites = new WeakSet<PreparedArchive>()
let derivedTempSequence = 0
let derivedBudgetTail: Promise<void> = Promise.resolve()
let derivedWriteCount = 0
let derivedWritesIdle: Promise<void> = Promise.resolve()
let resolveDerivedWritesIdle: (() => void) | null = null
let beforeDerivedPersistForTests: (() => Promise<void>) | null = null
let beforeReaderPrebuildForTests: (() => Promise<void>) | null = null
let beforeReaderArchiveOpenForTests: (() => Promise<void>) | null = null
const readerPrebuildQueue: Array<{ key: string; book: ReaderContentBook }> = []
const readerPrebuilds = new Map<string, ReaderContentBook>()
let readerPrebuildActive = 0
let readerPrebuildScheduled = false
let readerPrebuildsIdle: Promise<void> = Promise.resolve()
let resolveReaderPrebuildsIdle: (() => void) | null = null

function derivedDirectory(): string {
  return path.join(config.dataDir, 'reader-content-index', `v${DERIVATION_VERSION}`)
}

function derivedPath(blobKey: string): string {
  const digest = createHash('sha256').update(`${DERIVATION_VERSION}\0${blobKey}`).digest('hex')
  return path.join(derivedDirectory(), `${digest}.json`)
}

function touchPrepared(key: string, prepared: PreparedArchive) {
  const bytes = estimatePreparedBytes(prepared)
  const previous = preparedMemory.get(key)
  if (previous) preparedMemoryBytes -= estimatePreparedBytes(previous)
  preparedMemory.delete(key)
  if (bytes > DERIVED_MEMORY_BUDGET) return
  preparedMemory.set(key, prepared)
  preparedMemoryBytes += bytes
  while (preparedMemory.size > DERIVED_MEMORY_MAX || preparedMemoryBytes > DERIVED_MEMORY_BUDGET) {
    const oldest = preparedMemory.keys().next().value
    if (oldest === undefined) break
    const evicted = preparedMemory.get(oldest)
    if (evicted) preparedMemoryBytes -= estimatePreparedBytes(evicted)
    preparedMemory.delete(oldest)
  }
}

function estimatePreparedBytes(prepared: PreparedArchive): number {
  const entries = prepared.archive.entries.reduce((sum, entry) => sum + entry.path.length * 2 + 64, 0)
  const startupFiles = prepared.startup.startupFiles.reduce((sum, file) => sum + file.path.length * 2 + file.text.length * 2, 0)
  const startupMetadata = prepared.startup.spine.reduce((sum, item) => sum + (item.path.length + item.mediaType.length) * 2 + 16, 0)
    + prepared.startup.toc.reduce((sum, item) => sum + (item.title.length + item.href.length) * 2 + 16, 0)
    + prepared.startup.manifest.reduce((sum, item) => sum + (item.id.length + item.href.length + item.mediaType.length + (item.properties?.length ?? 0) + (item.mediaOverlay?.length ?? 0)) * 2 + 32, 0)
  const mediaTypes = [...prepared.mediaTypes].reduce((sum, [href, type]) => sum + (href.length + type.length) * 2 + 32, 0)
  const imageDimensions = [...prepared.imageDimensions.keys()].reduce((sum, pathValue) => sum + pathValue.length * 2 + 32, 0)
  return entries + startupFiles + startupMetadata + mediaTypes + imageDimensions
}

function rebuildArchive(
  blobKey: string,
  sourceSize: number,
  centralDirectoryOffset: number,
  entries: EpubIndexEntry[],
  startup: EpubStartup,
  source: EpubArchive['source'],
  dimensions: Record<string, { width: number; height: number }> = {},
): PreparedArchive {
  const archive: EpubArchive = {
    source,
    centralDirectoryOffset,
    entries,
    byPath: new Map(),
    byLowerPath: new Map(),
  }
  for (const entry of entries) {
    if (!archive.byPath.has(entry.path)) archive.byPath.set(entry.path, entry)
    else archive.byPath.set(entry.path, null)
    const lower = entry.path.toLowerCase()
    if (!archive.byLowerPath.has(lower)) archive.byLowerPath.set(lower, entry)
    else archive.byLowerPath.set(lower, null)
  }
  const imageDimensions = new Map(Object.entries(dimensions).map(([pathValue, size]) => [pathValue, { path: pathValue, ...size }]))
  return { blobKey, sourceSize, archive, startup, imageDimensions, mediaTypes: mediaTypeMap(startup) }
}

async function loadDerived(
  blobKey: string,
  sourceSize: number,
  source: EpubArchive['source'],
): Promise<PreparedArchive | null> {
  const filePath = derivedPath(blobKey)
  try {
    const text = await fs.readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (!isSerializedDerivedIndex(parsed, blobKey, sourceSize)) return null
    const now = new Date()
    void fs.utimes(filePath, now, now).catch(() => {})
    return rebuildArchive(blobKey, sourceSize, parsed.centralDirectoryOffset, parsed.entries, parsed.startup, source, parsed.imageDimensions)
  } catch {
    return null
  }
}

async function enforceDerivedDiskBudget(keepPath: string): Promise<void> {
  const dir = derivedDirectory()
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return
  }
  const files = await Promise.all(names
    .filter((name) => name.endsWith('.json'))
    .map(async (name) => {
      const filePath = path.join(dir, name)
      try {
        const stat = await fs.stat(filePath)
        return { filePath, size: stat.size, mtimeMs: stat.mtimeMs }
      } catch {
        return null
      }
    }))
  let total = files.reduce((sum, file) => sum + (file?.size ?? 0), 0)
  if (total <= DERIVED_DISK_BUDGET) return
  for (const file of files.filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= DERIVED_DISK_BUDGET) break
    if (file.filePath === keepPath) continue
    try {
      await fs.unlink(file.filePath)
      total -= file.size
    } catch {
      // A concurrently removed or locked file is not a correctness issue.
    }
  }
}

function serializePrepared(prepared: PreparedArchive): SerializedDerivedIndex {
  return {
    version: DERIVATION_VERSION,
    blobKey: prepared.blobKey,
    sourceSize: prepared.sourceSize,
    centralDirectoryOffset: prepared.archive.centralDirectoryOffset,
    entries: prepared.archive.entries,
    startup: prepared.startup,
    imageDimensions: Object.fromEntries([...prepared.imageDimensions].map(([pathValue, size]) => [pathValue, { width: size.width, height: size.height }])),
  }
}

async function persistDerivedSnapshot(prepared: PreparedArchive): Promise<void> {
  const filePath = derivedPath(prepared.blobKey)
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${++derivedTempSequence}`
  try {
    await beforeDerivedPersistForTests?.()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tempPath, JSON.stringify(serializePrepared(prepared)), 'utf8')
    await fs.rename(tempPath, filePath)
    derivedBudgetTail = derivedBudgetTail.catch(() => {}).then(() => enforceDerivedDiskBudget(filePath))
    await derivedBudgetTail
    failedDerivedWrites.delete(prepared)
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {})
    failedDerivedWrites.add(prepared)
    log('warn', 'reader_index.persist_failed', {
      error,
      meta: { blobKey: prepared.blobKey },
    })
  }
}

function saveDerived(prepared: PreparedArchive): void {
  let task = derivedWrites.get(prepared.blobKey)
  if (!task) {
    if (derivedWrites.size >= DERIVED_WRITE_QUEUE_MAX) {
      failedDerivedWrites.add(prepared)
      return
    }
    task = { prepared, pending: true, running: false }
    derivedWrites.set(prepared.blobKey, task)
    if (derivedWriteCount === 0) derivedWritesIdle = new Promise((resolve) => { resolveDerivedWritesIdle = resolve })
    derivedWriteCount += 1
  } else {
    task.prepared = prepared
    task.pending = true
  }
  if (task.running) return
  task.running = true
  const currentTask = task
  const blobKey = prepared.blobKey
  queueMicrotask(() => { void flushDerivedWrites(blobKey, currentTask) })
}

async function flushDerivedWrites(blobKey: string, task: { prepared: PreparedArchive; pending: boolean; running: boolean }): Promise<void> {
  try {
    while (task.pending) {
      task.pending = false
      await persistDerivedSnapshot(task.prepared)
    }
  } finally {
    task.running = false
    if (task.pending) {
      task.running = true
      queueMicrotask(() => { void flushDerivedWrites(blobKey, task) })
    } else if (derivedWrites.get(blobKey) === task) {
      derivedWrites.delete(blobKey)
      derivedWriteCount -= 1
      if (derivedWriteCount === 0) {
        resolveDerivedWritesIdle?.()
        resolveDerivedWritesIdle = null
      }
    }
  }
}

function sourceForBook(book: ReaderContentBook): EpubArchive['source'] {
  const storage = getStorage()
  return {
    size: 0,
    async read(start, end) {
      return bufferFromStream(await storage.get(book.filePath, { start, end }))
    },
  }
}

async function buildPrepared(book: ReaderContentBook, blobKey: string, sourceSize: number): Promise<PreparedArchive> {
  await beforeReaderArchiveOpenForTests?.()
  const source = sourceForBook(book)
  source.size = sourceSize
  const archive = await openEpubArchive(source)
  const startup = await extractEpubStartup(archive)
  const prepared = { blobKey, sourceSize, archive, startup, imageDimensions: new Map<string, ReaderResourceDimensions>(), mediaTypes: mediaTypeMap(startup) }
  saveDerived(prepared)
  return prepared
}

export async function prepareReaderArchive(book: ReaderContentBook): Promise<PreparedArchive> {
  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) throw new ReaderArchiveUnavailable('BOOK_FILE_MISSING')
  const blobKey = book.contentHash || book.filePath
  const cached = preparedMemory.get(blobKey)
  if (cached && (!book.size || cached.sourceSize === book.size)) {
    touchPrepared(blobKey, cached)
    return cached
  }
  const pending = preparing.get(blobKey)
  if (pending) return pending

  const task = (async () => {
    const sourceSize = await storage.size(book.filePath)
    const loaded = await loadDerived(blobKey, sourceSize, sourceForBookWithSize(book, sourceSize))
    if (loaded) {
      touchPrepared(blobKey, loaded)
      return loaded
    }
    const prepared = await buildPrepared(book, blobKey, sourceSize)
    touchPrepared(blobKey, prepared)
    return prepared
  })()
  preparing.set(blobKey, task)
  try {
    return await task
  } finally {
    if (preparing.get(blobKey) === task) preparing.delete(blobKey)
  }
}

function readerSourceKey(book: ReaderContentBook): string {
  return book.contentHash || book.filePath
}

function readerPrebuildFailureReason(error: unknown): string {
  return error instanceof ReaderArchiveUnavailable ? error.code : 'READER_PREBUILD_FAILED'
}

function finishReaderPrebuild(key: string): void {
  readerPrebuilds.delete(key)
  readerPrebuildActive -= 1
  if (readerPrebuildQueue.length === 0 && readerPrebuildActive === 0) {
    resolveReaderPrebuildsIdle?.()
    resolveReaderPrebuildsIdle = null
  }
  scheduleReaderPrebuilds()
}

function scheduleReaderPrebuilds(): void {
  if (readerPrebuildScheduled || readerPrebuildActive >= READER_PREBUILD_CONCURRENCY || readerPrebuildQueue.length === 0) return
  readerPrebuildScheduled = true
  setImmediate(() => {
    readerPrebuildScheduled = false
    while (readerPrebuildActive < READER_PREBUILD_CONCURRENCY && readerPrebuildQueue.length > 0) {
      const task = readerPrebuildQueue.shift()!
      readerPrebuildActive += 1
      void (async () => {
        try {
          await beforeReaderPrebuildForTests?.()
          await prepareReaderArchive(task.book)
        } catch (error) {
          log('warn', 'reader_index.prebuild_failed', {
            meta: { sourceKey: task.book.contentHash || task.book.filePath, revisionId: task.book.revisionId, reason: readerPrebuildFailureReason(error) },
          })
        } finally {
          finishReaderPrebuild(task.key)
        }
      })()
    }
  })
}

export function enqueueReaderArchivePreparation(book: ReaderContentBook): 'queued' | 'deduplicated' | 'skipped' {
  if (book.format !== 'epub' && book.format !== 'txt') return 'skipped'

  const snapshot: ReaderContentBook = {
    id: book.id,
    filePath: book.filePath,
    format: book.format,
    revisionId: book.revisionId,
    contentHash: book.contentHash ?? null,
    ...(book.size === undefined ? {} : { size: book.size }),
  }
  const sourceKey = readerSourceKey(snapshot)
  const cached = preparedMemory.get(sourceKey)
  if ((cached && (!snapshot.size || cached.sourceSize === snapshot.size)) || readerPrebuilds.has(sourceKey)) return 'deduplicated'

  const inFlight = preparing.get(sourceKey)
  if (inFlight) {
    void inFlight.catch((error: unknown) => {
      log('warn', 'reader_index.prebuild_failed', {
        meta: { sourceKey, revisionId: snapshot.revisionId, reason: readerPrebuildFailureReason(error) },
      })
    })
    return 'deduplicated'
  }

  if (readerPrebuildQueue.length >= READER_PREBUILD_QUEUE_MAX) {
    log('warn', 'reader_index.prebuild_skipped', { meta: { sourceKey, revisionId: snapshot.revisionId, reason: 'QUEUE_FULL' } })
    return 'skipped'
  }

  if (readerPrebuildQueue.length === 0 && readerPrebuildActive === 0) {
    readerPrebuildsIdle = new Promise((resolve) => { resolveReaderPrebuildsIdle = resolve })
  }
  readerPrebuilds.set(sourceKey, snapshot)
  readerPrebuildQueue.push({ key: sourceKey, book: snapshot })
  scheduleReaderPrebuilds()
  return 'queued'
}

export function getReaderPrebuildQueueStateForTests(): { queued: number; active: number } {
  return { queued: readerPrebuildQueue.length, active: readerPrebuildActive }
}

export function setReaderPrebuildGateForTests(gate: (() => Promise<void>) | null): void {
  beforeReaderPrebuildForTests = gate
}

export function setReaderArchiveOpenGateForTests(gate: (() => Promise<void>) | null): void {
  beforeReaderArchiveOpenForTests = gate
}

export async function waitForReaderPrebuildsForTests(): Promise<void> {
  await readerPrebuildsIdle
}

function sourceForBookWithSize(book: ReaderContentBook, size: number): EpubArchive['source'] {
  const source = sourceForBook(book)
  source.size = size
  return source
}

export class ReaderArchiveUnavailable extends Error {
  constructor(public readonly code: 'BOOK_FILE_MISSING' | 'READER_ENTRY_FAILED') {
    super(code)
    this.name = 'ReaderArchiveUnavailable'
  }
}

function mediaTypeMap(startup: EpubStartup): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of startup.manifest) {
    map.set(item.href, item.mediaType)
    const lower = item.href.toLowerCase()
    if (!map.has(lower)) map.set(lower, item.mediaType)
  }
  return map
}

export async function getReaderManifest(book: ReaderContentBook): Promise<ReaderManifest> {
  const prepared = await prepareReaderArchive(book)
  const declaredTypes = prepared.mediaTypes
  const entries: ReaderManifestEntry[] = prepared.archive.entries.map((entry) => ({
    path: entry.path,
    size: entry.size,
    compressedSize: entry.compressedSize,
    compression: entry.compression,
    mediaType: readerMediaTypeForPath(entry.path, declaredTypes.get(entry.path) ?? declaredTypes.get(entry.path.toLowerCase())),
  }))
  return {
    formatVersion: READER_MANIFEST_FORMAT_VERSION,
    bookId: book.id,
    revisionId: book.revisionId,
    contentHash: book.contentHash ?? null,
    size: prepared.sourceSize,
    entryCount: entries.length,
    entries,
    spine: prepared.startup.spine,
    startupFiles: prepared.startup.startupFiles,
    opfPath: prepared.startup.opfPath,
    navPath: prepared.startup.navPath,
    ncxPath: prepared.startup.ncxPath,
    generated: book.format === 'txt',
  }
}

function rawKey(blobKey: string, path: string): string {
  return `${blobKey}\u0000${path}`
}

function trimRawCache() {
  while (rawCache.size > RAW_CACHE_ENTRIES_MAX || rawCacheBytes > RAW_CACHE_BUDGET) {
    const oldest = rawCache.keys().next().value
    if (oldest === undefined) break
    const data = rawCache.get(oldest)
    rawCache.delete(oldest)
    rawCacheBytes -= data?.length ?? 0
  }
}

function cacheRaw(blobKey: string, entry: EpubIndexEntry, data: Buffer, mediaType: string) {
  if (data.length > RAW_CACHE_ITEM_MAX) return
  if (mediaType.startsWith('audio/') || mediaType.startsWith('video/')) return
  const key = rawKey(blobKey, entry.path)
  const existing = rawCache.get(key)
  if (existing) rawCacheBytes -= existing.length
  rawCache.delete(key)
  rawCache.set(key, data)
  rawCacheBytes += data.length
  trimRawCache()
}

async function readEntryBuffer(
  book: ReaderContentBook,
  pathValue: string,
  maxBytes: number,
): Promise<{ entry: EpubIndexEntry; data: Buffer; mediaType: string; prepared: PreparedArchive } | null> {
  const normalized = normalizeReaderEntryPath(pathValue)
  if (!normalized) return null
  const prepared = await prepareReaderArchive(book)
  const entry = lookupArchiveEntry(prepared.archive, normalized)
  if (!entry) return null
  const mediaTypes = prepared.mediaTypes
  const mediaType = readerMediaTypeForPath(entry.path, mediaTypes.get(entry.path) ?? mediaTypes.get(entry.path.toLowerCase()))
  if (entry.size > maxBytes) throw new ReaderEntryLimitError()
  const cacheKey = rawKey(prepared.blobKey, entry.path)
  const cached = rawCache.get(cacheKey)
  if (cached && cached.length <= maxBytes) {
    rawCache.delete(cacheKey)
    rawCache.set(cacheKey, cached)
    return { entry, data: cached, mediaType, prepared }
  }
  if (cached) {
    rawCache.delete(cacheKey)
    rawCacheBytes -= cached.length
  }

  const existing = rawInflight.get(cacheKey)
  if (existing) {
    const data = await existing
    if (data.length > maxBytes) throw new ReaderEntryLimitError()
    return { entry, data, mediaType, prepared }
  }

  const task = readArchiveEntryBuffer(prepared.archive, entry, Math.max(entry.size, maxBytes))
  rawInflight.set(cacheKey, task)
  try {
    const data = await task
    if (data.length > maxBytes) throw new ReaderEntryLimitError()
    cacheRaw(prepared.blobKey, entry, data, mediaType)
    return { entry, data, mediaType, prepared }
  } finally {
    if (rawInflight.get(cacheKey) === task) rawInflight.delete(cacheKey)
  }
}

export class ReaderEntryLimitError extends Error {
  constructor() {
    super('READER_ENTRY_TOO_LARGE')
    this.name = 'ReaderEntryLimitError'
  }
}

export interface ReaderEntryResult {
  data: Buffer
  mediaType: string
  path: string
}

export async function readReaderEntry(book: ReaderContentBook, pathValue: string, maxBytes = READER_ENTRY_MAX_BYTES): Promise<ReaderEntryResult | null> {
  const result = await readEntryBuffer(book, pathValue, Math.min(maxBytes, READER_ENTRY_MAX_BYTES))
  if (!result) return null
  const textType = isReaderTextMediaType(result.mediaType)
  return {
    path: result.entry.path,
    mediaType: result.mediaType,
    data: textType ? Buffer.from(decodeArchiveText(result.data), 'utf8') : result.data,
  }
}

async function getChapterImageDimensions(
  book: ReaderContentBook,
  prepared: PreparedArchive,
  chapterPath: string,
  markup: string,
): Promise<ReaderResourceDimensions[]> {
  const doc = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
  if (elementsByLocalName(doc, 'parsererror').length > 0) return []
  const candidates: Array<{ path: string }> = []
  const seen = new Set<string>()
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    const tag = element.localName?.toLowerCase() ?? ''
    if (tag !== 'img' && tag !== 'image') continue
    const href = tag === 'img'
      ? element.getAttribute('src')
      : element.getAttribute('href') || element.getAttribute('xlink:href')
    if (!href || (element.getAttribute('width') && element.getAttribute('height'))) continue
    const resourcePath = resolveEpubResourcePath(chapterPath, href.split(/[?#]/, 1)[0] ?? '')
    if (!resourcePath || seen.has(resourcePath)) continue
    seen.add(resourcePath)
    candidates.push({ path: resourcePath })
    if (candidates.length >= LAYOUT_IMAGE_MAX_COUNT) break
  }

  let totalBytes = 0
  let dimensionsChanged = false
  const hints: ReaderResourceDimensions[] = []
  for (const candidate of candidates) {
    const imageEntry = lookupArchiveEntry(prepared.archive, candidate.path)
    if (!imageEntry || imageEntry.size > LAYOUT_IMAGE_MAX_ENTRY_BYTES
      || imageEntry.compressedSize > LAYOUT_IMAGE_MAX_COMPRESSED_BYTES
      || totalBytes + imageEntry.size > LAYOUT_IMAGE_MAX_TOTAL_BYTES) continue
    const mediaTypes = prepared.mediaTypes
    const mediaType = readerMediaTypeForPath(imageEntry.path, mediaTypes.get(imageEntry.path) ?? mediaTypes.get(imageEntry.path.toLowerCase()))
    if (!mediaType.startsWith('image/')) continue
    totalBytes += imageEntry.size
    const key = imageEntry.path
    let dimensions = prepared.imageDimensions.get(key)
    if (!dimensions) {
      try {
        const image = await readEntryBuffer(book, imageEntry.path, LAYOUT_IMAGE_MAX_ENTRY_BYTES)
        if (!image) continue
        const metadata = await sharp(image.data, { limitInputPixels: 40_000_000 }).metadata()
        if (!metadata.width || !metadata.height || metadata.width > 100_000 || metadata.height > 100_000) continue
        dimensions = { path: imageEntry.path, width: metadata.width, height: metadata.height }
        prepared.imageDimensions.set(key, dimensions)
        dimensionsChanged = true
        while (prepared.imageDimensions.size > RAW_CACHE_ENTRIES_MAX) {
          const oldest = prepared.imageDimensions.keys().next().value
          if (oldest === undefined) break
          prepared.imageDimensions.delete(oldest)
        }
      } catch {
        continue
      }
    } else {
      prepared.imageDimensions.delete(key)
      prepared.imageDimensions.set(key, dimensions)
    }
    hints.push(dimensions)
  }

  if (dimensionsChanged || failedDerivedWrites.has(prepared)) {
    touchPrepared(prepared.blobKey, prepared)
    saveDerived(prepared)
  }
  return hints.length ? hints : []
}

function addImageDimensionsToMarkup(
  markup: string,
  chapterPath: string,
  resources: ReaderResourceDimensions[],
): string {
  if (resources.length === 0) return markup
  const doc = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
  if (elementsByLocalName(doc, 'parsererror').length > 0) return markup
  const byPath = new Map(resources.map((resource) => [resource.path.toLowerCase(), resource]))
  let changed = false
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    const tag = element.localName?.toLowerCase() ?? ''
    if (tag !== 'img' && tag !== 'image') continue
    const href = tag === 'img'
      ? element.getAttribute('src')
      : element.getAttribute('href') || element.getAttribute('xlink:href')
    if (!href) continue
    const resolved = resolveEpubResourcePath(chapterPath, href.split(/[?#]/, 1)[0] ?? '')
    const dimensions = resolved ? byPath.get(resolved.toLowerCase()) : undefined
    if (!dimensions) continue
    if (tag === 'img') {
      const style = element.getAttribute('style') ?? ''
      if (/(?:^|;)\s*aspect-ratio\s*:/i.test(style)) continue
      const separator = style.trim() && !style.trim().endsWith(';') ? '; ' : ''
      element.setAttribute('style', `${style}${separator}aspect-ratio: ${dimensions.width} / ${dimensions.height};`)
      changed = true
      continue
    }
    if (!element.getAttribute('width')) {
      element.setAttribute('width', String(dimensions.width))
      changed = true
    }
    if (!element.getAttribute('height')) {
      element.setAttribute('height', String(dimensions.height))
      changed = true
    }
  }
  return changed ? new XMLSerializer().serializeToString(doc) : markup
}

export interface ReaderEntryForWeb extends ReaderEntryResult {
  resources: ReaderResourceDimensions[]
}

export async function readReaderEntryForWeb(book: ReaderContentBook, pathValue: string, includeResourceDimensions = true): Promise<ReaderEntryForWeb | null> {
  const result = await readEntryBuffer(book, pathValue, READER_ENTRY_MAX_BYTES)
  if (!result) return null
  const textType = isReaderTextMediaType(result.mediaType)
  const text = textType ? decodeArchiveText(result.data) : null
  if (text === null || result.mediaType !== 'application/xhtml+xml' || !includeResourceDimensions) {
    return {
      path: result.entry.path,
      mediaType: result.mediaType,
      data: text === null ? result.data : Buffer.from(text, 'utf8'),
      resources: [],
    }
  }
  const resources = await getChapterImageDimensions(book, result.prepared, result.entry.path, text)
  const withDimensions = addImageDimensionsToMarkup(text, result.entry.path, resources)
  return { path: result.entry.path, mediaType: result.mediaType, data: Buffer.from(withDimensions, 'utf8'), resources }
}

export function isReaderTextMediaType(mediaType: string): boolean {
  const type = mediaType.split(';', 1)[0]?.trim().toLowerCase()
  return type === 'application/xhtml+xml'
    || type === 'text/html'
    || type === 'text/css'
    || type === 'text/xml'
    || type === 'application/xml'
    || type === 'application/x-dtbncx+xml'
    || type === 'application/oebps-package+xml'
    || type === 'application/smil+xml'
}

export async function readReaderTextBatch(book: ReaderContentBook, paths: string[], includeResourceDimensions = true): Promise<ReaderTextBatchRes> {
  const results = new Map<string, ReaderTextBatchItem>()
  let remaining = READER_TEXT_BATCH_MAX_BYTES
  for (const rawPath of paths) {
    const normalized = normalizeReaderEntryPath(rawPath)
    if (!normalized) {
      results.set(rawPath, { path: rawPath, error: 'READER_ENTRY_NOT_FOUND' })
      continue
    }
    if (results.has(normalized)) {
      const existing = results.get(normalized)
      if (existing) results.set(rawPath, existing)
      continue
    }
    try {
      const prepared = await prepareReaderArchive(book)
      const entry = lookupArchiveEntry(prepared.archive, normalized)
      if (!entry) {
        results.set(normalized, { path: normalized, error: 'READER_ENTRY_NOT_FOUND' })
        continue
      }
      const mediaTypes = prepared.mediaTypes
      const mediaType = readerMediaTypeForPath(entry.path, mediaTypes.get(entry.path) ?? mediaTypes.get(entry.path.toLowerCase()))
      if (!isReaderTextMediaType(mediaType)) {
        results.set(normalized, { path: normalized, error: 'READER_ENTRY_UNSUPPORTED' })
        continue
      }
      if (entry.size > READER_TEXT_ENTRY_MAX_BYTES) {
        results.set(normalized, { path: normalized, error: 'READER_ENTRY_TOO_LARGE' })
        continue
      }
      if (entry.size > remaining) {
        results.set(normalized, { path: normalized, error: 'READER_TEXT_BUDGET_EXCEEDED' })
        continue
      }
      const read = await readEntryBuffer(book, normalized, READER_TEXT_ENTRY_MAX_BYTES)
      if (!read) {
        results.set(normalized, { path: normalized, error: 'READER_ENTRY_NOT_FOUND' })
        continue
      }
      let text = decodeArchiveText(read.data)
      let resources: ReaderResourceDimensions[] | undefined
      if (includeResourceDimensions && mediaType === 'application/xhtml+xml') {
        resources = await getChapterImageDimensions(book, read.prepared, entry.path, text)
        text = addImageDimensionsToMarkup(text, entry.path, resources)
      }
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > remaining) {
        results.set(normalized, { path: normalized, error: 'READER_TEXT_BUDGET_EXCEEDED' })
        continue
      }
      remaining -= bytes
      results.set(normalized, { path: normalized, text, bytes, ...(resources ? { resources } : {}) })
    } catch (error) {
      if (error instanceof ReaderEntryLimitError) {
        results.set(normalized, { path: normalized, error: 'READER_ENTRY_TOO_LARGE' })
      } else {
        results.set(normalized, { path: normalized, error: 'READER_ENTRY_FAILED' })
      }
    }
  }
  return {
    revisionId: book.revisionId,
    items: paths.map((pathValue) => {
      const normalized = normalizeReaderEntryPath(pathValue)
      return results.get(normalized ?? pathValue) ?? { path: pathValue, error: 'READER_ENTRY_NOT_FOUND' }
    }),
  }
}

export interface ReaderChapterMarkup {
  href: string
  markup: string
  media: EpubChapterMedia[]
}

function elementsByLocalName(root: { getElementsByTagName: (name: string) => ArrayLike<XmlElement> }, name: string): XmlElement[] {
  return Array.from(root.getElementsByTagName('*')).filter((element) => {
    const local = element.localName ?? element.tagName.split(':').pop()
    return local?.toLowerCase() === name.toLowerCase()
  })
}

async function readPreparedText(
  book: ReaderContentBook,
  pathValue: string,
  maxBytes: number,
): Promise<string | null> {
  const read = await readEntryBuffer(book, pathValue, maxBytes)
  return read ? decodeArchiveText(read.data) : null
}

async function chapterMedia(book: ReaderContentBook, prepared: PreparedArchive, chapterHref: string): Promise<EpubChapterMedia[]> {
  const chapter = prepared.startup.manifest.find((item) => item.href === chapterHref)
    ?? prepared.startup.manifest.find((item) => item.href.toLowerCase() === chapterHref.toLowerCase())
  const overlay = chapter?.mediaOverlay
    ? prepared.startup.manifest.find((item) => item.id === chapter.mediaOverlay)
    : undefined
  if (!overlay || !overlay.mediaType.includes('smil')) return []
  const smil = await readPreparedText(book, overlay.href, READER_TEXT_ENTRY_MAX_BYTES).catch(() => null)
  if (!smil) return []
  const doc = new DOMParser().parseFromString(smil, 'application/xml')
  const media = new Map<string, EpubChapterMedia>()
  for (const audio of elementsByLocalName(doc, 'audio')) {
    const src = audio.getAttribute('src')
    const resolved = src ? resolveEpubResourcePath(overlay.href, src) : null
    if (resolved && !media.has(resolved)) media.set(resolved, { type: 'audio', path: resolved })
  }
  return [...media.values()]
}

export async function loadReaderChapterMarkup(book: ReaderContentBook, chapterIndex: number): Promise<ReaderChapterMarkup | null> {
  const prepared = await prepareReaderArchive(book)
  const chapter = prepared.startup.toc[chapterIndex]
  if (!chapter) return null
  const markup = await readPreparedText(book, chapter.href, READER_ENTRY_MAX_BYTES)
  if (markup === null) return null
  return {
    href: chapter.href,
    markup,
    media: await chapterMedia(book, prepared, chapter.href),
  }
}

export async function loadReaderEpubResource(book: ReaderContentBook, resourcePath: string): Promise<{ data: Buffer; mediaType: string } | null> {
  if (!isEpubMediaPath(resourcePath)) return null
  const result = await readReaderEntry(book, resourcePath)
  if (!result) return null
  return { data: result.data, mediaType: result.mediaType }
}

export function resetReaderContentCachesForTests() {
  preparedMemory.clear()
  preparedMemoryBytes = 0
  preparing.clear()
  rawCache.clear()
  rawInflight.clear()
  rawCacheBytes = 0
}

export async function waitForReaderDerivedWritesForTests(): Promise<void> {
  await derivedWritesIdle
  await derivedBudgetTail
}

export function setReaderDerivedWriteGateForTests(gate: (() => Promise<void>) | null): void {
  beforeDerivedPersistForTests = gate
}

async function bufferFromStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}
