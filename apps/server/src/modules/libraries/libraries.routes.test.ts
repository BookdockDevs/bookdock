import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirement as migrate } from '../../db/migration-stage'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import { createId } from '../../lib/id'
import { errorHandler } from '../../middleware/error'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { uploadBook, uploadCatalogBook } from '../books/books.service'
import librariesRoutes from './libraries.routes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

function createApp(user: { id: string } | null) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/libraries/*', async (c, next) => {
    if (user) c.set('user', { ...user, username: 'u', role: 'member', avatarKey: null })
    return next()
  })
  app.route('/api/v1/libraries', librariesRoutes)
  return app
}

describe('libraries routes', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let memberId: string
  let libraryId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const now = Date.now()
    ownerId = createId('user')
    memberId = createId('user')
    for (const [id, username] of [[ownerId, 'owner'], [memberId, 'member']] as const) {
      db.insert(schema.users).values({ id, username, passwordHash: null, role: 'member', createdAt: now }).run()
    }
    libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'private', createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId, userId: memberId, role: 'member', createdAt: now, updatedAt: now,
    }).run()
  })

  it('validates category scopes and saves rename and reparent atomically', async () => {
    const app = createApp({ id: ownerId })
    const create = async (name: string, parentId?: string) => {
      const response = await app.request(`/api/v1/libraries/${libraryId}/categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId }),
      })
      expect(response.status).toBe(201)
      return (await response.json()).data
    }
    const root = await create('Root')
    const child = await create('Child', root.id)
    const response = await app.request(`/api/v1/libraries/${libraryId}/categories/${root.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Changed', parentId: child.id }),
    })
    expect(response.status).toBe(400)
    const categories = await (await app.request(`/api/v1/libraries/${libraryId}/categories`)).json()
    expect(categories.data.find((row: { id: string }) => row.id === root.id)).toMatchObject({ name: 'Root', parentId: null, subtreeBookCount: 0 })
    expect((await app.request(`/api/v1/libraries/${libraryId}/books?categoryScope=invalid`)).status).toBe(400)
    expect((await app.request(`/api/v1/libraries/${libraryId}/books?categoryId=${root.id}&categoryScope=subtree`)).status).toBe(200)
    const denied = await createApp({ id: memberId }).request(`/api/v1/libraries/${libraryId}/categories/${child.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parentId: null }),
    })
    expect(denied.status).toBe(403)
  })

  it('transfers ownership for the owner and rejects members', async () => {
    const app = createApp({ id: memberId })
    const denied = await app.request(`/api/v1/libraries/${libraryId}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: memberId }),
    })
    expect(denied.status).toBe(403)
    const ownerApp = createApp({ id: ownerId })
    const res = await ownerApp.request(`/api/v1/libraries/${libraryId}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: memberId }),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ ownerUserId: memberId })
  })

  it('validates join and relation inputs', async () => {
    const app = createApp({ id: memberId })
    const bad = await app.request(`/api/v1/libraries/${libraryId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessPassword: 42 }),
    })
    expect(bad.status).toBe(400)
    const rel = await app.request(`/api/v1/libraries/${libraryId}/relation`)
    expect(rel.status).toBe(200)
    expect((await rel.json()).data).toMatchObject({ relation: 'member' })
    const anon = createApp(null)
    const guestRel = await anon.request(`/api/v1/libraries/${libraryId}/relation`)
    expect(guestRel.status).toBe(200)
    expect((await guestRel.json()).data).toMatchObject({ relation: 'guest' })
  })

  describe('catalog routes', () => {
    function uploadBody(content: string, extra: Record<string, string> = {}) {
      const form = new FormData()
      form.set('file', new File([content], 'novel.txt', { type: 'text/plain' }))
      for (const [key, value] of Object.entries(extra)) form.set(key, value)
      return form
    }

    beforeEach(() => {
      vi.spyOn(storage, 'getStorage').mockReturnValue({
        put: vi.fn(async () => {}), get: vi.fn(), delete: vi.fn(async () => {}),
        exists: vi.fn(async () => true), size: vi.fn(async () => 0),
      } as unknown as ReturnType<typeof storage.getStorage>)
      registerParser(new TxtParser())
    })

    it('lets the owner upload into the catalog and refuses a plain member', async () => {
      const ownerApp = createApp({ id: ownerId })
      const res = await ownerApp.request(`/api/v1/libraries/${libraryId}/books`, {
        method: 'POST', body: uploadBody('第一章\n正文'),
      })
      expect(res.status).toBe(201)
      const body = await res.json() as { data: { id: string; versions: { id: string }[] }; duplicated: boolean; versionLinkId?: string }
      expect(body.duplicated).toBe(false)
      expect(body.data.versions).toHaveLength(1)
      // The new link id lets uploaders select the version they just added.
      expect(body.versionLinkId).toBe(body.data.versions[0]!.id)

      const memberApp = createApp({ id: memberId })
      const denied = await memberApp.request(`/api/v1/libraries/${libraryId}/books`, {
        method: 'POST', body: uploadBody('第一章\n别的'),
      })
      expect(denied.status).toBe(403)
      const missingFile = await ownerApp.request(`/api/v1/libraries/${libraryId}/books`, {
        method: 'POST', body: new FormData(),
      })
      expect(missingFile.status).toBe(400)
    })

    it('publishes a private A through the dedicated snapshot route', async () => {
      const source = await uploadBook(ownerId, new File(['第一章\n私库内容'], 'private.txt', { type: 'text/plain' }))
      const ownerApp = createApp({ id: ownerId })
      const published = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/from-private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: source.book.id }),
      })
      expect(published.status).toBe(201)
      const body = await published.json() as { data: { libraryBookId: string; versionLinkId: string; bookVersionId: string; duplicated: boolean } }
      expect(body.data).toMatchObject({ duplicated: false })

      const repeated = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/from-private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: source.book.id }),
      })
      expect(repeated.status).toBe(200)
      expect((await repeated.json()).data).toMatchObject({
        libraryBookId: body.data.libraryBookId,
        versionLinkId: body.data.versionLinkId,
        bookVersionId: body.data.bookVersionId,
        duplicated: true,
      })

      const member = await createApp({ id: memberId }).request(`/api/v1/libraries/${libraryId}/books/from-private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: source.book.id }),
      })
      expect(member.status).toBe(403)
    })

    it('pushes a linked private draft and refuses members', async () => {
      const draft = await uploadBook(ownerId, new File(['第一章\n草稿'], 'd.txt', { type: 'text/plain' }))
      const ownerApp = createApp({ id: ownerId })
      const published = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/from-private`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: draft.book.id }),
      })
      expect(published.status).toBe(201)
      const pub = (await published.json()).data as { libraryBookId: string; versionLinkId: string }
      const url = `/api/v1/libraries/${libraryId}/books/${pub.libraryBookId}/versions/${pub.versionLinkId}/push`
      const res = await ownerApp.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      // Draft unchanged since publish: identical bytes, no new revision.
      expect(res.status).toBe(200)
      expect((await res.json()).data).toMatchObject({ revisionNo: 1, alreadyUpToDate: true, diverged: false })

      const memberApp = createApp({ id: memberId })
      const denied = await memberApp.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(denied.status).toBe(403)
    })

    it('appends and re-splits city content for managers', async () => {
      // Content reads need real bytes: swap the file mock for a memory driver.
      const files = new Map<string, Buffer>()
      const driver = {
        put: async (key: string, data: Buffer | AsyncIterable<Buffer>) => {
          files.set(key, Buffer.isBuffer(data) ? data : Buffer.concat(await collectChunks(data)))
        },
        get: async (key: string) => {
          const buf = files.get(key)
          if (!buf) throw new Error(`missing blob: ${key}`)
          return Readable.from(buf)
        },
        delete: async (key: string) => { files.delete(key) },
        exists: async (key: string) => files.has(key),
        size: async (key: string) => files.get(key)?.length ?? 0,
      }
      async function collectChunks(data: AsyncIterable<Buffer>) {
        const chunks: Buffer[] = []
        for await (const chunk of data) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        return chunks
      }
      vi.spyOn(storage, 'getStorage').mockReturnValue(driver as unknown as ReturnType<typeof storage.getStorage>)
      const created = await uploadCatalogBook(libraryId, ownerId, new File(['第一章\n甲'], 'c.txt', { type: 'text/plain' }), { title: 'Serial' })
      const ownerApp = createApp({ id: ownerId })
      const base = `/api/v1/libraries/${libraryId}/books/${created.libraryBookId}/versions/${created.versionLinkId}`

      const preview = await ownerApp.request(`${base}/append-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '第二章\n乙' }),
      })
      expect(preview.status).toBe(200)
      expect((await preview.json()).data).toMatchObject({ addedChapterCount: 1 })
      const appended = await ownerApp.request(`${base}/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '第二章\n乙' }),
      })
      expect(appended.status).toBe(200)
      expect((await appended.json()).data).toMatchObject({ revisionNo: 2 })

      const tocPreview = await ownerApp.request(`${base}/toc-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(tocPreview.status).toBe(200)
      const retoc = await ownerApp.request(`${base}/re-toc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(retoc.status).toBe(200)

      const memberApp = createApp({ id: memberId })
      const denied = await memberApp.request(`${base}/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '第二章\n乙' }),
      })
      expect(denied.status).toBe(403)
      const bad = await ownerApp.request(`${base}/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(bad.status).toBe(400)
    })

    it('lists the catalog and edits work and version metadata', async () => {
      const ownerApp = createApp({ id: ownerId })
      const created = await (await ownerApp.request(`/api/v1/libraries/${libraryId}/books`, {
        method: 'POST', body: uploadBody('第一章\n正文', { title: '原名' }),
      })).json() as { data: { id: string; versions: Array<{ id: string }> } }
      const workId = created.data.id
      const versionId = created.data.versions[0].id

      const list = await ownerApp.request(`/api/v1/libraries/${libraryId}/books?q=原`)
      expect(list.status).toBe(200)
      expect((await list.json()).data.items).toHaveLength(1)

      const renamed = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/${workId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '新名' }),
      })
      expect((await renamed.json()).data.versions[0].effective.title).toBe('新名')

      const patchedVersion = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/${workId}/versions/${versionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: null, status: 'unlisted' }),
      })
      expect(patchedVersion.status).toBe(200)
      expect((await patchedVersion.json()).data).toMatchObject({ title: null, status: 'unlisted' })

      // Empty patches and foreign versions are validation errors, not silent no-ops.
      const empty = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/${workId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      expect(empty.status).toBe(400)
      const foreign = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/${workId}/versions/${createId('lbv')}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
      })
      expect(foreign.status).toBe(404)
    })

    it('suggests, moves and deletes catalog versions', async () => {
      const ownerApp = createApp({ id: ownerId })
      const upload = async (content: string, extra: Record<string, string> = {}) => {
        const res = await ownerApp.request(`/api/v1/libraries/${libraryId}/books`, {
          method: 'POST', body: uploadBody(content, extra),
        })
        const body = await res.json() as { data: { id: string; versions: Array<{ id: string }> } }
        return { workId: body.data.id, versionId: body.data.versions[0].id }
      }
      const first = await upload('第一章\n甲', { title: '作品甲' })
      const second = await upload('第一章\n乙', { title: '作品乙', libraryBookId: first.workId })
      const other = await upload('第一章\n丙', { title: '作品丙' })

      // Grouping hints need a title and stay inside the library.
      const noQuery = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/similar`)
      expect(noQuery.status).toBe(400)
      const hints = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/similar?title=${encodeURIComponent('作品甲')}`)
      expect(hints.status).toBe(200)
      expect((await hints.json()).data[0].id).toBe(first.workId)

      const moved = await ownerApp.request(
        `/api/v1/libraries/${libraryId}/books/${first.workId}/versions/${second.versionId}/move`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryBookId: other.workId }) },
      )
      expect(moved.status).toBe(200)
      expect((await moved.json()).data.versions).toHaveLength(2)

      const memberApp = createApp({ id: memberId })
      const deniedMove = await memberApp.request(
        `/api/v1/libraries/${libraryId}/books/${first.workId}/versions/${first.versionId}/move`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryBookId: other.workId }) },
      )
      expect(deniedMove.status).toBe(403)

      const deleted = await ownerApp.request(
        `/api/v1/libraries/${libraryId}/books/${other.workId}/versions/${second.versionId}`,
        { method: 'DELETE' },
      )
      expect(deleted.status).toBe(200)
      expect((await deleted.json()).data).toMatchObject({ workDeleted: false })
      const missing = await ownerApp.request(`/api/v1/libraries/${libraryId}/books/${other.workId}/versions/${createId('lbv')}`, {
        method: 'DELETE',
      })
      expect(missing.status).toBe(404)
    })
  })
})
