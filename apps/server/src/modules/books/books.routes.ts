import { Hono, type Context } from 'hono'
import { appendContentSchema, batchOrganizeSchema, batchSelectionSchema, paginationSchema, bookMembershipSchema, bookFormatSchema, bookUpdateSchema, readerBookSettingsSchema, readRevisionSchema, reTocSchema, tocPreviewSchema } from '@bookdock/shared'
import {
  listBooks,
  getActiveBook,
  attachOwnsSource,
  attachUnreadUpdate,
  acknowledgeReadRevision,
  attachPublishedTo,
  deleteBook,
  resolveLibraryBook,
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
  assertReadableBook,
  getPrivateBatchSelection,
  organizePrivateBatch,
} from './books.service'
import { updateReaderBookSettings } from './reader-settings.service'
import { forkLocalBook } from '../libraries/fork.service'
import { getTrashSettings, isTitleNormalizeEnabled, isTrashEnabled } from '../settings/settings.service'
import { effectiveUploadMaxBytes } from '../auth/auth.service'
import { getStorage } from '../../storage'
import { AppError } from '../../middleware/error'
import { safeFileBase, streamBookFile } from './book-file-response'
import { requestUserId } from '../../middleware/auth.guard'
import { decodeTextBuffer } from '../../formats/txt'
import { exportEpubBook, exportTxtBook } from './txt-export'

const booksRoutes = new Hono()
const appendOptionsSchema = appendContentSchema.pick({ startOffset: true })

booksRoutes.post('/batch/selection', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest') || user.role === 'guest') throw new AppError('FORBIDDEN')
  const parsed = batchSelectionSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid selection', parsed.error.flatten())
  return c.json({ data: getPrivateBatchSelection(user.id, parsed.data.ids) })
})

booksRoutes.patch('/batch/organize', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest') || user.role === 'guest') throw new AppError('FORBIDDEN')
  const parsed = batchOrganizeSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid batch organization', parsed.error.flatten())
  return c.json({ data: organizePrivateBatch(user.id, parsed.data) })
})

// Private-vault reveal: the owner passes ?showHidden=1 to see hidden rows;
// guests (requestUserId null) can never reveal.
function requestShowHidden(c: Context): boolean {
  return requestUserId(c) !== null && c.req.query('showHidden') === '1'
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
    throw new AppError('VALIDATION_ERROR', 'Invalid pagination', parsed.error.flatten())
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
  const result = await listBooks(user.id, parsed.data.page, parsed.data.pageSize, search, sortBy, sortOrder, shelfId, tagId, format, readStatus, trash, author, series, requestShowHidden(c))
  return c.json(result)
})

booksRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    throw new AppError('VALIDATION_ERROR', 'File is required')
  }
  if (file.size > effectiveUploadMaxBytes()) {
    throw new AppError('UPLOAD_TOO_LARGE', 'File too large')
  }
  const rawTagIds = body['tagIds']
  let tagIds: unknown
  if (rawTagIds !== undefined) {
    if (typeof rawTagIds !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'Invalid tagIds')
    }
    try {
      tagIds = JSON.parse(rawTagIds)
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Invalid tagIds')
    }
  }
  const membership = bookMembershipSchema.safeParse({ shelfId: body['shelfId'], tagIds })
  if (!membership.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid membership', membership.error.flatten())
  }
  const { book, duplicated } = await uploadBook(user.id, file, membership.data, { normalizeTitle: isTitleNormalizeEnabled(user.id) })
  return c.json({ data: book, duplicated }, 201)
})

booksRoutes.on(['GET', 'HEAD'], '/:id/file', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  if ((c.get('guest') || user.role === 'guest') && c.req.query('reader') !== '1') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot download books')
  }
  const book = await getActiveBook(requestUserId(c), id, { showHidden: requestShowHidden(c) })
  if (c.req.query('revisionId') && c.req.query('revisionId') !== book.revisionId) {
    throw new AppError('VALIDATION_ERROR', 'Content revision changed; reopen the book')
  }
  return streamBookFile(c, book)
})

booksRoutes.get('/:id/content', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot download books')
  }
  const id = c.req.param('id')
  await getActiveBook(user.id, id, { showHidden: requestShowHidden(c) })
  const content = await getBookContent(user.id, id, { showHidden: requestShowHidden(c) })
  return c.newResponse(content)
})

booksRoutes.get('/:id/epub', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot download books')
  }
  const id = c.req.param('id')
  const book = await getActiveBook(user.id, id, { showHidden: requestShowHidden(c) })
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
// user's effective replacements applied. Both formats support TXT. `?plain=1` skips the
// replacements; without effective rules the filename falls back to 原文 too
// (the content is identical, the 校订版 label would be dishonest).
booksRoutes.get('/:id/export.txt', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot export books')
  }
  const id = c.req.param('id')
  const plain = c.req.query('plain') === '1'
  const { text, title, edited } = await exportTxtBook(user.id, id, plain, { showHidden: requestShowHidden(c) })
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
  const { buffer, title, edited } = await exportEpubBook(user.id, id, plain, { showHidden: requestShowHidden(c) })
  const fileName = plain || !edited ? `${safeFileBase(title)}.epub` : `${safeFileBase(title)}-校订版.epub`
  return c.newResponse(new Uint8Array(buffer), 200, {
    'Content-Type': 'application/epub+zip',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  })
})

booksRoutes.put('/:id/read-revision', async (c) => {
  const userId = requestUserId(c)
  if (!userId) throw new AppError('FORBIDDEN')
  const parsed = readRevisionSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid content revision')
  const data = await acknowledgeReadRevision(userId, c.req.param('id'), parsed.data.revisionId, requestShowHidden(c))
  return c.json({ data })
})

booksRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const book = await getActiveBook(requestUserId(c), id, { showHidden: requestShowHidden(c) })
  const uid = requestUserId(c)
  const detailed = await attachUnreadUpdate(uid, await attachOwnsSource(uid, book))
  return c.json({ data: stripMetaChapters(await attachPublishedTo(uid, detailed)) })
})

booksRoutes.get('/:id/chapters', async (c) => {
  const readerId = requestUserId(c)
  const id = c.req.param('id')
  await getActiveBook(readerId, id, { showHidden: requestShowHidden(c) })
  const chapters = await getBookChapters(readerId, id, { showHidden: requestShowHidden(c) })
  return c.json({ data: chapters })
})

booksRoutes.patch('/:id/reader-settings', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') {
    throw new AppError('FORBIDDEN', 'Guest sessions cannot save reader settings')
  }
  const id = c.req.param('id')
  await assertReadableBook(user.id, id, requestShowHidden(c))
  const parsed = readerBookSettingsSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid reader settings', parsed.error.flatten())
  }
  return c.json({ data: updateReaderBookSettings(user.id, id, parsed.data) })
})

booksRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookUpdateSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten())
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
    throw new AppError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten())
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
    throw new AppError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten())
  }
  await reTocBook(user.id, id, parsed.data.tocRuleId, parsed.data.customPatterns, parsed.data.excludedChapterIds)
  const book = await getActiveBook(user.id, id, { showHidden: true })
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
  const deleteUserData = c.req.query('deleteUserData') === 'true'
  const bookInfo = resolveLibraryBook(user.id, id)
  const isCollected = bookInfo.kind === 'shared'

  if (isCollected) {
    await deleteBook(user.id, id, { deleteUserData })
  } else if (isTrashEnabled(user.id)) {
    await trashBook(user.id, id)
  } else {
    await deleteBook(user.id, id, { deleteUserData })
  }
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
  const deleteUserData = c.req.query('deleteUserData') === 'true'
  await deleteBook(user.id, id, { deleteUserData })
  return c.json({ data: null })
})

booksRoutes.get('/:id/cover', async (c) => {
  const readerId = requestUserId(c)
  const id = c.req.param('id')
  const size = c.req.query('size') === 'original' ? 'original' : 'thumb'
  const download = c.req.query('download') === '1' || c.req.query('download') === 'true'
  const cover = await getBookCoverContent(readerId, id, { size })
  if (!cover) {
    throw new AppError('BOOK_NOT_FOUND', 'No cover')
  }
  const headers: Record<string, string> = {
    'Content-Type': cover.contentType,
    'Cache-Control': 'private, immutable, max-age=31536000',
  }
  if (download) {
    const book = await getActiveBook(readerId, id, { showHidden: requestShowHidden(c) })
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
    throw new AppError('VALIDATION_ERROR', 'File is required')
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

// B rescue: fork a collected reference into an independent local copy.
// The same card swaps to a new BookVersion; the city copy is untouched.
booksRoutes.post('/:id/fork', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')
  const result = await forkLocalBook(user.id, c.req.param('id'))
  return c.json({ data: result }, 201)
})



booksRoutes.put('/:id/shelves', async (c) => {
  const user = c.get('user')
  const bookId = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookMembershipSchema.safeParse(body)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten())
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
    throw new AppError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten())
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
