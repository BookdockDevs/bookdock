import { Readable } from 'node:stream'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { CONTENT_ATTACHMENT_MAX_BYTES, contentDraftIdSchema, contentFileIdSchema, contentFileUploadSchema } from '@bookdock/shared'

import { cancelContentDraft } from '../../lib/content-file-lifecycle'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { uploadContentFile } from './content-files.service'
import { assertContentUpload, readableContentFile } from './file-access'

const contentFileRoutes = new Hono()

contentFileRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Cookie, Authorization')
  c.header('X-Content-Type-Options', 'nosniff')
  await next()
})
contentFileRoutes.post('/', async (c, next) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const input = contentFileUploadSchema.safeParse(c.req.query())
  if (!input.success) throw new AppError('VALIDATION_ERROR')
  await assertContentUpload(user.id, input.data)
  await next()
}, bodyLimit({ maxSize: CONTENT_ATTACHMENT_MAX_BYTES + 64 * 1024, onError: () => { throw new AppError('UPLOAD_TOO_LARGE') } }), async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const input = contentFileUploadSchema.safeParse(c.req.query())
  if (!input.success) throw new AppError('VALIDATION_ERROR')
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File)) throw new AppError('VALIDATION_ERROR', 'A file is required')
  return c.json({ data: await uploadContentFile(user.id, input.data, file) }, 201)
})
contentFileRoutes.delete('/drafts/:draftId', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const draft = contentDraftIdSchema.safeParse(c.req.param('draftId'))
  if (!draft.success) throw new AppError('VALIDATION_ERROR')
  await cancelContentDraft(user.id, draft.data)
  return c.json({ data: null })
})
contentFileRoutes.get('/:id', async (c) => {
  const id = contentFileIdSchema.safeParse(c.req.param('id'))
  if (!id.success) throw new AppError('CONTENT_FILE_NOT_FOUND')
  const row = await readableContentFile(c.get('user')?.id ?? null, id.data)
  let stream: Readable
  try { stream = await getStorage().get(row.blobKey) }
  catch { throw new AppError('CONTENT_FILE_NOT_FOUND') }
  const name = encodeURIComponent(row.name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  c.header('Content-Type', row.mimeType)
  c.header('Content-Length', String(row.size))
  c.header('Content-Disposition', `${row.kind === 'attachment' ? 'attachment' : 'inline'}; filename="file"; filename*=UTF-8''${name}`)
  return c.newResponse(Readable.toWeb(stream) as ReadableStream)
})

export default contentFileRoutes
