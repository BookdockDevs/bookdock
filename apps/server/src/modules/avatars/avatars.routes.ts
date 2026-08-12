import { Readable } from 'node:stream'

import { Hono } from 'hono'

import type { AccountRes } from '@bookdock/shared'

import { config } from '../../config'
import { getStorage } from '../../storage'
import { AppError } from '../../middleware/error'
import { avatarStorageKey, deleteAvatar, uploadAvatar } from './avatars.service'

const AVATAR_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

// Keys are `<hh>/<sha256>.<ext>` — validated before storage is touched
const AVATAR_KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{64}\.(jpg|png|webp|gif)$/

const avatarsRoutes = new Hono()

avatarsRoutes.post('/', async (c) => {
  const user = c.get('user')
  // The shared guest account is anonymous: no personal avatar
  if (!user || c.get('guest')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'File is required' } }, 400)
  }
  if (file.size > config.avatarMaxBytes) {
    return c.json({ error: { code: 'UPLOAD_TOO_LARGE', message: 'File too large' } }, 413)
  }
  const account = await uploadAvatar(user.id, file)
  return c.json({ data: account } satisfies { data: AccountRes }, 201)
})

avatarsRoutes.delete('/', async (c) => {
  const user = c.get('user')
  if (!user || c.get('guest')) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
  await deleteAvatar(user.id)
  return c.json({ data: null })
})

avatarsRoutes.get('/:key{.+}', async (c) => {
  const key = c.req.param('key')
  const match = AVATAR_KEY_PATTERN.exec(key)
  const storage = getStorage()
  const storageKey = avatarStorageKey(key)
  if (!match || !(await storage.exists(storageKey))) {
    throw new AppError('AVATAR_NOT_FOUND')
  }
  const chunks: Buffer[] = []
  for await (const chunk of (await storage.get(storageKey)) as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  // The blob is content-hash addressed; the payload never changes under the same URL.
  return c.newResponse(new Uint8Array(Buffer.concat(chunks)), 200, {
    'Content-Type': AVATAR_CONTENT_TYPES[match[1]],
    'Cache-Control': 'private, immutable, max-age=31536000',
  })
})

export default avatarsRoutes
