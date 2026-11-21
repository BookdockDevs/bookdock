import { Readable } from 'node:stream'

import { Hono } from 'hono'

import {
  instanceThemeItemKindSchema,
  instanceThemePublishSchema,
  type InstanceThemeLibraryRes,
  type ThemeAssetRes,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import {
  deleteThemeAsset,
  getInstanceThemeLibrary,
  getThemeAssetFile,
  publishInstanceThemeItems,
  removeInstanceThemeItem,
  uploadThemeAsset,
} from './reading-themes.service'

const readingThemeRoutes = new Hono()

readingThemeRoutes.get('/instance', (c) => {
  return c.json({ data: getInstanceThemeLibrary() } satisfies { data: InstanceThemeLibraryRes }, 200, {
    'Cache-Control': 'private, no-store',
  })
})

readingThemeRoutes.post('/instance', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) {
    throw new AppError('FORBIDDEN', 'Owner only')
  }
  const parsed = instanceThemePublishSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid instance theme payload', parsed.error.flatten())
  }
  const library = publishInstanceThemeItems(user.id, user.role, parsed.data)
  return c.json({ data: library } satisfies { data: InstanceThemeLibraryRes })
})

readingThemeRoutes.delete('/instance/:kind/:itemId', (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) {
    throw new AppError('FORBIDDEN', 'Owner only')
  }
  const kindParsed = instanceThemeItemKindSchema.safeParse(c.req.param('kind'))
  if (!kindParsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid theme item kind')
  }
  const library = removeInstanceThemeItem(user.role, kindParsed.data, c.req.param('itemId'))
  return c.json({ data: library } satisfies { data: InstanceThemeLibraryRes })
})

readingThemeRoutes.post('/assets', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) {
    throw new AppError('FORBIDDEN', 'Login required to upload theme assets')
  }
  const body = await c.req.parseBody()
  const file = body['file']
  const assetId = typeof body['assetId'] === 'string' ? body['assetId'].trim() : ''
  if (!file || !(file instanceof File) || !assetId) {
    throw new AppError('VALIDATION_ERROR', 'Asset file and assetId are required')
  }
  const width = typeof body['width'] === 'string' ? Number.parseInt(body['width'], 10) : undefined
  const height = typeof body['height'] === 'string' ? Number.parseInt(body['height'], 10) : undefined
  const res = await uploadThemeAsset(user.id, {
    assetId,
    file,
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
  })
  return c.json({ data: res } satisfies { data: ThemeAssetRes }, 201)
})

readingThemeRoutes.get('/assets/:assetId', async (c) => {
  const user = c.get('user')
  const { row, key } = getThemeAssetFile(user?.id ?? null, c.req.param('assetId'))
  const storage = getStorage()
  if (!(await storage.exists(key))) {
    throw new AppError('THEME_ASSET_NOT_FOUND', 'Theme asset file missing')
  }
  const chunks: Buffer[] = []
  for await (const chunk of await storage.get(key) as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return c.newResponse(new Uint8Array(Buffer.concat(chunks)), 200, {
    'Content-Type': row.mime,
    'Content-Length': String(row.size),
    'Cache-Control': 'private, max-age=31536000',
  })
})

readingThemeRoutes.delete('/assets/:assetId', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) {
    throw new AppError('FORBIDDEN', 'Login required')
  }
  await deleteThemeAsset(user.id, c.req.param('assetId'))
  return c.json({ data: null })
})

export default readingThemeRoutes
