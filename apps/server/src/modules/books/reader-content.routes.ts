import { Hono, type Context } from 'hono'

import { readerMarkupEntryDataSchema, readerMarkupEntryQuerySchema, readerTextBatchSchema } from '@bookdock/shared'

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

const readerContentRoutes = new Hono()

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
