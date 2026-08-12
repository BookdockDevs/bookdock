import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'

import type { AccountRes } from '@bookdock/shared'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { errorHandler } from '../../middleware/error'
import { createId } from '../../lib/id'
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

  it('rejects files over the size limit with 413', async () => {
    const app = createApp(owner)
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
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

  it('serves the blob by key with immutable cache headers', async () => {
    const app = createApp(owner)
    const content = Buffer.from('served avatar')
    const upload = await app.request(uploadRequest(new File([content], 'serve.jpg', { type: 'image/jpeg' })))
    const { data } = (await upload.json()) as { data: AccountRes }

    const res = await app.request(`http://test/api/v1/avatars/${data.avatarKey}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(res.headers.get('Cache-Control')).toBe('private, immutable, max-age=31536000')
    expect(Buffer.from(await res.arrayBuffer()).equals(content)).toBe(true)
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
