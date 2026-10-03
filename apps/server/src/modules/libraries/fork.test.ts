import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirement as migrate } from '../../db/migration-stage'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import { retargetBookIdReferences } from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { readProgressFile, writeProgressFile } from '../../lib/progress-file'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { appendTxtBookContent, getActiveBook, uploadBook } from '../books/books.service'
import { uploadCatalogBook } from '../books/books.service'
import { updateCatalogVersion } from './catalog.service'
import { addToPrivateLibrary } from './collect.service'
import { deleteCatalogBook, deleteCatalogVersion, permanentDeleteCatalogBook } from './catalog.service'
import { deleteLibrary } from './libraries.service'
import { forkLocalBook } from './fork.service'
import { createLibraryTag } from '../tags/tags.service'

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

describe('fork B into local C', () => {
  let db: ReturnType<typeof createTestDb>
  let files: Map<string, Buffer>
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

  const memberPrivateId = () => db.select({ id: schema.libraries.id }).from(schema.libraries)
    .where(and(eq(schema.libraries.userId, memberId), eq(schema.libraries.type, 'private'))).get()!.id

  beforeEach(() => {
    db = createTestDb()
    // Mirror production boot (db/client.ts): book_id FKs point at
    // book_versions, so no frozen legacy books rows are needed.
    retargetBookIdReferences(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const memory = createMemoryStorage()
    files = memory.files
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

  async function seedCityBook(title = '三体', body = '第一章\n正文内容') {
    return uploadCatalogBook(libraryId, ownerId, txtFile(body), { title, author: '刘慈欣' })
  }

  it('forks a readable B into an independent local copy with identical bytes', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const pinnedBytes = Buffer.from(await (await storage.getStorage().get(
      db.select().from(schema.contentRevisions)
        .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).get()!.blobKey,
    ).then(async (s) => {
      const chunks: Buffer[] = []
      for await (const c of s) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
      return Buffer.concat(chunks)
    })))

    const result = await forkLocalBook(memberId, city.bookVersionId)
    expect(result.bookVersionId).not.toBe(city.bookVersionId)

    const link = db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.libraryBookId, result.libraryBookId)).get()!
    expect(link).toMatchObject({
      kind: 'local', bookVersionId: result.bookVersionId,
      sourceLibraryId: null, sourceLibraryBookVersionId: null, pinnedRevisionId: null,
    })

    // Same card, now independent and content-identical; no physical copy.
    const book = await getActiveBook(memberId, result.bookVersionId)
    expect(book).toMatchObject({ title: '三体', source: null, collected: true })
    const forkedBytes = await (async () => {
      const chunks: Buffer[] = []
      for await (const c of await storage.getStorage().get(book.filePath)) {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
      }
      return Buffer.concat(chunks)
    })()
    expect(forkedBytes.equals(pinnedBytes)).toBe(true)
    expect(db.select().from(schema.blobs).where(eq(schema.blobs.kind, 'book')).all()
      .filter((b) => b.key === book.filePath)).toHaveLength(1)

    // Local-only content operations open up on the forked card
    // (the same call is FORBIDDEN on a B).
    const appended = await appendTxtBookContent(memberId, result.bookVersionId, '第二章\n新增内容')
    expect(appended.id).toBe(result.bookVersionId)
  })

  it('refuses to fork once the source becomes unreadable', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)

    // Unlisting is an admin revocation: forking past it would defeat that
    // control, so the card stays a blocked B.
    await updateCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!, { status: 'unlisted' })
    await expect(getActiveBook(memberId, city.bookVersionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(forkLocalBook(memberId, city.bookVersionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    expect(db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.bookVersionId, city.bookVersionId)).all()
      .some((row) => row.kind === 'shared')).toBe(true)
  })

  it('keeps card metadata and moves the reading data to the new version', async () => {
    const city = await seedCityBook()
    const tag = await createLibraryTag(memberId, memberPrivateId(), '想读')
    const collected = await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!, { tagIds: [tag.id] })
    db.update(schema.bookStates).set({ percent: 50, readStatus: 'reading' })
      .where(and(eq(schema.bookStates.userId, memberId), eq(schema.bookStates.bookVersionId, city.bookVersionId))).run()
    db.insert(schema.highlights).values({
      id: createId('hl'), userId: memberId, bookVersionId: city.bookVersionId,
      cfiRange: 'epubcfi(/6/2!/4/2)', createdAt: 1, updatedAt: 1,
    }).run()
    await writeProgressFile(memberId, city.bookVersionId, { percent: 50, intervals: [], updatedAt: 1 })

    const result = await forkLocalBook(memberId, city.bookVersionId)

    // Same work, tags intact.
    expect(result.libraryBookId).toBe(collected.libraryBookId)
    const card = db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, result.libraryBookId)).get()!
    expect(card.title).toBe('三体')
    expect(db.select().from(schema.libraryBookTags)
      .where(eq(schema.libraryBookTags.libraryBookId, result.libraryBookId)).all()).toHaveLength(1)
    // Reading data followed the card.
    expect(db.select().from(schema.bookStates)
      .where(and(eq(schema.bookStates.userId, memberId), eq(schema.bookStates.bookVersionId, result.bookVersionId))).get())
      .toMatchObject({ percent: 50, readStatus: 'reading' })
    expect(db.select().from(schema.bookStates)
      .where(and(eq(schema.bookStates.userId, memberId), eq(schema.bookStates.bookVersionId, city.bookVersionId))).get())
      .toBeUndefined()
    expect(db.select().from(schema.highlights)
      .where(and(eq(schema.highlights.userId, memberId), eq(schema.highlights.bookVersionId, result.bookVersionId))).get())
      .toBeDefined()
    expect(await readProgressFile(memberId, result.bookVersionId)).toMatchObject({ percent: 50 })
  })

  it('leaves the city copy and other readers untouched', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const result = await forkLocalBook(memberId, city.bookVersionId)

    expect(result.bookVersionId).not.toBe(city.bookVersionId)
    // The city still serves its own version to everyone else.
    expect((await getActiveBook(ownerId, city.bookVersionId)).id).toBe(city.bookVersionId)
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, city.bookVersionId)).get()).toBeTruthy()
  })

  it('fails when the pinned bytes are gone', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const blobKey = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).get()!.blobKey
    files.delete(blobKey)
    db.delete(schema.blobs).where(eq(schema.blobs.key, blobKey)).run()

    await expect(forkLocalBook(memberId, city.bookVersionId))
      .rejects.toMatchObject({ code: 'BOOK_FILE_MISSING' })
  })

  it('refuses to fork a personal upload', async () => {
    const own = await uploadBook(memberId, txtFile('第一章\n本地书'))
    await expect(forkLocalBook(memberId, own.book.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('refuses to fork a deleted source and keeps the B', async () => {
    // Leaf-first: deleting the library ends the shared world.
    const removers: Array<'version' | 'work' | 'library'> = ['version', 'work', 'library']
    for (const [i, which] of removers.entries()) {
      const city = await seedCityBook(`Title ${i}`, `第一章\n正文${i}`)
      await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
      if (which === 'library') {
        await deleteLibrary(ownerId, libraryId)
      } else if (which === 'work') {
        await deleteCatalogBook(ownerId, libraryId, city.libraryBookId)
        await permanentDeleteCatalogBook(ownerId, libraryId, city.libraryBookId)
      } else {
        await deleteCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!)
      }
      await expect(forkLocalBook(memberId, city.bookVersionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
      const card = db.select().from(schema.libraryBookVersions)
        .where(and(
          eq(schema.libraryBookVersions.libraryId, memberPrivateId()),
          eq(schema.libraryBookVersions.bookVersionId, city.bookVersionId),
        )).get()!
      expect(card.kind).toBe('shared')
      expect(card.sourceLibraryId).toBe(libraryId)
    }
  })

  it('forks at most once: sequential re-fork is refused, concurrent forks yield one C', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const first = await forkLocalBook(memberId, city.bookVersionId)
    await expect(forkLocalBook(memberId, first.bookVersionId)).rejects.toMatchObject({ code: 'FORBIDDEN' })

    const city2 = await seedCityBook('三体 2', '第一章\n另一正文内容')
    await addToPrivateLibrary(memberId, libraryId, city2.versionLinkId!)
    const versionsBefore = db.select({ id: schema.bookVersions.id }).from(schema.bookVersions).all().length
    const [a, b] = await Promise.allSettled([
      forkLocalBook(memberId, city2.bookVersionId),
      forkLocalBook(memberId, city2.bookVersionId),
    ])
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled')
    const rejected = [a, b].filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    // The loser must be refused at the in-transaction re-check, which is the
    // only guard that survives two forks racing the same rewrite.
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'FORBIDDEN' })
    // One card, one new version: the loser left nothing behind.
    expect(db.select({ id: schema.bookVersions.id }).from(schema.bookVersions).all()).toHaveLength(versionsBefore + 1)
    // The member's card rewired onto the single new version; no second card and
    // no half-written one exists in their private library.
    const privateLinks = db.select().from(schema.libraryBookVersions)
      .where(and(
        eq(schema.libraryBookVersions.libraryId, memberPrivateId()),
        eq(schema.libraryBookVersions.bookVersionId, fulfilled.length === 1
          ? (await fulfilled[0]!.value).bookVersionId
          : ''),
      )).all()
    expect(privateLinks).toHaveLength(1)
    expect(privateLinks[0]!.kind).toBe('local')
    // No card anywhere still points at the old city version: the winner rewired
    // the only one there was, so a second C would have left a card behind.
    const dangling = db.select({ id: schema.libraryBookVersions.id }).from(schema.libraryBookVersions)
      .where(and(
        eq(schema.libraryBookVersions.libraryId, memberPrivateId()),
        eq(schema.libraryBookVersions.bookVersionId, city2.bookVersionId),
      )).all()
    expect(dangling).toHaveLength(0)
  })

  it('post-fork writes never touch the source', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const sourceBlobKey = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).get()!.blobKey
    const sourceBytes = files.get(sourceBlobKey)

    const result = await forkLocalBook(memberId, city.bookVersionId)
    await appendTxtBookContent(memberId, result.bookVersionId, '第二章\n新增内容')

    // The city still serves exactly what it served before.
    expect(files.get(sourceBlobKey)).toEqual(sourceBytes)
    expect(db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).all()).toHaveLength(1)
    expect((await getActiveBook(ownerId, city.bookVersionId)).filePath).toBe(sourceBlobKey)
    expect((await getActiveBook(memberId, result.bookVersionId)).filePath).not.toBe(sourceBlobKey)
  })

  it('rebinds the AI retrieval index instead of orphaning it', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const indexId = createId('ai-index')
    const chunkId = createId('ai-chunk')
    db.insert(schema.aiBookIndexes).values({
      id: indexId, userId: memberId, bookId: city.bookVersionId,
      sourceVersion: 'test:1', status: 'ready', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.aiChunks).values({
      id: chunkId, userId: memberId, indexId, bookId: city.bookVersionId,
      chapterIndex: 0, chapterId: 'c1', chapterTitle: 't', startOffset: 0, endOffset: 5,
      text: 'hello', createdAt: 1,
    }).run()
    db.insert(schema.aiChunkEmbeddings).values({
      id: createId('ai-emb'), userId: memberId, indexId, chunkId, bookId: city.bookVersionId,
      model: 'm', dimension: 3, vector: Buffer.from([1, 2, 3]), createdAt: 1,
    }).run()

    const result = await forkLocalBook(memberId, city.bookVersionId)
    for (const table of [schema.aiBookIndexes, schema.aiChunks, schema.aiChunkEmbeddings] as const) {
      const moved = db.select().from(table)
        .where(and(eq(table.userId, memberId), eq(table.bookId, result.bookVersionId))).all()
      expect(moved.length).toBeGreaterThan(0)
      const left = db.select().from(table)
        .where(and(eq(table.userId, memberId), eq(table.bookId, city.bookVersionId))).all()
      expect(left).toHaveLength(0)
    }
  })

  it('moves bookmarks, ideas and reading history to the new version', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    db.insert(schema.bookmarks).values({
      id: createId('bm'), userId: memberId, bookVersionId: city.bookVersionId, createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.ideas).values({
      id: createId('idea'), userId: memberId, bookVersionId: city.bookVersionId, createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.readingRecords).values({
      id: createId('rr'), userId: memberId, bookId: city.bookVersionId, bookVersionId: city.bookVersionId,
      date: '2026-09-30',
    }).run()
    db.insert(schema.readingSessions).values({
      id: createId('rs'), userId: memberId, bookId: city.bookVersionId, bookVersionId: city.bookVersionId,
      date: '2026-09-30',
    }).run()

    const result = await forkLocalBook(memberId, city.bookVersionId)
    for (const table of [schema.bookmarks, schema.ideas, schema.readingRecords, schema.readingSessions] as const) {
      const moved = db.select().from(table)
        .where(and(eq(table.userId, memberId), eq(table.bookVersionId, result.bookVersionId))).all()
      expect(moved.length).toBeGreaterThan(0)
      const left = db.select().from(table)
        .where(and(eq(table.userId, memberId), eq(table.bookVersionId, city.bookVersionId))).all()
      expect(left).toHaveLength(0)
    }
  })

})
