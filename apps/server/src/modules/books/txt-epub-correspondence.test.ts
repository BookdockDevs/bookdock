import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import JSZip from 'jszip'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookUploadRes } from '@bookdock/shared'

import * as client from '../../db/client'
import * as schema from '../../db/schema'
import { migrateTestBaseWithStorage } from '../../db/migration-stage'
import { EpubParser } from '../../formats/epub'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { errorHandler } from '../../middleware/error'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createReplacement } from '../replacements/replacements.service'

import booksRoutes from './books.routes'
import { appendTxtBookContent, trashBook, updateBook } from './books.service'

const directory = path.dirname(fileURLToPath(import.meta.url))
const sample = readFileSync(process.env.BOOKDOCK_TEST_TXT ?? path.join(directory, 'fixtures/correspondence.txt'))

describe('private TXT/export correspondence', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle<typeof schema>>
  let files: Map<string, Buffer>
  let actor: string
  let app: Hono

  beforeAll(() => {
    registerParser(new TxtParser())
    registerParser(new EpubParser())
  })

  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    migrateTestBaseWithStorage(db, { migrationsFolder: path.join(directory, '../../db/migrations') })
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    files = new Map()
    const driver: StorageDriver = {
      async put(key, data) {
        const parts: Buffer[] = []
        if (Buffer.isBuffer(data)) files.set(key, data)
        else {
          for await (const part of data) parts.push(Buffer.from(part))
          files.set(key, Buffer.concat(parts))
        }
      },
      async get(key) { return Readable.from(files.get(key)!) },
      async exists(key) { return files.has(key) },
      async size(key) { return files.get(key)?.length ?? 0 },
      async delete(key) { files.delete(key) },
    }
    vi.spyOn(storage, 'getStorage').mockReturnValue(driver)
    for (const id of ['owner', 'other']) db.insert(schema.users).values({ id, username: id, role: 'owner', createdAt: Date.now() }).run()
    actor = 'owner'
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => {
      c.set('user', { id: actor, username: actor, role: 'owner', avatarKey: null })
      await next()
    })
    app.route('/api/v1/books', booksRoutes)
  })

  afterEach(() => { vi.restoreAllMocks(); sqlite.close() })

  async function upload(buffer: Buffer, name: string, allow = false) {
    const form = new FormData()
    form.set('file', new File([new Uint8Array(buffer)], name, { type: name.endsWith('.txt') ? 'text/plain' : 'application/epub+zip' }))
    if (allow) form.set('allowCorresponding', 'true')
    const response = await app.request('/api/v1/books', { method: 'POST', body: form })
    if (allow) expect(response.status).toBe(201)
    expect(response.ok).toBe(true)
    return { status: response.status, body: await response.json() as BookUploadRes }
  }

  async function download(id: string, endpoint = 'export.epub?plain=1') {
    const response = await app.request(`/api/v1/books/${id}/${endpoint}`)
    expect(response.status).toBe(200)
    return Buffer.from(await response.arrayBuffer())
  }

  it('uploads a TXT file, downloads EPUB, warns without writes, and allows a separate B', async () => {
    const a = (await upload(sample, 'A.txt')).body.data
    const bytes = await download(a.id)
    const count = db.select().from(schema.bookVersions).all().length
    const fileCount = files.size
    const advisory = await upload(bytes, 'B.epub')
    expect(advisory.status).toBe(200)
    expect(advisory.body.corresponding).toEqual({ id: a.id, title: a.title })
    expect(advisory.body.duplicated).toBe(false)
    expect(db.select().from(schema.bookVersions).all()).toHaveLength(count)
    expect(files.size).toBe(fileCount)
    const b = await upload(bytes, 'B.epub', true)
    expect(b.body.data.id).not.toBe(a.id)
    expect(b.body.corresponding).toBeUndefined()
    const repeat = await upload(bytes, 'B-again.epub', true)
    expect(repeat.body.duplicated).toBe(true)
    expect(repeat.body.data.id).toBe(b.body.data.id)
    expect((await upload(sample, 'A-again.txt')).body.duplicated).toBe(true)
  })

  it('also verifies the stored EPUB and ignores ZIP compression and timestamps', async () => {
    const a = (await upload(sample, 'A.txt')).body.data
    const zip = await JSZip.loadAsync(await download(a.id, 'epub'))
    for (const entry of Object.values(zip.files)) entry.date = new Date('2000-01-01T00:00:00Z')
    const repacked = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    expect((await upload(repacked, 'B.epub')).body.corresponding?.id).toBe(a.id)
  })

  it.each(['body', 'spine', 'extra'])('rejects a modified %s even with the original identifier', async (change) => {
    const a = (await upload(sample, 'A.txt')).body.data
    const zip = await JSZip.loadAsync(await download(a.id))
    if (change === 'body') {
      const name = 'OEBPS/chapter-0001.xhtml'
      zip.file(name, (await zip.file(name)!.async('string')).replace('<p>', '<p>Changed content. '))
    } else if (change === 'spine') {
      const name = 'OEBPS/content.opf'
      zip.file(name, (await zip.file(name)!.async('string')).replace('<itemref', '<itemref linear="no"'))
    } else zip.file('OEBPS/extra.xhtml', '<html><body>Extra content</body></html>')
    const result = await upload(await zip.generateAsync({ type: 'nodebuffer' }), 'changed.epub')
    expect(result.status).toBe(201)
    expect(result.body.corresponding).toBeUndefined()
    expect(result.body.data.id).not.toBe(a.id)
  })

  it('rejects replacement exports but still recognizes the plain export', async () => {
    const a = (await upload(sample, 'A.txt')).body.data
    await createReplacement(actor, { pattern: '正文', replacement: '修改内容', applyTo: 'content' })
    const edited = await upload(await download(a.id, 'export.epub'), 'edited.epub')
    expect(edited.body.corresponding).toBeUndefined()
    expect((await upload(await download(a.id), 'plain.epub')).body.corresponding?.id).toBe(a.id)
  })

  it('never exposes another user\'s TXT candidate', async () => {
    const a = (await upload(sample, 'A.txt')).body.data
    const bytes = await download(a.id)
    actor = 'other'
    const b = await upload(bytes, 'B.epub')
    expect(b.body.corresponding).toBeUndefined()
    expect(b.body.data.id).not.toBe(a.id)
  })

  it('does not use a collected or shared link as a personal TXT candidate', async () => {
    const a = (await upload(sample, 'A.txt')).body.data
    const bytes = await download(a.id)
    db.update(schema.libraryBookVersions).set({ kind: 'shared' })
      .where(eq(schema.libraryBookVersions.bookVersionId, a.id)).run()
    const b = await upload(bytes, 'B.epub')
    expect(b.status).toBe(201)
    expect(b.body.corresponding).toBeUndefined()
  })

  it('compares the latest content, not an obsolete source revision', async () => {
    const a = (await upload(sample, 'A.txt')).body.data
    const bytes = await download(a.id)
    await appendTxtBookContent(actor, a.id, '\n第三章 新正文\n\n追加正文。')
    expect((await upload(bytes, 'old.epub')).body.corresponding).toBeUndefined()
  })

  it('recognizes current metadata exports and handles trashed stored candidates', async () => {
    const a = (await upload(sample, 'A.txt')).body.data
    const stored = await download(a.id, 'epub')
    await updateBook(actor, a.id, { title: 'Renamed A' })
    expect((await upload(await download(a.id), 'renamed.epub')).body.corresponding?.title).toBe('Renamed A')
    await trashBook(actor, a.id)
    expect((await upload(stored, 'stored.epub')).body.corresponding?.id).toBe(a.id)
  })
})
