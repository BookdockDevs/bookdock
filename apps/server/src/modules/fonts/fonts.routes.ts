import { Readable } from 'node:stream'

import { z } from 'zod'
import { Hono } from 'hono'

import type { FontListItem } from '@bookdock/shared'

import { config } from '../../config'
import { getStorage } from '../../storage'
import { AppError } from '../../middleware/error'
import {
  deleteFont,
  fontKey,
  getFontFile,
  listFonts,
  updateFontScope,
  uploadFont,
} from './fonts.service'

const scopeSchema = z.object({ scope: z.enum(['user', 'instance']) })

const FONT_CONTENT_TYPES: Record<FontListItem['format'], string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

const fontsRoutes = new Hono()

fontsRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'File is required' } }, 400)
  }
  if (file.size > config.fontsMaxBytes) {
    return c.json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'File too large' } }, 413)
  }
  const scopeParsed = scopeSchema.shape.scope.safeParse(body['scope'] ?? 'user')
  if (!scopeParsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid scope' } }, 400)
  }
  if (scopeParsed.data === 'instance' && user.role !== 'owner') {
    throw new AppError('FORBIDDEN', 'Owner only')
  }
  const item = await uploadFont(user.id, file, scopeParsed.data)
  return c.json({ data: item } satisfies { data: FontListItem }, 201)
})

fontsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const items = await listFonts(user.id)
  return c.json({ data: items } satisfies { data: FontListItem[] })
})

fontsRoutes.patch('/:id/scope', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const parsed = scopeSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const item = await updateFontScope(user.id, user.role, c.req.param('id'), parsed.data.scope)
  return c.json({ data: item } satisfies { data: FontListItem })
})

fontsRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  await deleteFont(user.id, user.role, c.req.param('id'))
  return c.json({ data: null })
})

fontsRoutes.get('/:id/file', async (c) => {
  const user = c.get('user')
  const row = await getFontFile(user.id, c.req.param('id'))
  const storage = getStorage()
  const key = fontKey(row.contentHash, row.format)
  if (!(await storage.exists(key))) {
    throw new AppError('FONT_NOT_FOUND', 'Font file missing')
  }
  const chunks: Buffer[] = []
  for await (const chunk of await storage.get(key) as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  // The blob is content-hash addressed; the payload never changes under the same URL.
  return c.newResponse(new Uint8Array(Buffer.concat(chunks)), 200, {
    'Content-Type': FONT_CONTENT_TYPES[row.format],
    'Content-Length': String(row.size),
    'Cache-Control': 'private, immutable, max-age=31536000',
  })
})

export default fontsRoutes
