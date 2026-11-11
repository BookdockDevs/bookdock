import { Hono } from 'hono'

import { archiveBooksQuerySchema, readingImportScopeSchema, readingRangeSchema } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { deleteBookArchive, exportArchiveData, getArchiveCover, getBookDetail, getOverview, listBooks } from './archive.service'

const archiveRoutes = new Hono()

archiveRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return next()
})

archiveRoutes.get('/overview', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRangeSchema.safeParse(c.req.query())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await getOverview(user.id, parsed.data) })
})

archiveRoutes.get('/books', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = archiveBooksQuerySchema.safeParse(c.req.query())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await listBooks(user.id, parsed.data) })
})

archiveRoutes.get('/books/:bookVersionId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = readingRangeSchema.safeParse(c.req.query())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await getBookDetail(user.id, c.req.param('bookVersionId'), parsed.data) })
})

archiveRoutes.get('/books/:bookVersionId/cover', async (c) => {
  const user = c.get('user')!
  const cover = await getArchiveCover(user.id, c.req.param('bookVersionId'))
  return c.body(new Uint8Array(cover.data), 200, { 'Content-Type': cover.contentType, 'Cache-Control': 'private, no-store' })
})

archiveRoutes.delete('/books/:bookVersionId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const scope = readingImportScopeSchema.safeParse(c.req.query('scope') ?? 'all')
  if (!scope.success) throw new AppError('VALIDATION_ERROR', 'Invalid scope')
  return c.json({ data: await deleteBookArchive(user.id, c.req.param('bookVersionId'), scope.data) })
})

archiveRoutes.get('/data-export', async (c) => {
  const user = c.get('user')!
  const scope = readingImportScopeSchema.safeParse(c.req.query('scope') ?? 'all')
  if (!scope.success) throw new AppError('VALIDATION_ERROR', 'Invalid scope')
  const bookId = c.req.query('bookId') || undefined
  return c.json({ data: await exportArchiveData(user.id, scope.data, bookId) })
})

export default archiveRoutes
