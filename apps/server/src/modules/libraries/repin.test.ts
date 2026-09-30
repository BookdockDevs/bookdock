import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { getActiveBook, uploadBook } from '../books/books.service'
import { uploadCatalogBook } from '../books/books.service'
import { updateCatalogVersion } from './catalog.service'
import { addToPrivateLibrary } from './collect.service'
import { getSourceStatus, repinToLatest } from './repin.service'

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

describe('re-pin B to the source latest', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let memberId: string
  let libraryId: string

  function seedUser(username: string) {
    const id = createId('user')
    db.insert(schema.users).values({ id, username, passwordHash: null, role: 'member', createdAt: 1 }).run()
    db.insert(schema.libraries).values({
      id: createId('lib'), userId: id, type: 'private', name: username,
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  const txtFile = (body: string) => new File([body], 'novel.txt', { type: 'text/plain' })

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const memory = createMemoryStorage()
    vi.spyOn(storage, 'getStorage').mockReturnValue(memory.driver)
    registerParser(new TxtParser())
    ownerId = seedUser('owner')
    memberId = seedUser('member')
    libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
  })

  async function seedCityBook(title = '三体') {
    return uploadCatalogBook(libraryId, ownerId, txtFile('第一章\n正文内容'), { title, author: '刘慈欣' })
  }

  /** Simulate the city publishing a new revision of the same version. */
  async function publishCityRevision(bookVersionId: string, body: string) {
    const blobKey = `blobs/aa/${createId('blob')}.epub`
    await storage.getStorage().put(blobKey, Buffer.from(body))
    const revId = createId('rev')
    db.insert(schema.contentRevisions).values({
      id: revId, bookVersionId, revisionNo: 2, blobKey,
      size: body.length, wordCount: 2, chapterCount: 1, meta: {}, createdAt: Date.now(),
    }).run()
    return revId
  }

  it('follows the source latest on explicit request only', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const before = (await getActiveBook(memberId, city.bookVersionId)).filePath

    const rev2Id = await publishCityRevision(city.bookVersionId, '第二版内容')
    // The B keeps reading its pin until asked to follow.
    expect((await getActiveBook(memberId, city.bookVersionId)).filePath).toBe(before)
    expect(await getSourceStatus(memberId, city.bookVersionId)).toMatchObject({
      readable: true, hasUpdate: true, latestRevisionId: rev2Id, latestRevisionNo: 2,
    })

    const result = await repinToLatest(memberId, city.bookVersionId)
    expect(result).toMatchObject({ pinnedRevisionId: rev2Id, revisionNo: 2, alreadyUpToDate: false })
    expect((await getActiveBook(memberId, city.bookVersionId)).filePath).not.toBe(before)
    expect(await getSourceStatus(memberId, city.bookVersionId)).toMatchObject({ hasUpdate: false })
  })

  it('is idempotent when already up to date', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const privateId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, memberId), eq(schema.libraries.type, 'private'))).get()!.id
    const linkBefore = db.select().from(schema.libraryBookVersions)
      .where(and(
        eq(schema.libraryBookVersions.libraryId, privateId),
        eq(schema.libraryBookVersions.bookVersionId, city.bookVersionId),
      )).get()!

    const result = await repinToLatest(memberId, city.bookVersionId)
    expect(result).toMatchObject({ pinnedRevisionId: linkBefore.pinnedRevisionId, alreadyUpToDate: true })
  })

  it('refuses to follow an unreadable source and keeps the old pin', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    await publishCityRevision(city.bookVersionId, '第二版内容')
    await updateCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!, { status: 'unlisted' })

    const pinBefore = db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.bookVersionId, city.bookVersionId)).get()!.pinnedRevisionId
    expect(await getSourceStatus(memberId, city.bookVersionId)).toMatchObject({ readable: false, hasUpdate: false })
    await expect(repinToLatest(memberId, city.bookVersionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    expect(db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.bookVersionId, city.bookVersionId)).get()!.pinnedRevisionId).toBe(pinBefore)
  })

  it('refuses to re-pin a personal upload and reports neutral status', async () => {
    const own = await uploadBook(memberId, txtFile('第一章\n本地书'))
    await expect(repinToLatest(memberId, own.book.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await getSourceStatus(memberId, own.book.id)).toMatchObject({ readable: true, hasUpdate: false })
  })
})
