import { Hono, type Context } from 'hono'
import { appendContentSchema, paginationSchema, bookMembershipSchema, bookFormatSchema, bookUpdateSchema, reTocSchema, tocPreviewSchema } from '@bookdock/shared'
import {
  listBooks,
  getActiveBook,
  deleteBook,
  trashBook,
  restoreBook,
  emptyTrash,
  purgeExpiredTrash,
  purgeTrashToCapacity,
  uploadBook,
  updateBook,
  updateBookCover,
  removeBookCover,
  resetBookMetadata,
  getBookChapters,
  getBookContent,
  getBookCoverContent,
  setBookShelf,
  setBookTags,
  getBookShelf,
  getBookTags,
  stripMetaChapters,
  bufferFromStream,
  reTocBook,
  previewBookToc,
  previewAppendTxtBookContent,
  appendTxtBookContent,
} from './books.service'
import { getTrashSettings, isTitleNormalizeEnabled, isTrashEnabled } from '../settings/settings.service'
import { effectiveUploadMaxBytes } from '../auth/auth.service'
import { getStorage } from '../../storage'
import { AppError } from '../../middleware/error'
import { decodeTextBuffer } from '../../formats/txt'
import { exportEpubBook, exportTxtBook } from './txt-export'

const booksRoutes = new Hono()
const appendOptionsSchema = appendContentSchema.pick({ startOffset: true })

// Download filenames keep word chars plus CJK punctuation/ideographs, '_' else.
function safeFileBase(title: string): string {
  return title.replace(/[^\w\u3000-\u303f\uff00-\uffef\u4e00-\u9fa5-]/g, '_')
}

async function parseAppendRequest(c: Context): Promise<{ text: string; startOffset?: number }> {
  const maxBytes = effectiveUploadMaxBytes()
  const contentType = c.req.header('content-type') ?? ''
  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const body = await c.req.parseBody()
    const rawFile = body['file']
    if (rawFile !== undefined) {
      if (!(rawFile instanceof File)) throw new AppError('VALIDATION_ERROR', 'File is invalid')
      if (body['text'] !== undefined) throw new AppError('VALIDATION_ERROR', 'Provide either a file or text')
      if (!rawFile.name.toLowerCase().endsWith('.txt')) throw new AppError('UNSUPPORTED_FORMAT', 'Append file must be a TXT file')
      if (rawFile.size > maxBytes) throw new AppError('UPLOAD_TOO_LARGE', 'File too large')
      const buffer = Buffer.from(await rawFile.arrayBuffer())
      if (buffer.length > maxBytes) throw new AppError('UPLOAD_TOO_LARGE', 'File too large')
      const options = appendOptionsSchema.safeParse({ startOffset: body['startOffset'] })
      if (!options.success) throw new AppError('VALIDATION_ERROR', 'Invalid append start offset', options.error.flatten())
      return { text: decodeTextBuffer(buffer), startOffset: options.data.startOffset }
    }

    const parsed = appendContentSchema.safeParse({ text: body['text'], startOffset: body['startOffset'] })
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid append content', parsed.error.flatten())
    if (Buffer.byteLength(parsed.data.text, 'utf8') > maxBytes) throw new AppError('UPLOAD_TOO_LARGE', 'Text too large')
    return parsed.data
  }

  const parsed = appendContentSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid append content', parsed.error.flatten())
  if (Buffer.byteLength(parsed.data.text, 'utf8') > maxBytes) throw new AppError('UPLOAD_TOO_LARGE', 'Text too large')
  return parsed.data
}

booksRoutes.get('/', async (c) => {
  const query = c.req.query()
  const parsed = paginationSchema.safeParse(query)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid pagination', details: parsed.error.flatten() } }, 400)
  }
  const user = c.get('user')
  const search = query['search']
  const sortBy = query['sortBy']
  const sortOrder = query['sortOrder']
  const shelfId = query['shelfId']
  const tagId = query['tagId']
  const author = query['author']
  const series = query['series']
  const formatParsed = bookFormatSchema.safeParse(query['format'])
  const format = formatParsed.success ? formatParsed.data : undefined
  const readStatus = query['readStatus']
  const trash = query['trash'] === '1'
  if (trash && (c.get('guest') === true || user.role === 'guest')) {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot access trash')
  }
  // Opening the trash lazily runs both cleanup rules for the current user
  if (trash) {
    if (!isTrashEnabled(user.id)) throw new AppError('TRASH_DISABLED', 'Trash is disabled')
    const trashSettings = getTrashSettings(user.id)
    await purgeExpiredTrash(user.id, trashSettings.autoCleanDays)
    await purgeTrashToCapacity(user.id, trashSettings.maxTrashBytes ?? 0)
  }
  const result = await listBooks(user.id, parsed.data.page, parsed.data.pageSize, search, sortBy, sortOrder, shelfId, tagId, format, readStatus, trash, author, series)
  return c.json(result)
})

booksRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'File is required' } }, 400)
  }
  if (file.size > effectiveUploadMaxBytes()) {
    return c.json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'File too large' } }, 413)
  }
  const rawTagIds = body['tagIds']
  let tagIds: unknown
  if (rawTagIds !== undefined) {
    if (typeof rawTagIds !== 'string') {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid tagIds' } }, 400)
    }
    try {
      tagIds = JSON.parse(rawTagIds)
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid tagIds' } }, 400)
    }
  }
  const membership = bookMembershipSchema.safeParse({ shelfId: body['shelfId'], tagIds })
  if (!membership.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid membership', details: membership.error.flatten() } }, 400)
  }
  const { book, duplicated } = await uploadBook(user.id, file, membership.data, { normalizeTitle: isTitleNormalizeEnabled(user.id) })
  return c.json({ data: book, duplicated }, 201)
})

// Parses a single-range `Range: bytes=...` header against the blob size.
// Returns null when the header is absent or not a simple bytes range (RFC 9110:
// ignore and serve 200), 'invalid' for malformed or unsatisfiable ranges (416),
// or the resolved inclusive byte range.
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

booksRoutes.on(['GET', 'HEAD'], '/:id/file', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  if ((c.get('guest') || user.role === 'guest') && c.req.query('reader') !== '1') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot download books')
  }
  const book = await getActiveBook(user.id, id)
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
  // bridging can close its ReadableStream twice, throwing ERR_INVALID_STATE
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
})

booksRoutes.get('/:id/content', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot download books')
  }
  const id = c.req.param('id')
  await getActiveBook(user.id, id)
  const content = await getBookContent(user.id, id)
  return c.newResponse(content)
})

booksRoutes.get('/:id/epub', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot download books')
  }
  const id = c.req.param('id')
  const book = await getActiveBook(user.id, id)
  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) {
    throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  }
  const body = new Uint8Array(await bufferFromStream(await storage.get(book.filePath)))
  // filePath is content-hash addressed; the payload never changes under the same URL.
  return c.newResponse(body, 200, {
    'Content-Type': 'application/epub+zip',
    'Content-Length': String(await storage.size(book.filePath)),
    'Cache-Control': 'private, immutable, max-age=31536000',
  })
})

// P4: edited TXT export — the book's normalized text with the requesting
// user's effective replacements applied. TXT books only. `?plain=1` skips the
// replacements; without effective rules the filename falls back to 原文 too
// (the content is identical, the 校订版 label would be dishonest).
booksRoutes.get('/:id/export.txt', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot export books')
  }
  const id = c.req.param('id')
  const plain = c.req.query('plain') === '1'
  const { text, title, edited } = await exportTxtBook(user.id, id, plain)
  const fileName = plain || !edited ? `${safeFileBase(title)}.txt` : `${safeFileBase(title)}.校订版.txt`
  return c.newResponse(new TextEncoder().encode(text), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  })
})

// P4: EPUB export — regenerated on demand (never a stored blob) from the
// book's chapters with the user's effective replacements applied. TXT books
// only; the 校订版 filename uses a hyphen (not the txt variant's dot) so the
// two stems stay distinct. `?plain=1` skips the replacements; without effective
// rules the filename is the 原文 form (same rule as export.txt above).
booksRoutes.get('/:id/export.epub', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot export books')
  }
  const id = c.req.param('id')
  const plain = c.req.query('plain') === '1'
  const { buffer, title, edited } = await exportEpubBook(user.id, id, plain)
  const fileName = plain || !edited ? `${safeFileBase(title)}.epub` : `${safeFileBase(title)}-校订版.epub`
  return c.newResponse(new Uint8Array(buffer), 200, {
    'Content-Type': 'application/epub+zip',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  })
})

booksRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const book = await getActiveBook(user.id, id)
  return c.json({ data: stripMetaChapters(book) })
})

booksRoutes.get('/:id/chapters', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await getActiveBook(user.id, id)
  const chapters = await getBookChapters(user.id, id)
  return c.json({ data: chapters })
})

booksRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const book = await updateBook(user.id, id, parsed.data)
  return c.json({ data: book })
})

booksRoutes.post('/:id/toc-preview', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const parsed = tocPreviewSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const preview = await previewBookToc(user.id, id, parsed.data)
  return c.json({ data: preview })
})

booksRoutes.post('/:id/append-preview', async (c) => {
  const user = c.get('user')
  const { text, startOffset } = await parseAppendRequest(c)
  const preview = await previewAppendTxtBookContent(user.id, c.req.param('id'), text, startOffset)
  return c.json({ data: preview })
})

booksRoutes.post('/:id/append', async (c) => {
  const user = c.get('user')
  const { text, startOffset } = await parseAppendRequest(c)
  const book = await appendTxtBookContent(user.id, c.req.param('id'), text, startOffset)
  return c.json({ data: book })
})

booksRoutes.post('/:id/re-toc', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const parsed = reTocSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await reTocBook(user.id, id, parsed.data.tocRuleId, parsed.data.customPatterns, parsed.data.excludedChapterIds)
  const book = await getActiveBook(user.id, id)
  return c.json({ data: stripMetaChapters(book) })
})

booksRoutes.delete('/trash', async (c) => {
  const user = c.get('user')
  if (!isTrashEnabled(user.id)) throw new AppError('TRASH_DISABLED', 'Trash is disabled')
  const count = await emptyTrash(user.id)
  return c.json({ data: { count } })
})

booksRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  // With trash disabled, deletion is immediate and unrecoverable.
  if (isTrashEnabled(user.id)) await trashBook(user.id, id)
  else await deleteBook(user.id, id)
  return c.json({ data: null })
})

booksRoutes.post('/:id/restore', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  if (!isTrashEnabled(user.id)) throw new AppError('TRASH_DISABLED', 'Trash is disabled')
  await restoreBook(user.id, id)
  return c.json({ data: null })
})

booksRoutes.delete('/:id/permanent', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await deleteBook(user.id, id)
  return c.json({ data: null })
})

booksRoutes.get('/:id/cover', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const size = c.req.query('size') === 'original' ? 'original' : 'thumb'
  const download = c.req.query('download') === '1' || c.req.query('download') === 'true'
  const cover = await getBookCoverContent(user.id, id, { size })
  if (!cover) {
    return c.json({ error: { code: 'BOOK_NOT_FOUND', message: 'No cover' } }, 404)
  }
  const headers: Record<string, string> = {
    'Content-Type': cover.contentType,
    'Cache-Control': 'private, immutable, max-age=31536000',
  }
  if (download) {
    const book = await getActiveBook(user.id, id)
    const safeTitle = (book.title || 'cover').replace(/[\\/:*?"<>|]/g, '_').trim()
    const filename = `${safeTitle}-cover.${cover.ext}`
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
  }
  return c.newResponse(new Uint8Array(cover.data), 200, headers)
})

booksRoutes.put('/:id/cover', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'File is required' } }, 400)
  }
  const book = await updateBookCover(user.id, id, file)
  return c.json({ data: book })
})

booksRoutes.delete('/:id/cover', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const book = await removeBookCover(user.id, id)
  return c.json({ data: book })
})

booksRoutes.post('/:id/reset-metadata', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const book = await resetBookMetadata(user.id, id, { normalizeTitle: isTitleNormalizeEnabled(user.id) })
  return c.json({ data: book })
})

booksRoutes.put('/:id/shelves', async (c) => {
  const user = c.get('user')
  const bookId = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookMembershipSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await setBookShelf(user.id, bookId, parsed.data.shelfId ?? null)
  return c.json({ data: null })
})

booksRoutes.put('/:id/tags', async (c) => {
  const user = c.get('user')
  const bookId = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookMembershipSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await setBookTags(user.id, bookId, parsed.data.tagIds ?? [])
  return c.json({ data: null })
})

booksRoutes.get('/:id/shelves', async (c) => {
  const user = c.get('user')
  const bookId = c.req.param('id')
  const shelfId = await getBookShelf(user.id, bookId)
  return c.json({ data: shelfId })
})

booksRoutes.get('/:id/tags', async (c) => {
  const user = c.get('user')
  const bookId = c.req.param('id')
  const tagIds = await getBookTags(user.id, bookId)
  return c.json({ data: tagIds })
})

export default booksRoutes
