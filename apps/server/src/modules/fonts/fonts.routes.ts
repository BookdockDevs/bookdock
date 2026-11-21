import { Readable } from 'node:stream'

import JSZip from 'jszip'
import { z } from 'zod'
import { Hono } from 'hono'

import { fontExportSchema, type FontListItem } from '@bookdock/shared'

import { config } from '../../config'
import { getStorage } from '../../storage'
import { assertResourceUploadAllowed } from '../auth/auth.service'
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

function attachmentHeader(fileName: string): string {
  const safeName = fileName.replace(/[\r\n"/\\]/g, '_')
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, '_') || 'download'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
}

function uniqueEntryName(rawName: string, used: Set<string>): string {
  const clean = rawName.replace(/[\r\n/\\]/g, '_') || 'font'
  if (!used.has(clean)) {
    used.add(clean)
    return clean
  }
  const dot = clean.lastIndexOf('.')
  const stem = dot > 0 ? clean.slice(0, dot) : clean
  const ext = dot > 0 ? clean.slice(dot) : ''
  let n = 2
  while (used.has(`${stem} (${n})${ext}`)) n += 1
  const candidate = `${stem} (${n})${ext}`
  used.add(candidate)
  return candidate
}

const fontsRoutes = new Hono()

fontsRoutes.post('/', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot upload fonts' } }, 403)
  }
  // Reject before parsing the multipart body so a blocked member's payload is
  // never read.
  assertResourceUploadAllowed(user.id)
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
  const items = await listFonts(user?.id ?? null)
  const visibleItems = !user ? items.filter((item) => item.scope === 'instance') : items
  // The payload is per-user (`mine`); never let an intermediary cache it.
  return c.json({ data: visibleItems } satisfies { data: FontListItem[] }, 200, {
    'Cache-Control': 'private, no-store',
  })
})

fontsRoutes.patch('/:id/scope', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage fonts' } }, 403)
  }
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
  if (!user) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot delete fonts' } }, 403)
  }
  await deleteFont(user.id, user.role, c.req.param('id'))
  return c.json({ data: null })
})

fontsRoutes.post('/export', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) {
    throw new AppError('FORBIDDEN', 'Login required to export fonts')
  }
  const parsed = fontExportSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid font export request', parsed.error.flatten())
  }
  const ids = Array.from(new Set(parsed.data.ids))
  const storage = getStorage()
  const rows = await Promise.all(ids.map((id) => getFontFile(user.id, id)))
  const zip = new JSZip()
  const usedNames = new Set<string>()
  for (const row of rows) {
    const key = fontKey(row.contentHash, row.format)
    if (!(await storage.exists(key))) {
      throw new AppError('FONT_NOT_FOUND', 'Font file missing')
    }
    const stream = await storage.get(key) as Readable
    const entryName = uniqueEntryName(row.fileName, usedNames)
    zip.file(entryName, stream)
  }
  const nodeStream = zip.generateNodeStream({
    type: 'nodebuffer',
    streamFiles: true,
    compression: 'STORE',
  })
  return new Response(Readable.toWeb(nodeStream as unknown as Readable) as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachmentHeader('bookdock-fonts.zip'),
      'Cache-Control': 'private, no-store',
    },
  })
})

fontsRoutes.get('/:id/file', async (c) => {
  const user = c.get('user')
  const download = c.req.query('download') === '1' || c.req.query('download') === 'true'
  if (download && (!user || c.get('guest'))) {
    throw new AppError('FORBIDDEN', 'Login required to export fonts')
  }
  const row = await getFontFile(user?.id ?? null, c.req.param('id'))
  if (!user && row.scope !== 'instance') {
    throw new AppError('FONT_NOT_FOUND')
  }
  const storage = getStorage()
  const key = fontKey(row.contentHash, row.format)
  if (!(await storage.exists(key))) {
    throw new AppError('FONT_NOT_FOUND', 'Font file missing')
  }
  const chunks: Buffer[] = []
  for await (const chunk of await storage.get(key) as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const headers: Record<string, string> = {
    'Content-Type': FONT_CONTENT_TYPES[row.format],
    'Content-Length': String(row.size),
    'Cache-Control': download ? 'private, no-store' : 'private, immutable, max-age=31536000',
  }
  if (download) {
    headers['Content-Disposition'] = attachmentHeader(row.fileName)
  }
  // The blob is content-hash addressed; the payload never changes under the same URL.
  return c.newResponse(new Uint8Array(Buffer.concat(chunks)), 200, headers)
})

export default fontsRoutes
