import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirement as migrate } from '../../db/migration-stage'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import sharp from 'sharp'

import type { AccountRes } from '@bookdock/shared'

import { config } from '../../config'
import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { errorHandler } from '../../middleware/error'
import { createId } from '../../lib/id'
import { avatarFirstFrameKey, avatarThumbnailKey, avatarVariantKeys } from '../../lib/avatar'
import { sha256 } from '../../lib/hash'
import { avatarStorageKey } from './avatars.service'
import avatarsRoutes from './avatars.routes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

function createMemoryStorage() {
  const files = new Map<string, Buffer>()
  const driver: StorageDriver = {
    async put(key, data) {
      if (Buffer.isBuffer(data)) {
        files.set(key, data)
      } else {
        const chunks: Buffer[] = []
        for await (const chunk of data) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        files.set(key, Buffer.concat(chunks))
      }
    },
    async get(key, range) {
      const buf = files.get(key)
      if (!buf) throw new Error(`missing blob: ${key}`)
      return Readable.from(range ? buf.subarray(range.start, range.end + 1) : buf)
    },
    async delete(key) {
      files.delete(key)
    },
    async exists(key) {
      return files.has(key)
    },
    async size(key) {
      return files.get(key)?.length ?? 0
    },
  }
  return { driver, files }
}

interface TestUser {
  id: string
  username: string
  role: string
}

function seedUser(db: ReturnType<typeof createTestDb>, username: string, role: 'owner' | 'member' | 'guest'): TestUser {
  const id = createId('user')
  db.insert(schema.users).values({
    id,
    username,
    passwordHash: null,
    role,
    createdAt: Date.now(),
  }).run()
  return { id, username, role }
}

function avatarKeyOf(content: Buffer, ext: string): string {
  const hash = sha256(content)
  return `${hash.slice(0, 2)}/${hash}.${ext}`
}

async function makeGif(width = 32, height = 64, frames = 2) {
  return sharp(Array.from({ length: frames }, (_, index) => ({
    create: { width, height, channels: 4 as const, background: index % 2 ? 'blue' : 'red' },
  })), { join: { animated: true } }).gif({ delay: Array.from({ length: frames }, (_, index) => index % 2 ? 200 : 100), loop: 2, keepDuplicateFrames: true }).toBuffer()
}

describe('avatars routes', () => {
  let db: ReturnType<typeof createTestDb>
  let mem: ReturnType<typeof createMemoryStorage>
  let owner: TestUser

  function createApp(currentUser: TestUser, guest = false) {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('/api/v1/avatars/*', async (c, next) => {
      c.set('user', { id: currentUser.id, username: currentUser.username, role: currentUser.role, avatarKey: null })
      if (guest) c.set('guest', true)
      return next()
    })
    app.route('/api/v1/avatars', avatarsRoutes)
    return app
  }

  function uploadRequest(file: File) {
    const form = new FormData()
    form.append('file', file)
    return new Request('http://test/api/v1/avatars', { method: 'POST', body: form })
  }

  beforeEach(() => {
    db = createTestDb()
    mem = createMemoryStorage()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
    owner = seedUser(db, 'owner', 'owner')
  })

  it('uploads an avatar, stores the blob and sets users.avatarKey', async () => {
    const app = createApp(owner)
    const content = Buffer.from('fake png bytes')
    const res = await app.request(uploadRequest(new File([content], 'me.png', { type: 'image/png' })))
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as { data: AccountRes }
    expect(data.avatarKey).toBe(avatarKeyOf(content, 'png'))
    expect(mem.files.get(avatarStorageKey(data.avatarKey!))?.equals(content)).toBe(true)
    const row = db.select().from(schema.users).all().find((u) => u.id === owner.id)
    expect(row?.avatarKey).toBe(data.avatarKey)
  })

  it('rejects non-image types with 415', async () => {
    const app = createApp(owner)
    const res = await app.request(uploadRequest(new File([Buffer.alloc(8)], 'a.txt', { type: 'text/plain' })))
    expect(res.status).toBe(415)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNSUPPORTED_FORMAT')
  })

  it('rejects malformed GIF without storing files or updating the avatar', async () => {
    const app = createApp(owner)
    const res = await app.request(uploadRequest(new File([Buffer.alloc(8)], 'a.gif', { type: 'image/gif' })))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AVATAR_INVALID_IMAGE')
    expect(mem.files.size).toBe(0)
    expect(db.select().from(schema.users).get()?.avatarKey).toBeNull()
  })

  it('uploads GIF with animation and deterministic first frame while retaining the original', async () => {
    const app = createApp(owner)
    const content = await makeGif(600, 1200)
    const upload = await app.request(uploadRequest(new File([content], 'me.gif', { type: 'image/gif' })))
    expect(upload.status).toBe(201)
    const { data } = await upload.json() as { data: AccountRes }
    expect(data.avatarKey).toBe(avatarKeyOf(content, 'gif'))
    expect(avatarVariantKeys(data.avatarKey!).every((key) => mem.files.has(avatarStorageKey(key)))).toBe(true)

    const response = await app.request(`http://test/api/v1/avatars/${data.avatarKey}`)
    const animated = Buffer.from(await response.arrayBuffer())
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(response.headers.get('Cache-Control')).toBe('private, immutable, max-age=31536000')
    const metadata = await sharp(animated, { animated: true }).metadata()
    expect(metadata).toMatchObject({ width: 128, pageHeight: 256, pages: 2, delay: [100, 200], loop: 2 })
    const frame0 = await sharp(animated, { page: 0 }).raw().toBuffer()
    const frame1 = await sharp(animated, { page: 1 }).raw().toBuffer()
    expect(frame0[0]).toBeGreaterThan(240)
    expect(frame1[2]).toBeGreaterThan(240)

    for (let attempt = 0; attempt < 2; attempt++) {
      const still = await app.request(`http://test/api/v1/avatars/${data.avatarKey}?size=static`)
      const buffer = Buffer.from(await still.arrayBuffer())
      expect(buffer.equals(mem.files.get(avatarStorageKey(avatarFirstFrameKey(data.avatarKey!)))!)).toBe(true)
      expect((await sharp(buffer).metadata()).pages ?? 1).toBe(1)
      expect((await sharp(buffer).raw().toBuffer())[0]).toBeGreaterThan(240)
    }
    const original = await app.request(`http://test/api/v1/avatars/${data.avatarKey}?size=original`)
    expect(original.headers.get('Content-Type')).toBe('image/gif')
    expect(Buffer.from(await original.arrayBuffer()).equals(content)).toBe(true)
  })

  it('preserves GIF transparency and does not enlarge a small animation', async () => {
    const transparent = { create: { width: 16, height: 16, channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 0 } } }
    const content = await sharp([transparent, { create: { width: 16, height: 16, channels: 4, background: 'blue' } }], { join: { animated: true } }).gif().toBuffer()
    const app = createApp(owner)
    const res = await app.request(uploadRequest(new File([content], 'alpha.gif', { type: 'image/gif' })))
    expect(res.status).toBe(201)
    const { data } = await res.json() as { data: AccountRes }
    const thumb = mem.files.get(avatarStorageKey(avatarThumbnailKey(data.avatarKey!)))!
    expect(await sharp(thumb, { animated: true }).metadata()).toMatchObject({ width: 16, pageHeight: 16, pages: 2, hasAlpha: true })
    expect((await sharp(thumb, { page: 0 }).ensureAlpha().raw().toBuffer())[3]).toBe(0)
    expect((await sharp(thumb, { page: 1 }).ensureAlpha().raw().toBuffer())[3]).toBe(255)
  })

  it('rejects a PNG mislabeled as GIF', async () => {
    const content = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).png().toBuffer()
    const res = await createApp(owner).request(uploadRequest(new File([content], 'fake.gif', { type: 'image/gif' })))
    expect(res.status).toBe(400)
    expect(mem.files.size).toBe(0)
  })

  it('accepts GIF uploads above the former 2 MiB limit up to the configured boundary', async () => {
    const gif = await makeGif()
    const content = Buffer.concat([gif, Buffer.alloc(config.avatarMaxBytes - gif.length)])
    const res = await createApp(owner).request(uploadRequest(new File([content], 'limit.gif', { type: 'image/gif' })))
    expect(res.status).toBe(201)
    const { data } = await res.json() as { data: AccountRes }
    expect(mem.files.get(avatarStorageKey(data.avatarKey!))?.length).toBe(config.avatarMaxBytes)
  })

  it('isolates GIF variants from legacy uploads of the same bytes with a different MIME', async () => {
    const app = createApp(owner)
    const legacyApp = createApp(seedUser(db, 'legacy', 'member'))
    const gif = await makeGif()
    const { data } = await (await app.request(uploadRequest(new File([gif], 'me.gif', { type: 'image/gif' })))).json() as { data: AccountRes }
    const { data: legacy } = await (await legacyApp.request(uploadRequest(new File([gif], 'me.png', { type: 'image/png' })))).json() as { data: AccountRes }
    await legacyApp.request(`http://test/api/v1/avatars/${legacy.avatarKey}`)
    const thumbnail = mem.files.get(avatarStorageKey(avatarThumbnailKey(data.avatarKey!)))!
    expect((await sharp(thumbnail, { animated: true }).metadata()).pages).toBe(2)
    await legacyApp.request('http://test/api/v1/avatars', { method: 'DELETE' })
    expect(avatarVariantKeys(data.avatarKey!).every((key) => mem.files.has(avatarStorageKey(key)))).toBe(true)
  })

  it.each([[2049, 1, 2], [1, 2049, 2], [1, 1, 201]])('rejects GIF dimensions/frames beyond limits (%i×%i, %i frames)', async (width, height, frames) => {
    const content = await makeGif(width, height, frames)
    const res = await createApp(owner).request(uploadRequest(new File([content], 'large.gif', { type: 'image/gif' })))
    expect(res.status).toBe(413)
    expect((await res.json()).error.code).toBe('AVATAR_ANIMATION_TOO_LARGE')
    expect(mem.files.size).toBe(0)
  })

  it('accepts GIFs at the side and frame limits', async () => {
    for (const content of [await makeGif(2048, 1), await makeGif(1, 1, 200)]) {
      const res = await createApp(owner).request(uploadRequest(new File([content], 'limit.gif', { type: 'image/gif' })))
      expect(res.status).toBe(201)
    }
  })

  it('rejects excessive cumulative GIF pixels before decoding frames', async () => {
    const content = await makeGif(1, 1, 10)
    content.writeUInt16LE(2048, 6)
    content.writeUInt16LE(2048, 8)
    const res = await createApp(owner).request(uploadRequest(new File([content], 'pixels.gif', { type: 'image/gif' })))
    expect(res.status).toBe(413)
    expect((await res.json()).error.code).toBe('AVATAR_ANIMATION_TOO_LARGE')
    expect(mem.files.size).toBe(0)
  })

  it('rejects oversized thumbnail output while preserving the previous avatar', async () => {
    const app = createApp(owner)
    const old = Buffer.from('old png')
    await app.request(uploadRequest(new File([old], 'old.png', { type: 'image/png' })))
    const content = await makeGif()
    const encode = vi.spyOn(sharp.prototype, 'toBuffer').mockResolvedValueOnce(Buffer.alloc(2 * 1024 * 1024 + 1))
    const res = await app.request(uploadRequest(new File([content], 'large.gif', { type: 'image/gif' })))
    encode.mockRestore()
    expect(res.status).toBe(413)
    expect(db.select().from(schema.users).get()?.avatarKey).toBe(avatarKeyOf(old, 'png'))
    expect(mem.files.size).toBe(1)
  })

  it('rebuilds missing GIF variants with animation instead of falling back to the original', async () => {
    const app = createApp(owner)
    const content = await makeGif()
    const { data } = await (await app.request(uploadRequest(new File([content], 'me.gif', { type: 'image/gif' })))).json() as { data: AccountRes }
    mem.files.delete(avatarStorageKey(avatarThumbnailKey(data.avatarKey!)))
    mem.files.delete(avatarStorageKey(avatarFirstFrameKey(data.avatarKey!)))
    const still = await app.request(`http://test/api/v1/avatars/${data.avatarKey}?size=static`)
    expect(still.status).toBe(200)
    expect((await sharp(Buffer.from(await still.arrayBuffer())).metadata()).pages ?? 1).toBe(1)
    const cached = mem.files.get(avatarStorageKey(avatarThumbnailKey(data.avatarKey!)))!
    expect((await sharp(cached, { animated: true }).metadata()).pages).toBe(2)
  })

  it('keeps shared GIF variants until the last reference is replaced or removed', async () => {
    const app = createApp(owner)
    const memberApp = createApp(seedUser(db, 'member', 'member'))
    const content = await makeGif()
    const upload = () => uploadRequest(new File([content], 'shared.gif', { type: 'image/gif' }))
    const { data } = await (await app.request(upload())).json() as { data: AccountRes }
    await memberApp.request(upload())
    const keys = avatarVariantKeys(data.avatarKey!).map(avatarStorageKey)
    await app.request(uploadRequest(new File([Buffer.from('replacement')], 'me.png', { type: 'image/png' })))
    expect(keys.every((key) => mem.files.has(key))).toBe(true)
    await memberApp.request('http://test/api/v1/avatars', { method: 'DELETE' })
    expect(keys.every((key) => !mem.files.has(key))).toBe(true)
  })

  it('rejects files over the size limit with 413', async () => {
    const app = createApp(owner)
    const big = new File([new Uint8Array(config.avatarMaxBytes + 1)], 'big.png', { type: 'image/png' })
    const res = await app.request(uploadRequest(big))
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UPLOAD_TOO_LARGE')
  })

  it('rejects avatar upload for guest-injected sessions', async () => {
    const guest = seedUser(db, 'admin', 'guest')
    const app = createApp(guest, true)
    const res = await app.request(uploadRequest(new File([Buffer.alloc(8)], 'a.png', { type: 'image/png' })))
    expect(res.status).toBe(401)
  })

  it('replacing the avatar deletes the old blob when unreferenced', async () => {
    const app = createApp(owner)
    const first = Buffer.from('first avatar')
    const second = Buffer.from('second avatar')
    await app.request(uploadRequest(new File([first], 'one.png', { type: 'image/png' })))
    const res = await app.request(uploadRequest(new File([second], 'two.webp', { type: 'image/webp' })))
    const { data } = (await res.json()) as { data: AccountRes }
    expect(data.avatarKey).toBe(avatarKeyOf(second, 'webp'))
    expect(mem.files.has(avatarStorageKey(avatarKeyOf(first, 'png')))).toBe(false)
    expect(mem.files.has(avatarStorageKey(data.avatarKey!))).toBe(true)
  })

  it('keeps the old blob while another user references the same key', async () => {
    const app = createApp(owner)
    const member = seedUser(db, 'member', 'member')
    const memberApp = createApp(member)
    const content = Buffer.from('shared avatar')
    const file = () => new File([content], 'same.png', { type: 'image/png' })
    await app.request(uploadRequest(file()))
    await memberApp.request(uploadRequest(file()))

    // Member switches to a different avatar; the shared blob must survive
    await memberApp.request(uploadRequest(new File([Buffer.from('other')], 'other.png', { type: 'image/png' })))
    expect(mem.files.has(avatarStorageKey(avatarKeyOf(content, 'png')))).toBe(true)

    await app.request('http://test/api/v1/avatars', { method: 'DELETE' })
    expect(mem.files.has(avatarStorageKey(avatarKeyOf(content, 'png')))).toBe(false)
  })

  it('deletes the avatar and clears users.avatarKey', async () => {
    const app = createApp(owner)
    const content = Buffer.from('delete me')
    await app.request(uploadRequest(new File([content], 'del.png', { type: 'image/png' })))
    const res = await app.request('http://test/api/v1/avatars', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const row = db.select().from(schema.users).all().find((u) => u.id === owner.id)
    expect(row?.avatarKey).toBeNull()
    expect(mem.files.has(avatarStorageKey(avatarKeyOf(content, 'png')))).toBe(false)
  })

  it('serves the original bytes with immutable cache headers on request', async () => {
    const app = createApp(owner)
    const content = Buffer.from('served avatar')
    const upload = await app.request(uploadRequest(new File([content], 'serve.jpg', { type: 'image/jpeg' })))
    const { data } = (await upload.json()) as { data: AccountRes }

    const res = await app.request(`http://test/api/v1/avatars/${data.avatarKey}?size=original`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(res.headers.get('Cache-Control')).toBe('private, immutable, max-age=31536000')
    expect(Buffer.from(await res.arrayBuffer()).equals(content)).toBe(true)
  })

  it('generates a 256px webp thumbnail by default and caches it', async () => {
    const app = createApp(owner)
    const realJpg = await sharp({
      create: { width: 1200, height: 1200, channels: 3, background: { r: 20, g: 120, b: 200 } },
    }).jpeg().toBuffer()
    const upload = await app.request(uploadRequest(new File([realJpg], 'me.jpg', { type: 'image/jpeg' })))
    const { data } = (await upload.json()) as { data: AccountRes }
    const thumbKey = avatarStorageKey(avatarThumbnailKey(data.avatarKey!))

    // Nothing is materialized on upload; the first display request pays for it.
    expect(mem.files.has(thumbKey)).toBe(false)

    const res = await app.request(`http://test/api/v1/avatars/${data.avatarKey}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(res.headers.get('Cache-Control')).toBe('private, immutable, max-age=31536000')

    const metadata = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect(metadata.format).toBe('webp')
    expect(metadata.width).toBe(256)
    expect(metadata.height).toBe(256)
    expect(mem.files.has(thumbKey)).toBe(true)

    // The original is untouched beside it and still served on request.
    expect(mem.files.get(avatarStorageKey(data.avatarKey!))?.equals(realJpg)).toBe(true)
    const original = await app.request(`http://test/api/v1/avatars/${data.avatarKey}?size=original`)
    expect(original.headers.get('Content-Type')).toBe('image/jpeg')
    expect(Buffer.from(await original.arrayBuffer()).equals(realJpg)).toBe(true)
  })

  it('reuses a cached thumbnail instead of regenerating it', async () => {
    const app = createApp(owner)
    const realPng = await sharp({
      create: { width: 600, height: 400, channels: 4, background: { r: 200, g: 30, b: 90, alpha: 1 } },
    }).png().toBuffer()
    const upload = await app.request(uploadRequest(new File([realPng], 'me.png', { type: 'image/png' })))
    const { data } = (await upload.json()) as { data: AccountRes }
    const thumbKey = avatarStorageKey(avatarThumbnailKey(data.avatarKey!))

    await app.request(`http://test/api/v1/avatars/${data.avatarKey}`)
    expect(mem.files.get(thumbKey)!.length).toBeGreaterThan(0)
    // A sentinel sharp would never emit, so a match proves the read was a hit.
    mem.files.set(thumbKey, Buffer.from('cached thumb sentinel'))
    const res = await app.request(`http://test/api/v1/avatars/${data.avatarKey}`)
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('cached thumb sentinel')
  })

  it('falls back to the original bytes when the image cannot be decoded', async () => {
    const app = createApp(owner)
    const content = Buffer.from('not really a png')
    const upload = await app.request(uploadRequest(new File([content], 'bad.png', { type: 'image/png' })))
    const { data } = (await upload.json()) as { data: AccountRes }

    const res = await app.request(`http://test/api/v1/avatars/${data.avatarKey}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(Buffer.from(await res.arrayBuffer()).equals(content)).toBe(true)
    expect(mem.files.has(avatarStorageKey(avatarThumbnailKey(data.avatarKey!)))).toBe(false)
  })

  it('never enlarges a small avatar', async () => {
    const app = createApp(owner)
    const small = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 240, g: 240, b: 240 } },
    }).png().toBuffer()
    const upload = await app.request(uploadRequest(new File([small], 'tiny.png', { type: 'image/png' })))
    const { data } = (await upload.json()) as { data: AccountRes }

    const res = await app.request(`http://test/api/v1/avatars/${data.avatarKey}`)
    const metadata = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    expect(metadata.width).toBe(64)
  })

  it('deletes the derived thumbnail with the original once unreferenced', async () => {
    const app = createApp(owner)
    const member = seedUser(db, 'member', 'member')
    const memberApp = createApp(member)
    const realJpg = await sharp({
      create: { width: 800, height: 800, channels: 3, background: { r: 90, g: 90, b: 90 } },
    }).jpeg().toBuffer()
    const file = () => new File([realJpg], 'same.jpg', { type: 'image/jpeg' })
    const { data } = (await (await app.request(uploadRequest(file()))).json()) as { data: AccountRes }
    await memberApp.request(uploadRequest(file()))

    const thumbKey = avatarStorageKey(avatarThumbnailKey(data.avatarKey!))
    await app.request(`http://test/api/v1/avatars/${data.avatarKey}`)
    expect(mem.files.has(thumbKey)).toBe(true)

    // One user leaving keeps the shared blobs for the other.
    await app.request('http://test/api/v1/avatars', { method: 'DELETE' })
    expect(mem.files.has(avatarStorageKey(data.avatarKey!))).toBe(true)
    expect(mem.files.has(thumbKey)).toBe(true)

    // The last reference takes both.
    await memberApp.request('http://test/api/v1/avatars', { method: 'DELETE' })
    expect(mem.files.has(avatarStorageKey(data.avatarKey!))).toBe(false)
    expect(mem.files.has(thumbKey)).toBe(false)
  })

  it('404s on malformed keys and missing blobs', async () => {
    const app = createApp(owner)
    const malformed = await app.request('http://test/api/v1/avatars/xx/not-a-hash.png')
    expect(malformed.status).toBe(404)
    const body = (await malformed.json()) as { error: { code: string } }
    expect(body.error.code).toBe('AVATAR_NOT_FOUND')

    const hash = sha256(Buffer.from('never uploaded'))
    const missing = await app.request(`http://test/api/v1/avatars/${hash.slice(0, 2)}/${hash}.png`)
    expect(missing.status).toBe(404)
  })
})
