import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { migrateBeforeBookRetirementIncluding as migrate } from '../../db/migration-stage'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'

import type { FontListItem } from '@bookdock/shared'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { errorHandler } from '../../middleware/error'
import { resetInstanceCache } from '../auth/auth.service'
import { createId } from '../../lib/id'
import { sha256 } from '../../lib/hash'
import { fontKey } from './fonts.service'
import fontsRoutes from './fonts.routes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  // The resource-upload gate reads instance settings, so the fixture needs
  // the current `instance` shape (0042/0043 storage backend, 0061 registration
  // mode); 0064 rides along through the shared include set.
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') }, ['0042_storage_connections', '0043_storage_backend'])
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

function seedUser(db: ReturnType<typeof createTestDb>, username: string, role: 'owner' | 'member'): TestUser {
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

interface SfntNameRecord { platform: number; language: number; nameId: number; value: string }

function buildSfntTable(records: SfntNameRecord[]): Buffer {
  const recs: Buffer[] = []
  const strings: Buffer[] = []
  let relativeOffset = 0
  for (const record of records) {
    const str = Buffer.from(record.value, 'utf16le').swap16()
    const rec = Buffer.alloc(12)
    rec.writeUInt16BE(record.platform, 0)
    rec.writeUInt16BE(1, 2)
    rec.writeUInt16BE(record.language, 4)
    rec.writeUInt16BE(record.nameId, 6)
    rec.writeUInt16BE(str.length, 8)
    rec.writeUInt16BE(relativeOffset, 10)
    relativeOffset += str.length
    recs.push(rec)
    strings.push(str)
  }
  const header6 = Buffer.alloc(6)
  header6.writeUInt16BE(records.length, 2)
  header6.writeUInt16BE(6 + records.length * 12, 4)
  return Buffer.concat([header6, ...recs, ...strings])
}

function buildSfnt(family: string): Buffer {
  return buildSfntFromNameTable(buildSfntTable([
    { platform: 3, language: 0x409, nameId: 16, value: family },
  ]))
}

function buildSfntFromNameTable(nameTable: Buffer): Buffer {
  const header = Buffer.alloc(12)
  header.writeUInt32BE(0x00010000, 0)
  header.writeUInt16BE(1, 4)
  const tableRec = Buffer.alloc(16)
  tableRec.write('name', 0, 'ascii')
  tableRec.writeUInt32BE(28, 8)
  tableRec.writeUInt32BE(nameTable.length, 12)
  return Buffer.concat([header, tableRec, nameTable])
}

describe('fonts routes', () => {
  let db: ReturnType<typeof createTestDb>
  let mem: ReturnType<typeof createMemoryStorage>
  let owner: TestUser
  let member: TestUser

  function createApp(currentUser: TestUser) {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('/api/v1/fonts/*', async (c, next) => {
      c.set('user', { id: currentUser.id, username: currentUser.username, role: currentUser.role, avatarKey: null })
      return next()
    })
    app.route('/api/v1/fonts', fontsRoutes)
    return app
  }

  function uploadRequest(file: File, scope?: string) {
    const form = new FormData()
    form.append('file', file)
    if (scope) form.append('scope', scope)
    return new Request('http://test/api/v1/fonts', { method: 'POST', body: form })
  }

  beforeEach(() => {
    db = createTestDb()
    mem = createMemoryStorage()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
    owner = seedUser(db, 'owner', 'owner')
    member = seedUser(db, 'member', 'member')
    resetInstanceCache()
  })

  function seedInstanceRow(opts: { allowUserResourceUpload?: boolean } = {}) {
    db.insert(schema.instance).values({
      id: 'instance',
      ownerUserId: owner.id,
      allowRegistration: false,
      allowGuestAccess: false,
      uploadMaxBytes: null,
      allowUserResourceUpload: opts.allowUserResourceUpload ?? true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()
    resetInstanceCache()
  }

  it('uploads a font and falls back to the file name when parsing fails', async () => {
    const app = createApp(owner)
    const content = Buffer.alloc(64) // all-zero buffer: name parsing returns null
    const res = await app.request(uploadRequest(new File([content], 'My Cool Font.ttf')))
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as { data: FontListItem }
    expect(data.family).toBe('My Cool Font')
    expect(data.fileName).toBe('My Cool Font.ttf')
    expect(data.format).toBe('ttf')
    expect(data.scope).toBe('user')
    expect(data.mine).toBe(true)
    expect(data.size).toBe(content.length)
    expect(mem.files.get(fontKey(sha256(content), 'ttf'))?.equals(content)).toBe(true)
  })

  it('uses the parsed sfnt family name when the name table is present', async () => {
    const app = createApp(owner)
    const res = await app.request(uploadRequest(new File([buildSfnt('Parsed Serif')], 'whatever.otf')))
    expect(res.status).toBe(201)
    const { data } = (await res.json()) as { data: FontListItem }
    expect(data.family).toBe('Parsed Serif')
    expect(data.format).toBe('otf')
  })

  it('rejects unsupported extensions with 415', async () => {
    const app = createApp(owner)
    const res = await app.request(uploadRequest(new File([Buffer.alloc(8)], 'font.txt')))
    expect(res.status).toBe(415)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UNSUPPORTED_FORMAT')
  })

  it('rejects files over the size limit with 413', async () => {
    const app = createApp(owner)
    const big = new File([new Uint8Array(100 * 1024 * 1024 + 1)], 'big.ttf')
    const res = await app.request(uploadRequest(big))
    expect(res.status).toBe(413)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('UPLOAD_TOO_LARGE')
  })

  it('extracts localized display names for later uploads', async () => {
    const app = createApp(owner)
    const nameTable = buildSfntTable([
      { platform: 3, language: 0x409, nameId: 16, value: 'Source Han Sans' },
      { platform: 3, language: 0x804, nameId: 4, value: '思源黑体' },
      { platform: 3, language: 0x804, nameId: 1, value: '思源黑体族' },
    ])
    const res = await app.request(uploadRequest(new File([buildSfntFromNameTable(nameTable)], 'shs.ttf')))
    expect(res.status).toBe(201)
    const data = (await res.json() as { data: FontListItem }).data
    expect(data.family).toBe('Source Han Sans')
    expect(data.localNames).toEqual({ '409': 'Source Han Sans', '804': '思源黑体' })
  })

  it('inflates woff1 name tables and skips woff2', async () => {
    const { deflateSync } = await import('node:zlib')
    // A long value makes deflate actually shrink the table (a tiny table can
    // grow, which real WOFF encoders store uncompressed); names are trimmed,
    // so the filler sits in the middle
    const compressedValue = 'Compressed ' + 'F'.repeat(400) + 'ace'
    const nameTable = buildSfntTable([
      { platform: 3, language: 0x409, nameId: 16, value: compressedValue },
    ])
    const compressed = deflateSync(nameTable)
    // WOFF1 header (44 bytes) + one 20-byte table directory entry + data
    const offset = 64
    const container = Buffer.alloc(offset + compressed.length)
    container.write('wOFF', 0, 'ascii')
    container.writeUInt16BE(1, 12)
    container.write('name', 44, 'ascii')
    container.writeUInt32BE(offset, 48)
    container.writeUInt32BE(compressed.length, 52)
    container.writeUInt32BE(nameTable.length, 56)
    compressed.copy(container, offset)

    const app = createApp(owner)
    const woff = new File([container], 'face.woff')
    const res = await app.request(uploadRequest(woff))
    expect(res.status).toBe(201)
    const data = (await res.json() as { data: FontListItem }).data
    expect(data.family).toBe(compressedValue)
    expect(data.localNames).toEqual({ '409': compressedValue })

    // woff2 is not parsed: family falls back to the file base name
    const woff2 = Buffer.alloc(12)
    woff2.write('wOF2', 0, 'ascii')
    const res2 = await app.request(uploadRequest(new File([woff2], 'face2.woff2')))
    expect(res2.status).toBe(201)
    const data2 = (await res2.json() as { data: FontListItem }).data
    expect(data2.family).toBe('face2')
    expect(data2.localNames).toBeNull()
  })

  it('rejects woff name tables that claim or produce oversized output', async () => {
    const { parseFontNames } = await import('../../lib/font-name')
    const { deflateSync } = await import('node:zlib')

    const nameTable = buildSfntTable([{ platform: 3, language: 0x409, nameId: 16, value: 'Tiny' }])
    const compressed = deflateSync(nameTable)
    // A table declaring a huge original length never inflates
    const declaring = Buffer.alloc(64 + compressed.length)
    declaring.write('wOFF', 0, 'ascii')
    declaring.writeUInt16BE(1, 12)
    declaring.write('name', 44, 'ascii')
    declaring.writeUInt32BE(64, 48)
    declaring.writeUInt32BE(compressed.length, 52)
    declaring.writeUInt32BE(2 * 1024 * 1024, 56)
    compressed.copy(declaring, 64)
    expect(parseFontNames(declaring)).toEqual({ family: null, localNames: null })

    // A compression bomb is rejected by the inflate output cap itself, not
    // the declared-length pre-check: the header declares a plausible 900 KB
    // (< the 1 MB cap) while the actual table inflates to 2 MB. The table
    // carries a real name record, so a missing output cap would make this
    // test fail with a parsed family instead of rejecting.
    const bombTable = Buffer.alloc(2 * 1024 * 1024)
    buildSfntTable([{ platform: 3, language: 0x409, nameId: 16, value: 'Bombed' + 'x'.repeat(32000) }]).copy(bombTable, 0)
    const bombCompressed = deflateSync(bombTable)
    const bomb = Buffer.alloc(64 + bombCompressed.length)
    bomb.write('wOFF', 0, 'ascii')
    bomb.writeUInt16BE(1, 12)
    bomb.write('name', 44, 'ascii')
    bomb.writeUInt32BE(64, 48)
    bomb.writeUInt32BE(bombCompressed.length, 52)
    bomb.writeUInt32BE(900 * 1024, 56)
    bombCompressed.copy(bomb, 64)
    expect(parseFontNames(bomb)).toEqual({ family: null, localNames: null })
  })

  it('returns the existing row when the same user re-uploads the same content', async () => {
    const app = createApp(owner)
    const content = Buffer.from('same font bytes')
    const first = await app.request(uploadRequest(new File([content], 'a.ttf')))
    const second = await app.request(uploadRequest(new File([content], 'renamed.ttf')))
    const a = ((await first.json()) as { data: FontListItem }).data
    const b = ((await second.json()) as { data: FontListItem }).data
    expect(b.id).toBe(a.id)
    expect(b.fileName).toBe('a.ttf')
    expect(db.select().from(schema.fonts).all()).toHaveLength(1)
  })

  it('lets only the owner upload with instance scope', async () => {
    const memberApp = createApp(member)
    const denied = await memberApp.request(uploadRequest(new File([Buffer.alloc(8)], 'shared.ttf'), 'instance'))
    expect(denied.status).toBe(403)

    const ownerApp = createApp(owner)
    const allowed = await ownerApp.request(uploadRequest(new File([Buffer.alloc(8)], 'shared.ttf'), 'instance'))
    expect(allowed.status).toBe(201)
    const { data } = (await allowed.json()) as { data: FontListItem }
    expect(data.scope).toBe('instance')
  })

  it('gates member uploads behind allowUserResourceUpload while the owner stays exempt', async () => {
    seedInstanceRow({ allowUserResourceUpload: false })
    const memberApp = createApp(member)
    const denied = await memberApp.request(uploadRequest(new File([Buffer.from('blocked font')], 'blocked.ttf')))
    expect(denied.status).toBe(403)
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')

    const ownerApp = createApp(owner)
    const ownerAllowed = await ownerApp.request(uploadRequest(new File([Buffer.from('owner font')], 'owner.ttf')))
    expect(ownerAllowed.status).toBe(201)
  })

  it('keeps managing an already uploaded font available after the switch turns off', async () => {
    const memberApp = createApp(member)
    const upload = await memberApp.request(uploadRequest(new File([Buffer.from('earlier font')], 'earlier.ttf')))
    expect(upload.status).toBe(201)
    const { data: font } = (await upload.json()) as { data: FontListItem }

    seedInstanceRow({ allowUserResourceUpload: false })
    const toggle = await memberApp.request(`http://test/api/v1/fonts/${font.id}/scope`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'user' }),
    })
    expect(toggle.status).toBe(403) // scope changes stay owner-only, unrelated to the switch

    const del = await memberApp.request(`http://test/api/v1/fonts/${font.id}`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(db.select().from(schema.fonts).where(eq(schema.fonts.id, font.id)).all()).toHaveLength(0)
  })

  it('lists own fonts plus instance fonts, hiding other users’ private fonts', async () => {
    const ownerApp = createApp(owner)
    const memberApp = createApp(member)
    await ownerApp.request(uploadRequest(new File([Buffer.from('owner private')], 'private.ttf')))
    await ownerApp.request(uploadRequest(new File([Buffer.from('owner shared')], 'shared.ttf'), 'instance'))
    await memberApp.request(uploadRequest(new File([Buffer.from('member private')], 'member.ttf')))

    const memberList = (await (await memberApp.request('http://test/api/v1/fonts')).json()) as { data: FontListItem[] }
    expect(memberList.data.map((f) => f.fileName).sort()).toEqual(['member.ttf', 'shared.ttf'])
    expect(memberList.data.find((f) => f.fileName === 'member.ttf')?.mine).toBe(true)
    expect(memberList.data.find((f) => f.fileName === 'shared.ttf')?.mine).toBe(false)

    const ownerList = (await (await ownerApp.request('http://test/api/v1/fonts')).json()) as { data: FontListItem[] }
    expect(ownerList.data.map((f) => f.fileName).sort()).toEqual(['private.ttf', 'shared.ttf'])
    expect(ownerList.data.every((f) => f.mine)).toBe(true)
  })

  it('lets only the owner switch scope, and 404s on missing rows', async () => {
    const ownerApp = createApp(owner)
    const memberApp = createApp(member)
    const upload = await memberApp.request(uploadRequest(new File([Buffer.from('scoped')], 'scoped.ttf')))
    const { data: font } = (await upload.json()) as { data: FontListItem }

    const denied = await memberApp.request(`http://test/api/v1/fonts/${font.id}/scope`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'instance' }),
    })
    expect(denied.status).toBe(403)

    const allowed = await ownerApp.request(`http://test/api/v1/fonts/${font.id}/scope`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'instance' }),
    })
    expect(allowed.status).toBe(200)
    expect(((await allowed.json()) as { data: FontListItem }).data.scope).toBe('instance')

    const missing = await ownerApp.request('http://test/api/v1/fonts/font_nonexistent/scope', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'instance' }),
    })
    expect(missing.status).toBe(404)
  })

  it('lets only the uploader or an owner delete', async () => {
    const ownerApp = createApp(owner)
    const memberApp = createApp(member)
    const other = seedUser(db, 'other', 'member')
    const otherApp = createApp(other)

    const upload = await memberApp.request(uploadRequest(new File([Buffer.from('delete me')], 'del.ttf')))
    const { data: font } = (await upload.json()) as { data: FontListItem }

    const denied = await otherApp.request(`http://test/api/v1/fonts/${font.id}`, { method: 'DELETE' })
    expect(denied.status).toBe(403)

    const missing = await ownerApp.request('http://test/api/v1/fonts/font_nonexistent', { method: 'DELETE' })
    expect(missing.status).toBe(404)

    const ownerDelete = await ownerApp.request(`http://test/api/v1/fonts/${font.id}`, { method: 'DELETE' })
    expect(ownerDelete.status).toBe(200)
    expect(db.select().from(schema.fonts).all()).toHaveLength(0)
  })

  it('keeps the blob while other rows reference the same content hash', async () => {
    const ownerApp = createApp(owner)
    const memberApp = createApp(member)
    const content = Buffer.from('shared font content')
    const first = (await (await ownerApp.request(uploadRequest(new File([content], 'one.ttf')))).json()) as { data: FontListItem }
    const second = (await (await memberApp.request(uploadRequest(new File([content], 'two.ttf')))).json()) as { data: FontListItem }
    expect(second.data.id).not.toBe(first.data.id)

    const key = fontKey(sha256(content), 'ttf')
    await ownerApp.request(`http://test/api/v1/fonts/${first.data.id}`, { method: 'DELETE' })
    expect(mem.files.has(key)).toBe(true)

    await memberApp.request(`http://test/api/v1/fonts/${second.data.id}`, { method: 'DELETE' })
    expect(mem.files.has(key)).toBe(false)
  })

  it('serves the font file with cache headers only to users who can see it', async () => {
    const ownerApp = createApp(owner)
    const memberApp = createApp(member)
    const content = Buffer.from('file route content')
    const upload = await ownerApp.request(uploadRequest(new File([content], 'serve.woff2')))
    const { data: font } = (await upload.json()) as { data: FontListItem }

    const invisible = await memberApp.request(`http://test/api/v1/fonts/${font.id}/file`)
    expect(invisible.status).toBe(404)

    const visible = await ownerApp.request(`http://test/api/v1/fonts/${font.id}/file`)
    expect(visible.status).toBe(200)
    expect(visible.headers.get('Content-Type')).toBe('font/woff2')
    expect(visible.headers.get('Cache-Control')).toBe('private, immutable, max-age=31536000')
    expect(Buffer.from(await visible.arrayBuffer()).equals(content)).toBe(true)

    await ownerApp.request(`http://test/api/v1/fonts/${font.id}/scope`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'instance' }),
    })
    const sharedVisible = await memberApp.request(`http://test/api/v1/fonts/${font.id}/file`)
    expect(sharedVisible.status).toBe(200)
  })
})
