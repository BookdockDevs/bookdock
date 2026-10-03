import { Readable } from 'node:stream'

import { Hono } from 'hono'

import type { AccountRes } from '@bookdock/shared'

import { config } from '../../config'
import { getStorage } from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { AppError } from '../../middleware/error'
import { avatarFirstFrameKey, avatarThumbnailKey } from '../../lib/avatar'
import { avatarStorageKey, deleteAvatar, generateAvatarThumbnail, generateGifAvatarThumbnails, uploadAvatar } from './avatars.service'

const AVATAR_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

// Keys are `<hh>/<sha256>.<ext>` — validated before storage is touched.
const AVATAR_KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{64}\.(jpg|png|webp|gif)$/

async function readAll(storage: StorageDriver, storageKey: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of (await storage.get(storageKey)) as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

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

  // No surface renders an avatar larger than 96 CSS px, so the thumbnail is
  // the default and the original stays opt-in for the untouched bytes.
  let payload: Buffer
  let contentType: string
  if (c.req.query('size') === 'original') {
    payload = await readAll(storage, storageKey)
    contentType = AVATAR_CONTENT_TYPES[match[1]]
  } else {
    const isGif = match[1] === 'gif'
    const isStatic = c.req.query('size') === 'static'
    const thumbKey = avatarStorageKey(isGif && isStatic ? avatarFirstFrameKey(key) : avatarThumbnailKey(key))
    if (await storage.exists(thumbKey)) {
      payload = await readAll(storage, thumbKey)
      contentType = 'image/webp'
    } else {
      const original = await readAll(storage, storageKey)
      let thumb: Buffer | null
      if (isGif) {
        const gif = await generateGifAvatarThumbnails(original)
        for (const [variantKey, data] of [
          [avatarThumbnailKey(key), gif.thumbnail],
          [avatarFirstFrameKey(key), gif.firstFrame],
        ] as const) {
          const variantStorageKey = avatarStorageKey(variantKey)
          if (!(await storage.exists(variantStorageKey))) await storage.put(variantStorageKey, data)
        }
        thumb = isStatic ? gif.firstFrame : gif.thumbnail
      } else {
        thumb = await generateAvatarThumbnail(original)
      }
      if (thumb) {
        if (!isGif) await storage.put(thumbKey, thumb)
        payload = thumb
        contentType = 'image/webp'
      } else {
        // Bytes sharp cannot decode still render as themselves; serving them
        // beats failing the request.
        payload = original
        contentType = AVATAR_CONTENT_TYPES[match[1]]
      }
    }
  }

  // The blob and its thumbnail are both content-hash addressed, so the payload
  // under a given URL never changes.
  return c.newResponse(new Uint8Array(payload), 200, {
    'Content-Type': contentType,
    'Cache-Control': 'private, immutable, max-age=31536000',
  })
})

export default avatarsRoutes
