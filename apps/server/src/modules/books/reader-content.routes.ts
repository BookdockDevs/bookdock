import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { Readable } from 'node:stream'

import { readerMarkupEntryDataSchema, readerMarkupEntryQuerySchema, readerSearchRequestSchema, readerTextBatchSchema } from '@bookdock/shared'

import { getActiveBook } from './books.service'
import {
  getReaderManifest,
  readReaderEntryForWeb,
  readReaderTextBatch,
  ReaderArchiveUnavailable,
  ReaderEntryLimitError,
  type ReaderContentBook,
} from './reader-content.service'
import { EpubIndexError } from '../../formats/epub-index'
import { requestUserId } from '../../middleware/auth.guard'
import { AppError } from '../../middleware/error'
import { acquireReaderMedia } from './reader-media.service'
import { parseMediaRange } from './reader-media.range'
import { createReaderSearchStream, reserveReaderSearch } from './reader-search.service'

const readerContentRoutes = new Hono()
readerContentRoutes.use('/:id/reader/search', bodyLimit({ maxSize: 128 * 1024 }))

function requestShowHidden(c: Context): boolean {
  return requestUserId(c) !== null && c.req.query('showHidden') === '1'
}

function assertReaderGuestAllowed(c: Context): void {
  if (!requestUserId(c) && c.req.query('reader') !== '1') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot download books')
  }
}

function assertRevision(book: ReaderContentBook, revisionId: string | null | undefined): void {
  if (revisionId && revisionId !== book.revisionId) {
    throw new AppError('READER_REVISION_CHANGED', 'Content revision changed; reload the book')
  }
}

async function readerBook(c: Context): Promise<ReaderContentBook> {
  assertReaderGuestAllowed(c)
  const book = await getActiveBook(requestUserId(c), c.req.param('id') ?? '', {
    showHidden: requestShowHidden(c),
  })
  assertRevision(book, c.req.query('revisionId'))
  return book
}

function entryError(error: unknown): never {
  if (error instanceof ReaderEntryLimitError) {
    throw new AppError('READER_ENTRY_TOO_LARGE', 'Reader entry exceeds the response limit')
  }
  if (error instanceof ReaderArchiveUnavailable) {
    throw new AppError(error.code, error.code === 'BOOK_FILE_MISSING' ? 'Book file not found' : 'Reader index unavailable')
  }
  if (error instanceof EpubIndexError) {
    if (error.code === 'UNSUPPORTED') throw new AppError('READER_ENTRY_UNSUPPORTED', 'Reader entry is not supported')
    if (error.code === 'LIMIT') throw new AppError('READER_ENTRY_TOO_LARGE', 'Reader entry exceeds the response limit')
    throw new AppError('READER_ENTRY_FAILED', 'Reader entry could not be read')
  }
  throw error
}

readerContentRoutes.get('/:id/reader/manifest', async (c) => {
  const book = await readerBook(c)
  try {
    const manifest = await getReaderManifest(book)
    return c.json({ data: manifest }, 200, {
      'Cache-Control': 'private, no-store',
    })
  } catch (error) {
    entryError(error)
  }
})

readerContentRoutes.post('/:id/reader/search', async (c) => {
  assertReaderGuestAllowed(c)
  const book = await getActiveBook(requestUserId(c), c.req.param('id') ?? '', {
    showHidden: requestShowHidden(c),
  })
  const parsed = readerSearchRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid reader search request', parsed.error.flatten())
  assertRevision(book, parsed.data.revisionId)
  if (book.format !== 'epub' && book.format !== 'txt') throw new AppError('READER_ENTRY_UNSUPPORTED', 'Full-book search is supported for EPUB and TXT books')
  if (!reserveReaderSearch()) throw new AppError('READER_SEARCH_BUSY', 'Reader search is busy; try again shortly')
  return c.newResponse(createReaderSearchStream(book, parsed.data, c.req.raw.signal), 200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
  })
})

readerContentRoutes.on(['GET', 'HEAD'], '/:id/reader/media', async (c) => {
  const book = await readerBook(c)
  const path = c.req.query('path') ?? ''
  if (!path) throw new AppError('VALIDATION_ERROR', 'EPUB media path is required')
  let media: Awaited<ReturnType<typeof acquireReaderMedia>> | null = null
  try {
    const opened = await acquireReaderMedia(book, path, c.req.raw.signal)
    media = opened
    const range = parseMediaRange(c.req.header('Range'), opened.size)
    if (range === 'invalid') {
      await media.release()
      media = null
      return c.newResponse(null, 416, {
        'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${opened.size}`,
        'Cache-Control': 'private, no-store',
      })
    }
    const selected = opened.size === 0 ? null : range ?? { start: 0, end: opened.size - 1 }
    if (c.req.method === 'HEAD' || !selected) {
      await media.release()
      media = null
    }
    const stream = media && selected ? opened.createStream(selected) : null
    if (stream) media = null
    return c.newResponse(stream ? Readable.toWeb(stream) as ReadableStream : null, range ? 206 : 200, {
      'Content-Type': opened.mediaType,
      'Content-Length': String(selected ? selected.end - selected.start + 1 : 0),
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${opened.size}` } : {}),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
  } catch (error) {
    await media?.release()
    if (error instanceof ReaderEntryLimitError) throw new AppError('READER_ENTRY_TOO_LARGE', 'EPUB media exceeds the media resource limit')
    if (error instanceof EpubIndexError) {
      if (error.code === 'LIMIT') throw new AppError('READER_ENTRY_TOO_LARGE', 'EPUB media exceeds the media resource limit')
      throw new AppError(error.code === 'UNSUPPORTED' ? 'READER_ENTRY_UNSUPPORTED' : 'READER_ENTRY_FAILED', 'EPUB media could not be prepared')
    }
    entryError(error)
  }
})

readerContentRoutes.get('/:id/reader/entry', async (c) => {
  const book = await readerBook(c)
  const path = c.req.query('path') ?? ''
  const query = readerMarkupEntryQuerySchema.safeParse({ includeResourceDimensions: c.req.query('includeResourceDimensions') })
  if (!query.success) throw new AppError('VALIDATION_ERROR', 'Invalid reader entry query', query.error.flatten())
  if (!path) throw new AppError('READER_ENTRY_NOT_FOUND', 'Reader entry path is required')
  try {
    const entry = await readReaderEntryForWeb(book, path, query.data.includeResourceDimensions)
    if (!entry) throw new AppError('READER_ENTRY_NOT_FOUND', 'Reader entry not found')
    const isText = entry.mediaType.startsWith('text/')
      || entry.mediaType === 'application/xhtml+xml'
      || entry.mediaType === 'application/xml'
      || entry.mediaType === 'application/x-dtbncx+xml'
      || entry.mediaType === 'application/oebps-package+xml'
      || entry.mediaType === 'application/smil+xml'
    if (entry.mediaType === 'application/xhtml+xml') {
      return c.json({ data: readerMarkupEntryDataSchema.parse({ text: entry.data.toString('utf8'), resources: entry.resources }) }, 200, {
        'Cache-Control': 'private, no-store',
      })
    }
    return c.body(new Uint8Array(entry.data), 200, {
      'Content-Type': isText ? `${entry.mediaType.split(';', 1)[0]}; charset=utf-8` : entry.mediaType,
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    })
  } catch (error) {
    entryError(error)
  }
})

readerContentRoutes.post('/:id/reader/texts', async (c) => {
  assertReaderGuestAllowed(c)
  const book = await getActiveBook(requestUserId(c), c.req.param('id') ?? '', {
    showHidden: requestShowHidden(c),
  })
  const parsed = readerTextBatchSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid reader text batch', parsed.error.flatten())
  assertRevision(book, parsed.data.revisionId)
  const result = await readReaderTextBatch(book, parsed.data.paths, parsed.data.includeResourceDimensions)
  return c.json({ data: result }, 200, {
    'Cache-Control': 'private, no-store',
  })
})

export default readerContentRoutes
