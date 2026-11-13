import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '../../db/client'
import * as schema from '../../db/legacy-test-schema'
import { migrateBeforeBookRetirementIncluding as migrate } from '../../db/migration-stage'
import { EpubParser } from '../../formats/epub'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { createId } from '../../lib/id'
import { WebDavClient } from '../../lib/webdav'
import { authGuard, resetAuthCaches } from '../../middleware/auth.guard'
import { errorHandler } from '../../middleware/error'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createSession } from '../auth/auth.service'
import booksRoutes from '../books/books.routes'
import { getActiveBook, uploadCatalogBook } from '../books/books.service'
import readerContentRoutes from '../books/reader-content.routes'
import * as readerContent from '../books/reader-content.service'
import extRoutes from '../ext/ext.routes'
import storageConnectionRoutes from '../integrations/storage-connection.routes'
import { createStorageConnection } from '../integrations/storage-connection.service'
import webdavRoutes from '../integrations/webdav.routes'
import { updateWebDavConfig } from '../integrations/webdav.service'
import { addToPrivateLibrary } from './collect.service'
import { getCatalogBook, updateCatalogBook } from './catalog.service'
import { assertCanContribute, ensurePrivateLibrary } from './library-access'
import librariesRoutes from './libraries.routes'
import { updateLibrary } from './libraries.service'

const testDataDir = vi.hoisted(() => `${process.cwd()}/.tmp-permissions-${process.pid}-${Date.now()}`)

vi.mock('../../config', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../config')>()
  return { config: { ...original.config, dataDir: testDataDir, dbPath: `${testDataDir}/bookdock.db`, jwtSecret: 'permission-test-secret' } }
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') }, ['0041_idea_discussion', '0042_storage_connections', '0043_storage_backend', '0044_storage_s3', '0046_book_reviews', '0048_content_files', '0055_activity_events'])
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

describe('library permission boundaries', () => {
  let db: ReturnType<typeof createTestDb>
  let files: Map<string, Buffer>
  let ownerId: string
  let adminId: string
  let memberId: string
  let outsiderId: string
  let libraryId: string

  function seedUser(username: string) {
    const id = createId('user')
    db.insert(schema.users).values({ id, username, passwordHash: null, role: 'member', createdAt: 1 }).run()
    return id
  }

  function seedTag(libraryId: string, name: string) {
    const id = createId('ltag')
    db.insert(schema.libraryTags).values({
      id, libraryId, userId: ownerId, name, sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  function txtFile(name: string, body: string) {
    return new File([body], name, { type: 'text/plain' })
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const memory = createMemoryStorage()
    files = memory.files
    vi.spyOn(storage, 'getStorage').mockReturnValue(memory.driver)
    vi.spyOn(readerContent, 'enqueueReaderArchivePreparation').mockReturnValue('skipped')
    registerParser(new TxtParser())
    registerParser(new EpubParser())
    resetAuthCaches()
    ownerId = seedUser('owner')
    adminId = seedUser('admin')
    memberId = seedUser('member')
    outsiderId = seedUser('outsider')
    libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    // A realistic library: one admin, one plain member, one outsider.
    db.insert(schema.libraryMemberships).values([
      { id: createId('lbm'), libraryId, userId: adminId, role: 'admin', createdAt: 1, updatedAt: 1 },
      { id: createId('lbm'), libraryId, userId: memberId, role: 'member', createdAt: 1, updatedAt: 1 },
    ]).run()
  })

  afterEach(async () => {
    await readerContent.waitForReaderDerivedWritesForTests()
    readerContent.resetReaderContentCachesForTests()
    db.$client.close()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await fs.rm(testDataDir, { recursive: true, force: true })
  })

  function appFor(userId?: string) {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('/api/v1/*', authGuard())
    const token = userId ? createSession(userId).token : undefined
    app.route('/api/v1/books', readerContentRoutes)
    app.route('/api/v1/books', booksRoutes)
    app.route('/api/v1/libraries', librariesRoutes)
    app.route('/api/v1/ext', extRoutes)
    app.route('/api/v1/integrations/storage-connections', storageConnectionRoutes)
    app.route('/api/v1/integrations/webdav', webdavRoutes)
    return {
      request(input: string, init?: RequestInit) {
        const headers = new Headers(init?.headers)
        if (token) headers.set('Authorization', `Bearer ${token}`)
        return app.request(input, { ...init, headers })
      },
    }
  }

  function seedInstance(allowUserUpload = false, allowGuestAccess = false) {
    db.insert(schema.instance).values({ id: 'instance', ownerUserId: outsiderId, allowUserUpload, allowGuestAccess, createdAt: 1, updatedAt: 1 }).run()
    resetAuthCaches()
  }

  function uploadBody(text: string, libraryId?: string) {
    const body = new FormData()
    body.set('file', txtFile('book.txt', text))
    if (libraryId) body.set('libraryId', libraryId)
    return body
  }

  it('enforces the private upload switch across implicit, explicit and external targets', async () => {
    seedInstance()
    const privateId = ensurePrivateLibrary(db, memberId)
    const app = appFor(memberId)
    for (const [path, target] of [['/api/v1/books', undefined], [`/api/v1/libraries/${privateId}/books`, undefined], ['/api/v1/ext/books', privateId]] as const) {
      const response = await app.request(path, { method: 'POST', body: uploadBody(path, target) })
      expect(response.status, await response.clone().text()).toBe(403)
    }
    expect(db.select().from(schema.bookVersions).all()).toHaveLength(0)
    expect(files.size).toBe(0)
    const ownPrivate = ensurePrivateLibrary(db, outsiderId)
    const ownerUpload = await appFor(outsiderId).request(`/api/v1/libraries/${ownPrivate}/books`, { method: 'POST', body: uploadBody('Instance owner upload') })
    expect(ownerUpload.status, await ownerUpload.clone().text()).toBe(201)
  })

  it.each(['owner', 'admin', 'member'] as const)('allows shared upload for a library %s independently of private upload policy', async (role) => {
    seedInstance()
    await updateLibrary(ownerId, libraryId, { allowMemberUpload: true })
    const actorId = role === 'owner' ? ownerId : role === 'admin' ? adminId : memberId
    const response = await appFor(actorId).request(`/api/v1/libraries/${libraryId}/books`, { method: 'POST', body: uploadBody(role) })
    expect(response.status, await response.clone().text()).toBe(201)
    if (role === 'member') {
      await updateLibrary(ownerId, libraryId, { allowMemberUpload: false })
      expect((await appFor(actorId).request(`/api/v1/libraries/${libraryId}/books`, { method: 'POST', body: uploadBody('Closed') })).status).toBe(403)
    }
  })

  it('does not let duplicate uploads grant work metadata permission', async () => {
    seedInstance(true)
    await updateLibrary(ownerId, libraryId, { allowMemberUpload: true })
    const original = await uploadCatalogBook(libraryId, ownerId, txtFile('original.txt', 'Same content'))
    const tagId = seedTag(libraryId, 'Managed tag')
    await expect(updateCatalogBook(memberId, libraryId, original.libraryBookId, { tagIds: [tagId] })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const memberDuplicate = await uploadCatalogBook(libraryId, memberId, txtFile('duplicate.txt', 'Same content'), { tagIds: [tagId] })
    expect(memberDuplicate.duplicated).toBe(true)
    expect(db.select().from(schema.libraryBookTags).all()).toHaveLength(0)
    await uploadCatalogBook(libraryId, memberId, txtFile('new-version.txt', 'Different version'), { libraryBookId: original.libraryBookId, tagIds: [tagId] })
    expect(db.select().from(schema.libraryBookTags).all()).toHaveLength(0)
    const ownWork = await uploadCatalogBook(libraryId, memberId, txtFile('new-work.txt', 'New work'), { tagIds: [tagId] })
    expect(db.select().from(schema.libraryBookTags).all()).toEqual([expect.objectContaining({ libraryBookId: ownWork.libraryBookId, tagId })])
    const adminDuplicate = await uploadCatalogBook(libraryId, adminId, txtFile('duplicate.txt', 'Same content'), { tagIds: [tagId] })
    expect(adminDuplicate.duplicated).toBe(true)
    expect(db.select().from(schema.libraryBookTags).all()).toEqual(expect.arrayContaining([expect.objectContaining({ libraryBookId: original.libraryBookId, tagId })]))
  })

  it('blocks every collected-link revision writer without changing the shared source', async () => {
    seedInstance(true)
    const original = await uploadCatalogBook(libraryId, ownerId, txtFile('source.txt', '第一章\nOriginal shared text'))
    const privateId = ensurePrivateLibrary(db, memberId)
    const collected = await addToPrivateLibrary(memberId, libraryId, original.versionLinkId!)
    const link = db.select().from(schema.libraryBookVersions).where(and(eq(schema.libraryBookVersions.libraryId, privateId), eq(schema.libraryBookVersions.bookVersionId, original.bookVersionId))).get()!
    const revision = db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, original.bookVersionId)).get()!
    const beforeFiles = [...files.entries()]
    expect((await getCatalogBook(memberId, privateId, collected.libraryBookId)).versions[0].maintainable).toBe(false)
    const path = `/api/v1/libraries/${privateId}/books/${collected.libraryBookId}/versions/${link.id}`
    const app = appFor(memberId)
    for (const [suffix, method, body] of [
      ['/append', 'POST', { text: '\n第二章\nInjected text' }],
      ['/re-toc', 'POST', {}],
      [`/content/${original.bookVersionId}/editor-content`, 'PUT', { baseRevisionId: revision.id, chapters: [{ id: 'ch1', title: 'Injected', content: 'Injected', level: 0 }] }],
      [`/content/${original.bookVersionId}/editor-epub-content`, 'PUT', { baseRevisionId: revision.id, documents: [], tocEntries: [], spineOrder: [] }],
    ] as const) {
      const response = await app.request(path + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      expect(response.status, `${suffix}: ${await response.clone().text()}`).toBe(403)
    }
    expect(db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, original.bookVersionId)).all()).toEqual([revision])
    expect([...files.entries()]).toEqual(beforeFiles)
    expect((await getActiveBook(ownerId, original.bookVersionId, { showHidden: true })).revisionId).toBe(revision.id)
    await expect(assertCanContribute(memberId, privateId, 'missing')).rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
  })

  it.each(['connection', 'legacy'] as const)('authorizes %s cloud imports by destination before downloading', async (kind) => {
    seedInstance()
    const buffer = Buffer.from('Cloud upload content')
    const download = vi.spyOn(WebDavClient.prototype, 'download').mockResolvedValue({ buffer, name: 'book.txt', size: buffer.length })
    const connection = createStorageConnection(adminId, { name: 'Audit', provider: 'webdav', endpoint: 'https://example.invalid', username: 'audit', password: 'audit' })
    updateWebDavConfig(adminId, { url: 'https://example.invalid', username: 'audit', password: 'audit' })
    const path = kind === 'connection' ? `/api/v1/integrations/storage-connections/${connection.id}/import` : '/api/v1/integrations/webdav/import'
    const app = appFor(adminId)
    const request = (target?: string) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: target, files: ['/book.txt'] }) })
    expect((await request()).status).toBe(403)
    expect((await request(ensurePrivateLibrary(db, adminId))).status).toBe(403)
    expect((await request(ensurePrivateLibrary(db, memberId))).status).toBe(404)
    expect(download).not.toHaveBeenCalled()
    const response = await request(libraryId)
    expect(response.status, await response.clone().text()).toBe(200)
    expect((await response.json()).data.results[0].status).toBe('success')
    expect(download).toHaveBeenCalledTimes(1)
    db.delete(schema.libraryMemberships).where(eq(schema.libraryMemberships.userId, adminId)).run()
    expect((await request(libraryId)).status).toBe(403)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('allows only guest read POSTs and rechecks visibility, listing access and revision', async () => {
    seedInstance(true, true)
    const original = await uploadCatalogBook(libraryId, ownerId, txtFile('guest.txt', 'Guest original text'))
    db.update(schema.libraryBookVersions).set({ guestReadable: true }).where(eq(schema.libraryBookVersions.id, original.versionLinkId!)).run()
    const app = appFor()
    const manifestResponse = await app.request(`/api/v1/books/${original.bookVersionId}/reader/manifest?reader=1`)
    expect(manifestResponse.status).toBe(200)
    const manifest = (await manifestResponse.json()).data
    for (const endpoint of ['search', 'texts']) {
      const body = { revisionId: manifest.revisionId, query: 'original', paths: [manifest.spine[0].path] }
      const path = `/api/v1/books/${original.bookVersionId}/reader/${endpoint}`
      const request = (query: string, input = body) => app.request(path + query, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
      const response = await request('?reader=1')
      expect(response.status, await response.clone().text()).toBe(200)
      await response.text()
      expect((await request('')).status).toBe(403)
      expect((await request('?reader=1', { ...body, revisionId: 'stale' })).status).toBe(409)
      db.update(schema.libraryBookVersions).set({ guestReadable: false }).where(eq(schema.libraryBookVersions.id, original.versionLinkId!)).run()
      expect((await request('?reader=1')).status).toBe(404)
      db.update(schema.libraryBookVersions).set({ guestReadable: true }).where(eq(schema.libraryBookVersions.id, original.versionLinkId!)).run()
      db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, libraryId)).run()
      expect((await request('?reader=1')).status).toBe(404)
      db.update(schema.libraries).set({ visibility: 'public' }).where(eq(schema.libraries.id, libraryId)).run()
    }
    for (const path of [`/api/v1/books/${original.bookVersionId}/append?reader=1`, '/api/v1/settings?reader=1', '/api/v1/books/other/reader/search/extra?reader=1']) {
      expect((await app.request(path, { method: 'POST' })).status).toBe(403)
    }
    db.update(schema.instance).set({ allowGuestAccess: false }).run()
    resetAuthCaches()
    expect((await app.request(`/api/v1/books/${original.bookVersionId}/reader/search?reader=1`, { method: 'POST' })).status).toBe(401)
  })
})
