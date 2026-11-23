import { Readable } from 'node:stream'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookShareLink } from '@bookdock/shared'

import app from '../../app'
import * as dbClient from '../../db/client'
import * as schema from '../../db/schema'
import { convertTxtToEpub } from '../../lib/txt-to-epub'
import { resetAuthCaches } from '../../middleware/auth.guard'
import * as storage from '../../storage'
import { createSession } from '../auth/auth.service'
import { createAccessToken } from '../tokens/tokens.service'

const webPath = '/api/v1/book-shares/books/book'
const extPath = '/api/v1/ext/books/book/download-link'

describe('book download links', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof dbClient.getDb>
  let ownerToken: string
  let file: Buffer

  function request(path: string, method: 'GET' | 'POST' | 'DELETE', token?: string, body?: unknown) {
    return app.request(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async function generate(duration: BookShareLink['duration'] = '7d', replace = false): Promise<BookShareLink> {
    const response = await request(webPath, 'POST', ownerToken, { duration, replace })
    expect(response.status).toBe(200)
    return (await response.json() as { data: BookShareLink }).data
  }

  beforeEach(async () => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    vi.spyOn(dbClient, 'getDb').mockReturnValue(db)
    await dbClient.runDatabaseMigrations(db)
    resetAuthCaches()
    db.insert(schema.users).values([
      { id: 'owner', username: 'owner', createdAt: 1 },
      { id: 'member', username: 'member', createdAt: 1 },
    ]).run()
    db.insert(schema.libraries).values({
      id: 'library', userId: 'owner', type: 'shared', name: 'Library', visibility: 'private', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryMemberships).values({
      id: 'membership', libraryId: 'library', userId: 'member', role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryBooks).values({
      id: 'work', libraryId: 'library', userId: 'owner', title: 'Book', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.bookVersions).values({ id: 'book', format: 'epub', size: 1, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({
      id: 'source', libraryId: 'library', libraryBookId: 'work', bookVersionId: 'book', kind: 'personal', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.contentRevisions).values({
      id: 'r1', bookVersionId: 'book', revisionNo: 1, blobKey: 'book.epub', size: 1, createdAt: 1,
    }).run()
    ownerToken = createSession('owner').token
    file = await convertTxtToEpub({ title: 'Book', id: 'book' }, [
      { id: 'chapter', title: 'Chapter one', level: 1 },
    ], () => 'Original sentence.')
    vi.spyOn(storage, 'getStorage').mockReturnValue({
      exists: async () => true,
      size: async () => file.length,
      get: async (_key, range) => Readable.from(range ? file.subarray(range.start, range.end + 1) : file),
      put: async () => {},
      delete: async () => {},
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    sqlite.close()
  })

  it('shares one link across Web and external API, with a separate token scope', async () => {
    const directDownload = createAccessToken('owner', { permissions: ['ext:file'] }).plaintext
    const shareToken = createAccessToken('owner', { permissions: ['ext:download-link'] }).plaintext
    expect((await request(extPath, 'POST', directDownload, { duration: '7d' })).status).toBe(403)
    expect((await request(extPath, 'POST', shareToken, {})).status).toBe(400)
    expect((await request(extPath, 'POST', shareToken, { duration: 'forever' })).status).toBe(400)
    expect((await request(webPath, 'POST', shareToken, { duration: '7d' })).status).toBe(403)
    expect((await request(webPath, 'POST', createSession('member').token, { duration: '7d' })).status).toBe(404)
    const created = await request(extPath, 'POST', shareToken, { duration: 'permanent' })
    expect(created.status).toBe(200)
    const { data: external } = await created.json() as { data: BookShareLink }
    const link = await generate()
    expect(external).toEqual({ ...link, url: new URL(link.url, 'http://localhost').href, duration: 'permanent', expiresAt: null })
    const reused = await request(extPath, 'POST', shareToken, { duration: '1d', libraryId: 'library' })
    expect(await reused.json()).toEqual({ data: external })
    expect(db.select().from(schema.bookShareLinks).all()).toHaveLength(1)
    expect((await request(webPath, 'GET')).status).toBe(401)
    const download = await request(link.url, 'GET')
    expect(download.status).toBe(200)
    expect(download.headers.get('Content-Disposition')).toMatch(/\.epub$/)
    expect(download.headers.get('Cache-Control')).toContain('no-store')
    expect(Buffer.from(await download.arrayBuffer())).toEqual(file)
  })

  it('lets only the private file owner share and invalidates the link when that account is disabled', async () => {
    db.update(schema.libraries).set({ type: 'private', visibility: null }).run()
    db.update(schema.libraryMemberships).set({ role: 'admin' }).run()
    const foreign = await request(webPath, 'POST', createSession('member').token, { duration: 'permanent', libraryId: 'library' })
    expect(foreign.status).toBe(404)
    const link = await generate('permanent')
    db.update(schema.users).set({ disabled: 1 }).where(eq(schema.users.id, 'owner')).run()
    db.update(schema.users).set({ disabled: 0 }).where(eq(schema.users.id, 'owner')).run()
    expect((await request(link.url, 'GET')).status).toBe(404)
  })

  it('downloads plain TXT without evaluating the creator’s replacement rules', async () => {
    db.update(schema.bookVersions).set({ format: 'txt' }).where(eq(schema.bookVersions.id, 'book')).run()
    db.insert(schema.textReplacements).values({
      id: 'rule', userId: 'owner', pattern: 'Original', replacement: 'Replaced', createdAt: 1, updatedAt: 1,
    }).run()
    const link = await generate()
    const download = await request(link.url, 'GET')
    expect(download.status).toBe(200)
    expect(download.headers.get('Content-Disposition')).toMatch(/\.txt$/)
    const text = await download.text()
    expect(text).toContain('Original sentence.')
    expect(text).not.toContain('Replaced')
  })

  it('rotates, revokes and expires links', async () => {
    const first = await generate()
    const second = await generate('1h', true)
    expect(second.url).not.toBe(first.url)
    expect((await request(first.url, 'GET')).status).toBe(404)
    await request(webPath, 'DELETE', ownerToken)
    expect((await request(second.url, 'GET')).status).toBe(404)
    const third = await generate()
    db.update(schema.bookShareLinks).set({ expiresAt: 1 }).run()
    expect((await request(third.url, 'GET')).status).toBe(404)
    expect((await (await request(webPath, 'GET', ownerToken)).json())).toEqual({ data: null })
  })

  it('never revives links after restoring a book, permission, or a previous revision', async () => {
    const link = await generate('permanent')
    db.update(schema.libraryBooks).set({ deletedAt: 2 }).run()
    db.update(schema.libraryBooks).set({ deletedAt: null }).run()
    expect((await request(link.url, 'GET')).status).toBe(404)
    const replacement = await generate('permanent')
    db.insert(schema.contentRevisions).values({
      id: 'r2', bookVersionId: 'book', revisionNo: 2, blobKey: 'updated.epub', size: 1, createdAt: 2,
    }).run()
    expect((await request(replacement.url, 'GET')).status).toBe(404)
    db.delete(schema.contentRevisions).where(eq(schema.contentRevisions.id, 'r2')).run()
    expect((await request(replacement.url, 'GET')).status).toBe(404)
    db.update(schema.libraryMemberships).set({ role: 'admin' }).run()
    const member = await request(webPath, 'POST', createSession('member').token, { duration: 'permanent' })
    expect(member.status).toBe(200)
    const { data: memberLink } = await member.json() as { data: BookShareLink }
    db.update(schema.libraryMemberships).set({ role: 'member' }).run()
    db.update(schema.libraryMemberships).set({ role: 'admin' }).run()
    expect((await request(memberLink.url, 'GET')).status).toBe(404)
  })

  it('returns an HTML 404 page for browser requests to unavailable share links and JSON otherwise', async () => {
    const link = await generate('permanent')
    await request(webPath, 'DELETE', ownerToken)

    const apiRes = await app.request(link.url, { method: 'GET' })
    expect(apiRes.status).toBe(404)
    expect(apiRes.headers.get('Content-Type')).toContain('application/json')

    const zhHtmlRes = await app.request(link.url, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    })
    expect(zhHtmlRes.status).toBe(404)
    expect(zhHtmlRes.headers.get('Content-Type')).toContain('text/html')
    expect(await zhHtmlRes.text()).toContain('链接已失效')

    const enHtmlRes = await app.request(link.url, {
      method: 'GET',
      headers: { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    })
    expect(enHtmlRes.status).toBe(404)
    expect(await enHtmlRes.text()).toContain('Link unavailable')
  })
})
