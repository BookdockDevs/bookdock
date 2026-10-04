import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'

import type { ExternalLibrariesRes, ExternalUploadRes } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { effectiveUploadMaxBytes } from '../auth/auth.service'
import { streamBookFile } from '../books/book-file-response'
import { getActiveBook, uploadBook, uploadCatalogBook } from '../books/books.service'
import { requireLibraryManager } from '../libraries/library-access'
import { isTitleNormalizeEnabled } from '../settings/settings.service'
import {
  deleteExternalBook,
  EXT_READ,
  getExternalBook,
  listExternalBooks,
  listExternalLibraries,
} from './ext.service'

/**
 * The external API for automation clients: read what is in the library, upload,
 * download, and move to trash.
 *
 * It is a separate surface from `/api/v1/**` rather than a path-scoped subset of
 * it, because the Web's book list is a sidebar projection whose fields
 * (`progress`, `readStatus`, a single-valued `shelfId` for drag-to-shelf checks)
 * an external client cannot distinguish from real domain data, and which would
 * change whenever the Web UI does. The Legado facade is the same idea for the
 * same reason: a client with its own needs gets its own contract.
 *
 * Chapter bodies, TOCs, progress, taxonomy editing, version management and
 * library administration are all absent on purpose. They have real workflows
 * behind them in the Web, and the Web is where a person does those things.
 */
const extRoutes = new Hono()

const listQuerySchema = z.object({
  libraryId: z.string().min(1).max(128).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  format: z.enum(['epub', 'txt']).optional(),
  sortBy: z.enum(['title', 'createdAt', 'updatedAt', 'size']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  // Unix ms watermark. A syncing client keeps the highest `updatedAt` it has
  // seen and sends it back, so a run after the first only transfers what moved.
  updatedSince: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

const writeQuerySchema = z.object({ libraryId: z.string().min(1).max(128).optional() })

extRoutes.get('/libraries', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const libraries = await listExternalLibraries(user.id)
  return c.json({ data: { libraries } satisfies ExternalLibrariesRes })
})

extRoutes.get('/books', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = listQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten())
  }
  return c.json({ data: await listExternalBooks(user.id, parsed.data) })
})

extRoutes.get('/books/:versionId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: await getExternalBook(user.id, c.req.param('versionId')) })
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
  // A shelf is optional in the same way it is in the Web's own upload dialog:
  // omitted means uncategorized, which is what the homepage upload does. It is
  // only meaningful together with a libraryId, because the private library is
  // where an unnamed-library upload already lands — sending a category without
  // one would silently drop it.
  const categoryId = typeof body['categoryId'] === 'string' && body['categoryId'] && libraryId
    ? body['categoryId']
    : undefined
  const normalizeTitle = isTitleNormalizeEnabled(user.id)
  // Two upload paths because the domain has two: uploadBook always writes to the
  // caller's private library, while uploadCatalogBook targets a named one and
  // enforces requireLibraryManager itself. Both report duplication, which is
  // what lets a client re-run the same folder safely.
  const result = libraryId
    ? await uploadCatalogBook(libraryId, user.id, file, { normalizeTitle, categoryId })
    : await uploadBook(user.id, file, undefined, { normalizeTitle }).then((r) => ({
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
  const parsed = writeQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten())
  }
  // Naming a library is a claim about where the write lands, so it is checked
  // rather than trusted: a member who trashes their own copy of a shared book's
  // version must not be able to name someone else's library and have it act
  // there. Omitting it means the caller's own library, which the read gate
  // already resolved.
  if (parsed.data.libraryId) await requireLibraryManager(user.id, parsed.data.libraryId)
  return c.json({ data: await deleteExternalBook(user.id, c.req.param('versionId')) })
})

export default extRoutes
