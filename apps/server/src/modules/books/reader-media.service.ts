import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw } from 'node:zlib'

import { config } from '../../config'
import { decodeZipName, EpubCrc32, EpubIndexError, lookupArchiveEntry, normalizeReaderEntryPath, readerMediaTypeForPath, type EpubIndexEntry } from '../../formats/epub-index'
import { prepareReaderArchive, ReaderEntryLimitError, type ReaderContentBook } from './reader-content.service'

const MEDIA_ENTRY_MAX_BYTES = 1024 * 1024 * 1024
let mediaCacheBudget = 1024 * 1024 * 1024
let mediaReservedBytes = 0
const SOURCE_CHUNK_BYTES = 1024 * 1024
const activeFiles = new Map<string, number>()
const preparing = new Map<string, { promise: Promise<string>; settled: Promise<void>; controller: AbortController; consumers: number }>()
const activeTempFiles = new Set<string>()
let cacheLock: Promise<void> = Promise.resolve()
let preparationQueue: Promise<void> = Promise.resolve()
const mediaSpaceWaiters = new Set<() => void>()

function notifyMediaSpaceWaiters(): void {
  for (const resolve of mediaSpaceWaiters) resolve()
  mediaSpaceWaiters.clear()
}

function waitForMediaSpace(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Media preparation was aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', abort)
      mediaSpaceWaiters.delete(finish)
    }
    const finish = () => { cleanup(); resolve() }
    const abort = () => {
      cleanup()
      reject(signal.reason ?? new DOMException('Media preparation was aborted', 'AbortError'))
    }
    mediaSpaceWaiters.add(finish)
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function withCacheLock<T>(work: () => Promise<T>): Promise<T> {
  let unlock!: () => void
  const next = new Promise<void>((resolve) => { unlock = resolve })
  const previous = cacheLock
  cacheLock = next
  await previous
  try { return await work() } finally { unlock() }
}

function queueMediaPreparation<T>(work: () => Promise<T>): Promise<T> {
  const current = preparationQueue.then(work, work)
  preparationQueue = current.then(() => undefined, () => undefined)
  return current
}

function mediaDirectory(): string {
  return path.join(config.dataDir, 'reader-media-cache', 'v1')
}

function mediaKey(blobKey: string, entryPath: string): string {
  return createHash('sha256').update(`${blobKey}\0${entryPath}`).digest('hex')
}

async function evictMediaFilesLocked(except: string, targetBytes = mediaCacheBudget - mediaReservedBytes): Promise<number> {
  const directory = mediaDirectory()
  const files = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  const records: Array<{ file: string; size: number; accessed: number }> = []
  let total = 0
  for (const item of files) {
    if (!item.isFile() || !/^[a-f0-9]{64}\.media$/.test(item.name)) continue
    const file = path.join(directory, item.name)
    const stat = await fs.stat(file).catch(() => null)
    if (!stat) continue
    total += stat.size
    records.push({ file, size: stat.size, accessed: stat.atimeMs })
  }
  records.sort((a, b) => a.accessed - b.accessed)
  for (const record of records) {
    if (total <= targetBytes) break
    if (record.file === except || (activeFiles.get(record.file) ?? 0) > 0) continue
    await fs.unlink(record.file).then(() => { total -= record.size }).catch(() => {})
  }
  return total
}

async function reserveMediaSpace(bytes: number, signal: AbortSignal): Promise<void> {
  if (bytes > mediaCacheBudget) throw new ReaderEntryLimitError()
  while (true) {
    const reserved = await withCacheLock(async () => {
      const availableForFiles = mediaCacheBudget - mediaReservedBytes - bytes
      const total = await evictMediaFilesLocked('', availableForFiles)
      if (total + mediaReservedBytes + bytes > mediaCacheBudget) return false
      mediaReservedBytes += bytes
      return true
    })
    if (reserved) return
    await waitForMediaSpace(signal)
  }
}

async function releaseMediaReservation(bytes: number): Promise<void> {
  await withCacheLock(async () => {
    mediaReservedBytes = Math.max(0, mediaReservedBytes - bytes)
    await evictMediaFilesLocked('')
    notifyMediaSpaceWaiters()
  })
}

async function waitForPreparationCleanup(task: { settled: Promise<void> }, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Media request was aborted', 'AbortError')
  let abort!: () => void
  try {
    await Promise.race([
      task.settled,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason ?? new DOMException('Media request was aborted', 'AbortError'))
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      }),
    ])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

async function cleanOrphanedMediaTemps(directory: string): Promise<void> {
  const items = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const item of items) {
    if (!item.isFile() || !/^[a-f0-9]{64}\.media\.tmp-[a-f0-9-]+$/.test(item.name)) continue
    const file = path.join(directory, item.name)
    if (activeTempFiles.has(file)) continue
    await fs.unlink(file).catch(() => {})
  }
}

async function writePreparedMedia(prepared: Awaited<ReturnType<typeof prepareReaderArchive>>, entry: EpubIndexEntry, file: string, signal: AbortSignal, onPublished: () => void): Promise<string> {
  await fs.mkdir(mediaDirectory(), { recursive: true })
  await cleanOrphanedMediaTemps(mediaDirectory())
  const source = prepared.archive.source
  const header = await source.read(entry.localHeaderOffset, entry.localHeaderOffset + 29)
  if (header.length !== 30 || header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== entry.method) {
    throw new EpubIndexError('CORRUPT', 'Invalid ZIP media local header')
  }
  const nameLength = header.readUInt16LE(26)
  const extraLength = header.readUInt16LE(28)
  const localName = await source.read(entry.localHeaderOffset + 30, entry.localHeaderOffset + 29 + nameLength)
  if (normalizeReaderEntryPath(decodeZipName(localName, header.readUInt16LE(6))) !== entry.path) throw new EpubIndexError('CORRUPT', 'ZIP media entry name mismatch')
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  if (dataStart + entry.compressedSize > prepared.archive.centralDirectoryOffset) throw new EpubIndexError('CORRUPT', 'ZIP media entry overlaps central directory')
  if (entry.method === 0 && entry.compressedSize !== entry.size) throw new EpubIndexError('CORRUPT', 'Stored ZIP media sizes do not match')

  const temp = `${file}.tmp-${randomUUID()}`
  activeTempFiles.add(temp)
  const crc = new EpubCrc32()
  let outputBytes = 0
  const validate = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      outputBytes += chunk.length
      if (outputBytes > entry.size || outputBytes > MEDIA_ENTRY_MAX_BYTES) return callback(new ReaderEntryLimitError())
      crc.update(chunk)
      callback(null, chunk)
    },
  })
  const compressed = async function* () {
    for (let offset = 0; offset < entry.compressedSize; offset += SOURCE_CHUNK_BYTES) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Media preparation was aborted', 'AbortError')
      const end = Math.min(entry.compressedSize, offset + SOURCE_CHUNK_BYTES) - 1
      const chunk = await source.read(dataStart + offset, dataStart + end)
      if (chunk.length !== end - offset + 1) throw new EpubIndexError('CORRUPT', 'Incomplete ZIP media data')
      yield chunk
    }
  }
  try {
    if (entry.method === 8) {
      await pipeline(Readable.from(compressed()), createInflateRaw(), validate, createWriteStream(temp, { flags: 'wx' }), { signal })
    } else {
      await pipeline(Readable.from(compressed()), validate, createWriteStream(temp, { flags: 'wx' }), { signal })
    }
    if (outputBytes !== entry.size || crc.digest() !== entry.crc32) throw new EpubIndexError('CORRUPT', 'ZIP media integrity check failed')
    await withCacheLock(async () => {
      try {
        await fs.rename(temp, file)
      } catch (error) {
        const existing = await fs.stat(file).catch(() => null)
        if (!existing?.isFile() || existing.size !== entry.size) throw error
        await fs.unlink(temp).catch(() => {})
      }
      mediaReservedBytes = Math.max(0, mediaReservedBytes - entry.size)
      onPublished()
      await evictMediaFilesLocked(file)
      notifyMediaSpaceWaiters()
    })
    return file
  } catch (error) {
    await fs.unlink(temp).catch(() => {})
    throw error
  } finally {
    activeTempFiles.delete(temp)
  }
}

async function prepareMediaFile(book: ReaderContentBook, rawPath: string, signal = new AbortController().signal): Promise<{ file: string; size: number; mediaType: string }> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Media request was aborted', 'AbortError')
  if (book.format !== 'epub') throw new EpubIndexError('UNSUPPORTED', 'Only EPUB media entries can be streamed')
  const prepared = await prepareReaderArchive(book)
  const normalized = normalizeReaderEntryPath(rawPath)
  if (!normalized || normalized !== rawPath.replace(/\\/g, '/')) throw new EpubIndexError('UNSUPPORTED', 'Unsafe EPUB media path')
  const entry = lookupArchiveEntry(prepared.archive, normalized)
  if (!entry) throw new EpubIndexError('UNSUPPORTED', 'EPUB media entry not found')
  if (!(entry.size >= 0 && entry.size <= MEDIA_ENTRY_MAX_BYTES)) throw new ReaderEntryLimitError()
  if (entry.flags & 0x1 || entry.compression === 'unsupported') throw new EpubIndexError('UNSUPPORTED', 'Unsupported EPUB media entry')
  const mediaType = readerMediaTypeForPath(entry.path, prepared.mediaTypes.get(entry.path) ?? prepared.mediaTypes.get(entry.path.toLowerCase()))
  if (!mediaType.startsWith('audio/') && !mediaType.startsWith('video/')) throw new EpubIndexError('UNSUPPORTED', 'EPUB entry is not audio or video')
  const file = path.join(mediaDirectory(), `${mediaKey(prepared.blobKey, entry.path)}.media`)

  while (true) {
    const cached = await withCacheLock(async () => {
      const stat = await fs.stat(file).catch(() => null)
      if (stat?.isFile() && stat.size === entry.size) {
        const now = new Date()
        await fs.utimes(file, now, now).catch(() => {})
        return true
      }
      if (stat && (activeFiles.get(file) ?? 0) === 0) await fs.unlink(file).catch(() => {})
      return false
    })
    if (cached) return { file, size: entry.size, mediaType }
    let task = preparing.get(file)
    if (task?.controller.signal.aborted) {
      await waitForPreparationCleanup(task, signal)
      continue
    }
    if (!task) {
      const controller = new AbortController()
      const state = { promise: Promise.resolve(''), settled: Promise.resolve(), controller, consumers: 0 }
      state.promise = queueMediaPreparation(async () => {
        if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('Media preparation was aborted', 'AbortError')
        await reserveMediaSpace(entry.size, controller.signal)
        let reservationHeld = true
        try {
          return await writePreparedMedia(prepared, entry, file, controller.signal, () => { reservationHeld = false })
        } finally {
          if (reservationHeld) await releaseMediaReservation(entry.size)
          reservationHeld = false
        }
      })
      task = state
      state.settled = state.promise.then(() => undefined, () => undefined).then(() => {
        if (preparing.get(file) === state) preparing.delete(file)
      })
      preparing.set(file, task)
    }
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason ?? new DOMException('Media request was aborted', 'AbortError'))
      task!.consumers += 1
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        task!.consumers -= 1
        if (task!.consumers === 0 && preparing.get(file) === task) {
          task!.controller.abort(new DOMException('No media requests remain', 'AbortError'))
        }
        if (error) reject(error)
        else resolve()
      }
      const abort = () => finish(signal.reason ?? new DOMException('Media request was aborted', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      task!.promise.then(() => finish(), finish)
    })
  }
}

export async function acquireReaderMedia(book: ReaderContentBook, entryPath: string, signal?: AbortSignal) {
  const requestSignal = signal ?? new AbortController().signal
  while (true) {
    const result = await prepareMediaFile(book, entryPath, requestSignal)
    const lease = await withCacheLock(async () => {
      const stat = await fs.stat(result.file).catch(() => null)
      if (!stat?.isFile() || stat.size !== result.size) return null
      const handle = await fs.open(result.file, 'r')
      activeFiles.set(result.file, (activeFiles.get(result.file) ?? 0) + 1)
      const now = new Date()
      await fs.utimes(result.file, now, now).catch(() => {})
      return { handle, file: result.file }
    })
    if (!lease) continue
    let releasePromise: Promise<void> | null = null
    const release = async () => {
      if (releasePromise) return releasePromise
      releasePromise = (async () => {
        await lease.handle.close().catch(() => {})
        await withCacheLock(async () => {
          const count = (activeFiles.get(result.file) ?? 1) - 1
          if (count <= 0) activeFiles.delete(result.file)
          else activeFiles.set(result.file, count)
          await evictMediaFilesLocked('')
          notifyMediaSpaceWaiters()
        })
      })()
      return releasePromise
    }
    return {
      ...result,
      createStream(range?: { start: number; end: number }) {
        const stream = lease.handle.createReadStream({ ...range, autoClose: false })
        stream.once('end', () => { void release() })
        stream.once('close', () => { void release() })
        stream.once('error', () => { void release() })
        return stream
      },
      release,
    }
  }
}

export async function setReaderMediaCacheBudgetForTests(budget: number | null): Promise<void> {
  await withCacheLock(async () => {
    mediaCacheBudget = budget ?? 1024 * 1024 * 1024
    await evictMediaFilesLocked('')
    notifyMediaSpaceWaiters()
  })
}
