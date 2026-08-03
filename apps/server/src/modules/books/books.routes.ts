import { Hono } from 'hono'
import { paginationSchema, bookMembershipSchema, bookFormatSchema, bookUpdateSchema } from '@bookdock/shared'
import {
  listBooks,
  getActiveBook,
  deleteBook,
  trashBook,
  restoreBook,
  emptyTrash,
  purgeExpiredTrash,
  uploadBook,
  updateBook,
  updateBookCover,
  removeBookCover,
  resetBookMetadata,
  getBookChapters,
  getBookContent,
  setBookShelves,
  setBookTags,
  getBookShelves,
  getBookTags,
  stripMetaChapters,
} from './books.service'
import { getTrashSettings } from '../settings/settings.service'
import { getStorage } from '../../storage'
import { config } from '../../config'

const booksRoutes = new Hono()

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
  const formatParsed = bookFormatSchema.safeParse(query['format'])
  const format = formatParsed.success ? formatParsed.data : undefined
  const readStatus = query['readStatus']
  const trash = query['trash'] === '1'
  // Opening the trash lazily purges the current user's expired rows
  if (trash) {
    await purgeExpiredTrash(user.id, getTrashSettings(user.id).autoCleanDays)
  }
  const result = await listBooks(user.id, parsed.data.page, parsed.data.pageSize, search, sortBy, sortOrder, shelfId, tagId, format, readStatus, trash)
  return c.json(result)
})

booksRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'File is required' } }, 400)
  }
  if (file.size > config.uploadMaxBytes) {
    return c.json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'File too large' } }, 413)
  }
  const book = await uploadBook(user.id, file)
  return c.json({ data: book }, 201)
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
  const book = await getActiveBook(user.id, id)
  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) {
    return c.json({ error: { code: 'BOOK_FILE_MISSING', message: 'Book file not found' } }, 404)
  }
  const size = await storage.size(book.filePath)
  const fileName = `${book.title.replace(/[^\w\u3000-\u303f\uff00-\uffef\u4e00-\u9fa5-]/g, '_')}.epub`
  // filePath is content-hash addressed; the payload never changes under the same URL.
  const headers: Record<string, string> = {
    'Content-Type': 'application/epub+zip',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, immutable, max-age=31536000',
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
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
    headers['Content-Length'] = String(range.end - range.start + 1)
    const stream = isHead ? null : await storage.get(book.filePath, range)
    return c.newResponse(stream as any, 206, headers)
  }
  headers['Content-Length'] = String(size)
  const stream = isHead ? null : await storage.get(book.filePath)
  return c.newResponse(stream as any, 200, headers)
})

booksRoutes.get('/:id/content', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await getActiveBook(user.id, id)
  const content = await getBookContent(user.id, id)
  return c.newResponse(content)
})

booksRoutes.get('/:id/epub', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const book = await getActiveBook(user.id, id)
  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) {
    return c.json({ error: { code: 'BOOK_FILE_MISSING', message: 'Book file not found' } }, 404)
  }
  const stream = await storage.get(book.filePath)
  // filePath is content-hash addressed; the payload never changes under the same URL.
  return c.newResponse(stream as any, 200, {
    'Content-Type': 'application/epub+zip',
    'Content-Length': String(await storage.size(book.filePath)),
    'Cache-Control': 'private, immutable, max-age=31536000',
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

booksRoutes.delete('/trash', async (c) => {
  const user = c.get('user')
  const count = await emptyTrash(user.id)
  return c.json({ data: { count } })
})

booksRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  await trashBook(user.id, id)
  return c.json({ data: null })
})

booksRoutes.post('/:id/restore', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
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
  const book = await getActiveBook(user.id, id)
  if (!book.coverKey) {
    return c.json({ error: { code: 'BOOK_NOT_FOUND', message: 'No cover' } }, 404)
  }
  const storage = getStorage()
  if (!(await storage.exists(book.coverKey))) {
    return c.json({ error: { code: 'BOOK_NOT_FOUND', message: 'Cover file missing' } }, 404)
  }
  const stream = await storage.get(book.coverKey)
  const ext = book.coverKey.split('.').pop()?.toLowerCase()
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  return c.newResponse(stream as any, 200, { 'Content-Type': contentType, 'Cache-Control': 'private, immutable, max-age=31536000' })
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
  const book = await resetBookMetadata(user.id, id)
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
  await setBookShelves(user.id, bookId, parsed.data.shelfIds ?? [])
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
  const shelfIds = await getBookShelves(user.id, bookId)
  return c.json({ data: shelfIds })
})

booksRoutes.get('/:id/tags', async (c) => {
  const user = c.get('user')
  const bookId = c.req.param('id')
  const tagIds = await getBookTags(user.id, bookId)
  return c.json({ data: tagIds })
})

export default booksRoutes
