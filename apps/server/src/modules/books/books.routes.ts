import { Hono } from 'hono'
import { paginationSchema, bookMembershipSchema, bookFormatSchema, bookUpdateSchema } from '@bookdock/shared'
import {
  listBooks,
  getActiveBook,
  deleteBook,
  trashBook,
  restoreBook,
  emptyTrash,
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

booksRoutes.get('/:id/file', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const book = await getActiveBook(user.id, id)
  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) {
    return c.json({ error: { code: 'BOOK_FILE_MISSING', message: 'Book file not found' } }, 404)
  }
  const stream = await storage.get(book.filePath)
  const fileName = `${book.title.replace(/[^\w\u3000-\u303f\uff00-\uffef\u4e00-\u9fa5-]/g, '_')}.epub`
  // filePath is content-hash addressed; the payload never changes under the same URL.
  return c.newResponse(stream as any, 200, {
    'Content-Type': 'application/epub+zip',
    'Content-Length': String(await storage.size(book.filePath)),
    'Cache-Control': 'private, immutable, max-age=31536000',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  })
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
