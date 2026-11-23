import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'

import {
  categoryPathSchema,
  externalArchiveDetailQuerySchema,
  externalArchiveListQuerySchema,
  externalBookListQuerySchema,
  externalDownloadLinkSchema,
  externalLibraryIdSchema,
  externalWorkPatchSchema,
  type ExternalLibrariesRes,
  type ExternalUploadRes,
  type ExternalWorkPatchRes,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { effectiveUploadMaxBytes } from '../auth/auth.service'
import { streamBookFile } from '../books/book-file-response'
import { manageBookShare } from '../books/book-shares.service'
import { getActiveBook, uploadBook, uploadCatalogBook } from '../books/books.service'
import { requireLibraryManager } from '../libraries/library-access'
import { isTitleNormalizeEnabled } from '../settings/settings.service'
import { getExternalArchive, getExternalArchiveOverview } from './ext-archives.service'
import {
  deleteExternalBook,
  EXT_READ,
  getExternalBook,
  listExternalBooks,
  listExternalLibraries,
  updateExternalBook,
} from './ext.service'

/**
 * The external API provides catalog operations and personal archive reads for
 * automation clients.
 *
 * It is a separate surface from `/api/v1/**` rather than a path-scoped subset of
 * it, because the Web's book list is a sidebar projection whose fields
 * (`progress`, `readStatus`, a single-valued `shelfId` for drag-to-shelf checks)
 * an external client cannot distinguish from real domain data, and which would
 * change whenever the Web UI does. The Legado facade is the same idea for the
 * same reason: a client with its own needs gets its own contract.
 *
 */
const extRoutes = new Hono()

const libraryQuerySchema = z.object({ libraryId: externalLibraryIdSchema.optional() })

extRoutes.get('/libraries', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const libraries = await listExternalLibraries(user.id)
  return c.json({ data: { libraries } satisfies ExternalLibrariesRes })
})

extRoutes.get('/books', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = externalBookListQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten())
  }
  return c.json({ data: await listExternalBooks(user.id, parsed.data) })
})

extRoutes.get('/books/:versionId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const query = libraryQuerySchema.safeParse(c.req.query())
  if (!query.success) throw new AppError('VALIDATION_ERROR', 'Invalid query', query.error.flatten())
  return c.json({ data: await getExternalBook(user.id, c.req.param('versionId'), query.data.libraryId) })
})

extRoutes.patch('/books/:versionId', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')
  const libraryId = externalLibraryIdSchema.safeParse(c.req.query('libraryId'))
  if (!libraryId.success) throw new AppError('VALIDATION_ERROR', 'A libraryId is required')
  const patch = externalWorkPatchSchema.safeParse(await c.req.json().catch(() => null))
  if (!patch.success) throw new AppError('VALIDATION_ERROR', 'Invalid work patch', patch.error.flatten())
  const data = await updateExternalBook(user.id, libraryId.data, c.req.param('versionId'), patch.data)
  return c.json({ data } satisfies { data: ExternalWorkPatchRes })
})

extRoutes.get('/reading-archives', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')
  const query = c.req.query()
  c.header('Cache-Control', 'private, no-store')
  if (query.archiveId !== undefined) {
    const parsed = externalArchiveDetailQuerySchema.safeParse(query)
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid archive query', parsed.error.flatten())
    return c.json({ data: await getExternalArchive(user.id, parsed.data) })
  }
  const parsed = externalArchiveListQuerySchema.safeParse(query)
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Invalid archive query', parsed.error.flatten())
  return c.json({ data: await getExternalArchiveOverview(user.id, parsed.data) })
})

/**
 * Download. GET rather than POST because `Range` is only honoured on GET/HEAD,
 * and that is what gives a client `curl -C -` resume, partial reads, and the
 * ability to hand the URL to any downloader without teaching it a method. The
 * response itself is the Web's, extracted so the two cannot drift.
 */
const download = async (c: Context, versionId: string) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  // getActiveBook is the readability gate, and it resolves a library version as
  // well as a private card, so a member can fetch a shared library's file.
  // showHidden because the listing already shows a manager the vault's hidden
  // rows; refusing them here would make the list point at 404s.
  const book = await getActiveBook(user.id, versionId, EXT_READ)
  return streamBookFile(c, book)
}
extRoutes.get('/books/:versionId/file', (c) => download(c, c.req.param('versionId')))
extRoutes.on('HEAD', '/books/:versionId/file', (c) => download(c, c.req.param('versionId')))

extRoutes.post('/books/:versionId/download-link', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED', 'Login required')
  const input: unknown = await c.req.json().catch(() => null)
  const body = externalDownloadLinkSchema.safeParse(input)
  if (!body.success) throw new AppError('VALIDATION_ERROR', 'Invalid download link options', body.error.flatten())
  c.header('Cache-Control', 'private, no-store')
  if (body.data.action === 'revoke') {
    manageBookShare(user.id, c.req.param('versionId'), body.data.libraryId, { type: 'revoke' })
    return c.json({ data: null })
  }
  const link = manageBookShare(user.id, c.req.param('versionId'), body.data.libraryId, { type: 'get-or-create', duration: body.data.duration })
  if (!link) throw new AppError('INTERNAL_ERROR', 'Download link could not be created')
  const origin = new URL(c.req.url)
  if (origin.protocol === 'http:' && c.req.header('x-forwarded-proto') === 'https') origin.protocol = 'https:'
  return c.json({ data: { ...link, url: new URL(link.url, origin).toString() } })
})

extRoutes.post('/books', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const body = await c.req.parseBody()
  const file = body['file']
  if (!(file instanceof File)) {
    throw new AppError('VALIDATION_ERROR', 'File is required')
  }
  if (file.size > effectiveUploadMaxBytes()) {
    throw new AppError('UPLOAD_TOO_LARGE', 'File too large')
  }
  const libraryId = typeof body['libraryId'] === 'string' && body['libraryId'] ? body['libraryId'] : undefined
  // A category is a value, so a client sends the names rather than an id. Form
  // bodies are flat, so the path arrives as a JSON array string.
  const rawCategoryPath = typeof body['categoryPath'] === 'string' && body['categoryPath'] ? body['categoryPath'] : undefined
  let categoryPath: string[] | undefined
  if (rawCategoryPath) {
    try {
      categoryPath = categoryPathSchema.parse(JSON.parse(rawCategoryPath))
    } catch {
      throw new AppError('VALIDATION_ERROR', 'categoryPath must be a JSON array of one or two names')
    }
  }
  const shelfId = typeof body['shelfId'] === 'string' && body['shelfId'] ? body['shelfId'] : undefined
  const normalizeTitle = isTitleNormalizeEnabled(user.id)
  // Two upload paths because the domain has two: uploadBook always writes to the
  // caller's private library, while uploadCatalogBook targets a named one and
  // enforces requireLibraryManager itself. Both report duplication, which is
  // what lets a client re-run the same folder safely.
  const result = libraryId
    ? await uploadCatalogBook(libraryId, user.id, file, { normalizeTitle, categoryPath, shelfId })
    : await uploadBook(user.id, file, { shelfId, categoryPath }, { normalizeTitle }).then((r) => ({
      bookVersionId: r.book.id,
      duplicated: r.duplicated,
    }))

  const detail = await getActiveBook(user.id, result.bookVersionId, EXT_READ)
  return c.json({
    data: {
      bookVersionId: result.bookVersionId,
      title: detail.title,
      author: detail.author,
      sourceFormat: detail.format,
      size: detail.size,
      // The whole reason this endpoint can be re-run safely: a client must be
      // able to tell "I added a book" from "that file was already here".
      duplicated: result.duplicated,
    } satisfies ExternalUploadRes,
  }, 201)
})

extRoutes.delete('/books/:versionId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = libraryQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten())
  }
  // Authorization and the trash target both use the named library.
  if (parsed.data.libraryId) await requireLibraryManager(user.id, parsed.data.libraryId)
  return c.json({ data: await deleteExternalBook(user.id, c.req.param('versionId'), parsed.data.libraryId) })
})

export default extRoutes
