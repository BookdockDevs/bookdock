import type { Context } from 'hono'

import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { bufferFromStream } from './books.service'

/**
 * Serving a book file as an HTTP response, shared by the Web download route and
 * the external API.
 *
 * It lives here rather than being written twice because the details are the
 * whole point: Range parsing, the 416 envelope, HEAD returning headers without
 * a body, and buffering instead of piping. A second copy of that would drift,
 * and the failure mode is a download that silently loses resume support.
 */

/** Download filenames keep word chars plus CJK punctuation/ideographs, '_' else. */
export function safeFileBase(title: string): string {
  return title.replace(/[^\w\u3000-\u303f\uff00-\uffef\u4e00-\u9fa5-]/g, '_')
}

/**
 * Parses a single-range `Range: bytes=...` header against the blob size.
 * Returns null when the header is absent or not a simple bytes range (RFC 9110:
 * ignore and serve 200), 'invalid' for malformed or unsatisfiable ranges (416),
 * or the resolved inclusive byte range.
 */
function parseRangeHeader(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header || header.includes(',')) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid'
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (suffix <= 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (start >= size || start > end) return 'invalid'
  return { start, end }
}

/**
 * GET is required rather than a POST with a verb in the path: `Range` is only
 * honoured on GET/HEAD, and that is what gives a client `curl -C -` resume,
 * partial reads, and the ability to hand the URL to any downloader.
 */
export async function streamBookFile(c: Context, book: { filePath: string; title: string }) {
  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) {
    throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  }
  const size = await storage.size(book.filePath)
  const fileName = `${safeFileBase(book.title)}.epub`
  // No HTTP caching on purpose: the URL is content-hash addressed (immutable
  // by design), but when the browser caches the full file, zip.js's Range
  // reads are served FROM that cached entry — Chrome's range reads over a
  // multi-MB cache entry are ~300-400ms each and occasionally stall forever
  // (first-open spin + 30s timeout). In-session reuse is handled by the
  // client parseCache anyway, so always fetch fresh ranges from the server.
  const headers: Record<string, string> = {
    'Content-Type': 'application/epub+zip',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  }
  const range = parseRangeHeader(c.req.header('Range'), size)
  if (range === 'invalid') {
    return c.json(
      { error: { code: 'RANGE_NOT_SATISFIABLE', message: 'Requested range not satisfiable' } },
      416,
      { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
    )
  }
  const isHead = c.req.method === 'HEAD'
  // Buffered bodies instead of raw node streams: when the client aborts
  // mid-transfer (zip.js range probes, navigation away), undici's stream
  // bridging can close the ReadableStream twice, throwing ERR_INVALID_STATE
  // as an uncaughtException that kills the whole server process
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
    headers['Content-Length'] = String(range.end - range.start + 1)
    const body = isHead ? null : new Uint8Array(await bufferFromStream(await storage.get(book.filePath, range)))
    return c.newResponse(body, 206, headers)
  }
  headers['Content-Length'] = String(size)
  const body = isHead ? null : new Uint8Array(await bufferFromStream(await storage.get(book.filePath)))
  return c.newResponse(body, 200, headers)
}
