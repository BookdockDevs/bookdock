import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import type { ReaderSearchEvent, ReaderSearchRequest } from '@bookdock/shared'

import type { ReaderContentBook } from './reader-content.service'
import { getReaderManifest, readReaderSearchEntry } from './reader-content.service'

const RESULT_LIMIT = 2000
const BATCH_LIMIT = 50
const CHAPTER_TIMEOUT_MS = 3000
const MAX_SEARCH_TEXT_LENGTH = 16 * 1024 * 1024
let activeSearches = 0

export function reserveReaderSearch(): boolean {
  if (activeSearches >= 1) return false
  activeSearches++
  return true
}

export function createReaderSearchStream(
  book: ReaderContentBook,
  request: ReaderSearchRequest,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let released = false
  const release = () => {
    if (released) return
    released = true
    activeSearches = Math.max(0, activeSearches - 1)
  }
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ReaderSearchEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      let scanned = 0
      let total = 0
      let status: 'complete' | 'truncated' | 'partial' | 'canceled' = 'complete'
      let worker: Worker | null = null
      try {
        const manifest = await getReaderManifest(book)
        const spine = manifest.spine.map((entry, sectionIndex) => ({ entry, sectionIndex })).filter(({ entry }) => entry.linear && entry.mediaType === 'application/xhtml+xml')
        total = spine.length
        let hitCount = 0
        let chapterFailed = false
        for (const { entry, sectionIndex } of spine) {
          if (signal.aborted) { status = 'canceled'; break }
          try {
            const source = await readReaderSearchEntry(book, entry.path)
            if (!source) { chapterFailed = true; scanned++; continue }
            if (source.data.length > 8 * 1024 * 1024) { chapterFailed = true; scanned++; continue }
            worker ??= createSearchWorker()
            const result = await scanWithWorker(worker, source.data.toString('utf8'), entry.path, request, signal)
            if (result.error) {
              if (result.error === 'regex-timeout' || result.error === 'regex-failed') {
                send({ type: 'terminal', revisionId: book.revisionId, status: 'partial', scanned, total, error: result.error })
                return
              }
            }
            const hits = result.matches ?? []
            const remaining = RESULT_LIMIT - hitCount
            for (let offset = 0; offset < hits.length && hitCount < RESULT_LIMIT; offset += BATCH_LIMIT) {
              const batch = hits.slice(offset, offset + Math.min(BATCH_LIMIT, RESULT_LIMIT - hitCount))
              if (!batch.length) break
              hitCount += batch.length
              send({
                type: 'batch', revisionId: book.revisionId, scanned, total,
                hits: batch.map((hit) => ({ sectionIndex, start: hit.start, end: hit.end, excerpt: hit.excerpt })),
              })
            }
            if (hits.length > remaining) {
              status = 'truncated'
              scanned++
              break
            }
          } catch {
            if (signal.aborted) { status = 'canceled'; break }
            chapterFailed = true
          }
          scanned++
          if (signal.aborted) { status = 'canceled'; break }
          send({ type: 'batch', revisionId: book.revisionId, scanned, total, hits: [] })
        }
        if (status === 'complete' && chapterFailed) status = 'partial'
        send({ type: 'terminal', revisionId: book.revisionId, status, scanned, total })
      } catch {
        if (signal.aborted) status = 'canceled'
        else status = 'partial'
        send({ type: 'terminal', revisionId: book.revisionId, status, scanned, total })
      } finally {
        if (worker) await worker.terminate()
        release()
        try { controller.close() } catch { /* The consumer may have canceled the stream. */ }
      }
    },
    cancel() {
      release()
    },
  })
}

interface ChapterHit { start: number; end: number; excerpt: { pre: string; match: string; post: string } }

function createSearchWorker(): Worker {
  const bundledWorker = new URL('./reader-search.worker.mjs', import.meta.url)
  const useBundledWorker = existsSync(fileURLToPath(bundledWorker))
  const workerPath = useBundledWorker ? bundledWorker : new URL('./reader-search.worker.ts', import.meta.url)
  return new Worker(workerPath, {
    ...(!useBundledWorker ? { execArgv: ['--import', 'tsx'] } : {}),
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
  })
}

export function scanChapter(markup: string, spineHref: string, request: ReaderSearchRequest, signal: AbortSignal): Promise<{ matches?: ChapterHit[]; error?: 'regex-timeout' | 'regex-failed' }> {
  if (signal.aborted) return Promise.resolve({ matches: [] })
  const worker = createSearchWorker()
  return scanWithWorker(worker, markup, spineHref, request, signal).finally(() => worker.terminate())
}

function scanWithWorker(worker: Worker, markup: string, spineHref: string, request: ReaderSearchRequest, signal: AbortSignal): Promise<{ matches?: ChapterHit[]; error?: 'regex-timeout' | 'regex-failed' }> {
  if (signal.aborted) return Promise.resolve({ matches: [] })
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: { matches?: ChapterHit[]; error?: 'regex-timeout' | 'regex-failed' }, terminate = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
      if (terminate) void worker.terminate()
      resolve(result)
    }
    const abort = () => finish({ matches: [] }, true)
    const onMessage = (candidate: unknown) => {
      const result = candidate as { text?: string; matches?: ChapterHit[]; error?: string }
      if (typeof result.text !== 'string' || result.text.length > MAX_SEARCH_TEXT_LENGTH) {
        finish({ error: 'regex-failed' }, true)
        return
      }
      if (result.error) finish({ error: 'regex-failed' }, true)
      else finish({ matches: result.matches })
    }
    const onError = () => finish({ error: 'regex-failed' }, true)
    const onExit = (code: number) => { if (code !== 0 && !settled) finish({ error: 'regex-failed' }, true) }
    const timer = setTimeout(() => finish({ error: 'regex-timeout' }), CHAPTER_TIMEOUT_MS)
    signal.addEventListener('abort', abort, { once: true })
    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
    try {
      worker.postMessage({
        markup,
        query: request.query,
        mode: request.mode,
        matchCase: request.matchCase,
        conversion: request.chineseConversion,
        replacements: request.replacements,
        spineHref,
      })
    } catch {
      finish({ error: 'regex-failed' }, true)
    }
  })
}
