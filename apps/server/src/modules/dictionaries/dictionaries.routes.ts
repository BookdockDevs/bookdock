import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import JSZip from 'jszip'

import {
  DICTIONARY_MAX_UPLOAD_BYTES,
  dictionaryExportSchema,
  dictionaryLookupSchema,
  dictionaryOrderSchema,
  dictionaryUpdateSchema,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { assertResourceUploadAllowed } from '../auth/auth.service'
import {
  deleteDictionary,
  dictionaryResource,
  getDictionaryExportFiles,
  importDictionary,
  listDictionaries,
  lookupDictionary,
  reorderDictionaries,
  updateDictionary,
} from './dictionaries.service'

function attachmentHeader(fileName: string): string {
  const safeName = fileName.replace(/[\r\n"/\\]/g, '_')
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, '_') || 'download'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
}

function uniqueFolderName(rawName: string, used: Set<string>): string {
  const clean = rawName.replace(/[\r\n/\\:*?"<>|]/g, '_').trim() || 'dictionary'
  if (!used.has(clean)) {
    used.add(clean)
    return clean
  }
  let n = 2
  while (used.has(`${clean} (${n})`)) n += 1
  const candidate = `${clean} (${n})`
  used.add(candidate)
  return candidate
}

const routes = new Hono()

routes.use('*', async (c, next) => {
  if (!c.get('user') || c.get('guest')) throw new AppError('UNAUTHORIZED', 'Login required')
  await next()
})

routes.get('/', (c) => c.json({ data: listDictionaries(c.get('user')!.id) }))

// The upload gate runs before bodyLimit so a blocked member's files are
// rejected without being read.
routes.post('/', (c, next) => {
  assertResourceUploadAllowed(c.get('user')!.id)
  return next()
}, bodyLimit({ maxSize: DICTIONARY_MAX_UPLOAD_BYTES + 64 * 1024, onError: () => { throw new AppError('UPLOAD_TOO_LARGE') } }), async (c) => {
  const body = await c.req.parseBody({ all: true })
  const files = Array.isArray(body.files) ? body.files : [body.files]
  if (files.some((file) => !(file instanceof File))) throw new AppError('DICTIONARY_INVALID', 'Dictionary files are required')
  return c.json({ data: await importDictionary(c.get('user')!.id, files as File[]) }, 201)
})

routes.put('/order', async (c) => {
  const parsed = dictionaryOrderSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: reorderDictionaries(c.get('user')!.id, parsed.data.ids) })
})

routes.patch('/:id', async (c) => {
  const user = c.get('user')!
  const parsed = dictionaryUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: updateDictionary(user.id, user.role, c.req.param('id'), parsed.data) })
})

routes.delete('/:id', async (c) => {
  const user = c.get('user')!
  await deleteDictionary(user.id, user.role, c.req.param('id'))
  return c.json({ data: null })
})

routes.get('/:id/lookup', async (c) => {
  const parsed = dictionaryLookupSchema.safeParse({ word: c.req.query('word') })
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  c.header('Cache-Control', 'private, no-store')
  return c.json({ data: await lookupDictionary(c.get('user')!.id, c.req.param('id'), parsed.data.word) })
})

routes.get('/:id/export', (c) => {
  const { name, files } = getDictionaryExportFiles(c.get('user')!.id, c.req.param('id'))
  if (files.length === 1) {
    const file = files[0]!
    const stream = createReadStream(file.filePath)
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': attachmentHeader(file.fileName),
        'Cache-Control': 'private, no-store',
      },
    })
  }
  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.fileName, createReadStream(file.filePath))
  }
  const safeZipName = `${name.replace(/[\r\n/\\:*?"<>|]/g, '_').trim() || 'dictionary'}.zip`
  const nodeStream = zip.generateNodeStream({
    type: 'nodebuffer',
    streamFiles: true,
    compression: 'STORE',
  })
  return new Response(Readable.toWeb(nodeStream as unknown as Readable) as unknown as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachmentHeader(safeZipName),
      'Cache-Control': 'private, no-store',
    },
  })
})

routes.post('/export', async (c) => {
  const parsed = dictionaryExportSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  const ids = Array.from(new Set(parsed.data.ids))
  const userId = c.get('user')!.id
  const entries = ids.map((id) => getDictionaryExportFiles(userId, id))
  const zip = new JSZip()
  const usedFolders = new Set<string>()
  for (const entry of entries) {
    const folder = uniqueFolderName(entry.name, usedFolders)
    for (const file of entry.files) {
      zip.file(`${folder}/${file.fileName}`, createReadStream(file.filePath))
    }
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
      'Content-Disposition': attachmentHeader('bookdock-dictionaries.zip'),
      'Cache-Control': 'private, no-store',
    },
  })
})

routes.get('/:id/resource', async (c) => {
  const resource = await dictionaryResource(c.get('user')!.id, c.req.param('id'), c.req.query('key') ?? '')
  c.header('Content-Type', resource.type)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Content-Security-Policy', "sandbox; default-src 'none'")
  c.header('Cache-Control', 'private, no-store')
  return new Response(new Uint8Array(resource.bytes), { headers: c.res.headers })
})

export default routes
