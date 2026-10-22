import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirementIncluding as migrate } from '../../db/migration-stage'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as client from '../../db/client'
import * as schema from '../../db/legacy-test-schema'
import { createId } from '../../lib/id'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { deleteBook, updateBook, uploadBook, uploadCatalogBook } from '../books/books.service'
import { addMember, createLibrary } from './libraries.service'
import { addToPrivateLibrary } from './collect.service'
import { publishPrivateBook } from './publish.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') }, [
    '0041_idea_discussion', '0042_storage_connections', '0043_storage_backend', '0044_storage_s3',
    '0046_book_reviews', '0048_content_files', '0055_activity_events',
  ])
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
      const buffer = files.get(key)
      if (!buffer) throw new Error(`missing blob: ${key}`)
      return Readable.from(range ? buffer.subarray(range.start, range.end + 1) : buffer)
    },
    async delete(key) { files.delete(key) },
    async exists(key) { return files.has(key) },
    async size(key) { return files.get(key)?.length ?? 0 },
  }
  return { driver, files }
}

describe('publish private book snapshot', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let adminId: string
  let memberId: string
  let outsiderId: string
  let sharedLibraryId: string

  function seedUser(username: string) {
    const id = createId('user')
    db.insert(schema.users).values({ id, username, passwordHash: null, role: 'member', createdAt: 1 }).run()
    db.insert(schema.libraries).values({
      id: createId('lib'), userId: id, type: 'private', name: username,
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  const txtFile = (body: string, name = 'novel.txt') => new File([body], name, { type: 'text/plain' })

  beforeEach(async () => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(createMemoryStorage().driver)
    registerParser(new TxtParser())
    ownerId = seedUser('owner')
    adminId = seedUser('admin')
    memberId = seedUser('member')
    outsiderId = seedUser('outsider')
    sharedLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: sharedLibraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    await addMember(ownerId, sharedLibraryId, { userId: adminId, role: 'admin' })
    await addMember(ownerId, sharedLibraryId, { userId: memberId, role: 'member' })
  })

  async function privateBook(userId: string, body = '第一章\n正文内容') {
    return uploadBook(userId, txtFile(body))
  }

  it('allows the owner and admin to publish independent snapshots', async () => {
    const ownerBook = await privateBook(ownerId, '第一章\n馆主内容')
    const adminBook = await privateBook(adminId, '第一章\n管理员内容')

    const ownerResult = await publishPrivateBook(ownerId, sharedLibraryId, { bookId: ownerBook.book.id })
    const adminResult = await publishPrivateBook(adminId, sharedLibraryId, { bookId: adminBook.book.id })

    expect(ownerResult.duplicated).toBe(false)
    expect(adminResult.duplicated).toBe(false)
    expect(ownerResult.bookVersionId).not.toBe(ownerBook.book.id)
    expect(adminResult.bookVersionId).not.toBe(adminBook.book.id)

    const sourceRevision = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, ownerBook.book.id)).get()!
    const targetRevision = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, ownerResult.bookVersionId)).get()!
    expect(targetRevision).toMatchObject({ blobKey: sourceRevision.blobKey, revisionNo: 1 })
    const publicationEvents = db.select().from(schema.activityEvents)
      .where(eq(schema.activityEvents.libraryId, sharedLibraryId)).all()
      .filter((event) => event.eventType === 'work.added')
      .sort((a, b) => a.actorUserId!.localeCompare(b.actorUserId!))
    expect(publicationEvents.map((event) => [event.actorUserId, event.workId, event.versionId])).toEqual([
      [adminId, adminResult.libraryBookId, adminResult.bookVersionId],
      [ownerId, ownerResult.libraryBookId, ownerResult.bookVersionId],
    ].sort((a, b) => a[0].localeCompare(b[0])))
    expect(targetRevision.meta).toMatchObject({ coverPaletteKey: ownerBook.book.id })
    expect(db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.id, ownerResult.versionLinkId)).get())
      .toMatchObject({ kind: 'personal', sourceLibraryId: null, sourceLibraryBookVersionId: null })
    expect(db.select().from(schema.bookStates)
      .where(eq(schema.bookStates.bookVersionId, ownerResult.bookVersionId)).all()).toHaveLength(0)
  })

  it('records first catalog publication and only genuinely new versions for the publisher', async () => {
    const first = await uploadCatalogBook(sharedLibraryId, ownerId, txtFile('第一章\n甲'), {
      title: 'Catalog work', operationId: 'upload-batch-1',
    })
    const second = await uploadCatalogBook(sharedLibraryId, adminId, txtFile('第一章\n乙'), {
      libraryBookId: first.libraryBookId, operationId: 'upload-batch-1',
    })
    const duplicate = await uploadCatalogBook(sharedLibraryId, ownerId, txtFile('第一章\n甲'), {
      title: 'Catalog work', operationId: 'upload-batch-1',
    })

    expect(duplicate.duplicated).toBe(true)
    const events = db.select().from(schema.activityEvents)
      .where(eq(schema.activityEvents.libraryId, sharedLibraryId)).all()
      .filter((event) => event.operationId === 'upload-batch-1')
      .sort((a, b) => a.eventType.localeCompare(b.eventType))
    expect(events.map((event) => [event.eventType, event.actorUserId, event.targetId, event.versionId])).toEqual([
      ['work.added', ownerId, first.libraryBookId, first.bookVersionId],
      ['version.added', adminId, second.versionLinkId, second.bookVersionId],
    ].sort((a, b) => a[0].localeCompare(b[0])))
  })

  it('rolls back catalog publication when the activity event cannot be written', async () => {
    db.run(sql.raw(`CREATE TRIGGER reject_catalog_activity BEFORE INSERT ON activity_events
      BEGIN SELECT RAISE(ABORT, 'activity write rejected'); END`))

    await expect(uploadCatalogBook(sharedLibraryId, ownerId, txtFile('第一章\n回滚'), { title: 'Rejected' }))
      .rejects.toThrow()
    expect(db.select().from(schema.libraryBooks).all()).toHaveLength(0)
    expect(db.select().from(schema.bookVersions).all()).toHaveLength(0)
    expect(db.select().from(schema.activityEvents)
      .where(eq(schema.activityEvents.libraryId, sharedLibraryId)).all()).toHaveLength(0)
  })

  it('records the publish-time source base on the city link', async () => {
    const source = await privateBook(ownerId, '第一章\n馆主内容')
    const result = await publishPrivateBook(ownerId, sharedLibraryId, { bookId: source.book.id })
    const sourceRevision = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, source.book.id)).get()!
    expect(db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.id, result.versionLinkId)).get())
      .toMatchObject({ sourceBaseVersionId: source.book.id, sourceBaseRevisionId: sourceRevision.id })
  })

  it('rejects members, non-members, and private targets', async () => {
    const book = await privateBook(ownerId)
    await expect(publishPrivateBook(memberId, sharedLibraryId, { bookId: book.book.id }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(publishPrivateBook(outsiderId, sharedLibraryId, { bookId: book.book.id }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })

    const privateTarget = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, ownerId), eq(schema.libraries.type, 'private'))).get()!.id
    await expect(publishPrivateBook(ownerId, privateTarget, { bookId: book.book.id }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('publishes only a private A entry', async () => {
    const source = await privateBook(ownerId)
    const otherLibrary = await createLibrary({ userId: ownerId, isGuest: false }, { name: 'Other' })
    await addMember(ownerId, otherLibrary.id, { userId: adminId, role: 'admin' })
    const otherUpload = await uploadCatalogBook(otherLibrary.id, ownerId, txtFile('第一章\n共享内容'))
    await addToPrivateLibrary(adminId, otherLibrary.id, otherUpload.versionLinkId!)
    await expect(publishPrivateBook(adminId, sharedLibraryId, { bookId: otherUpload.bookVersionId }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })

    const sourceLink = db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.bookVersionId, source.book.id)).get()!
    db.update(schema.libraryBooks).set({ deletedAt: Date.now() })
      .where(eq(schema.libraryBooks.id, sourceLink.libraryBookId)).run()
    await expect(publishPrivateBook(ownerId, sharedLibraryId, { bookId: source.book.id }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('validates target categories and tags and returns duplicate publishes', async () => {
    const source = await privateBook(ownerId)
    const categoryId = createId('category')
    const tagId = createId('tag')
    db.insert(schema.libraryCategories).values({
      id: categoryId, libraryId: sharedLibraryId, userId: ownerId, name: '分类', parentId: null,
      sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryTags).values({
      id: tagId, libraryId: sharedLibraryId, userId: ownerId, name: '标签',
      sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()

    await expect(publishPrivateBook(ownerId, sharedLibraryId, { bookId: source.book.id, categoryId: createId('category') }))
      .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
    const first = await publishPrivateBook(ownerId, sharedLibraryId, { bookId: source.book.id, categoryId, tagIds: [tagId] })
    const second = await publishPrivateBook(ownerId, sharedLibraryId, { bookId: source.book.id, categoryId, tagIds: [tagId] })
    expect(second).toEqual({ ...first, duplicated: true })
    expect(db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.libraryId, sharedLibraryId)).all()).toHaveLength(1)
  })

  it('keeps the published snapshot after the private source changes or is deleted', async () => {
    const source = await privateBook(ownerId, '第一章\n原始内容')
    const sourceTitle = source.book.title
    const published = await publishPrivateBook(ownerId, sharedLibraryId, { bookId: source.book.id })
    await updateBook(ownerId, source.book.id, { title: '私库新标题' })
    const targetWork = db.select().from(schema.libraryBooks)
      .where(eq(schema.libraryBooks.id, published.libraryBookId)).get()!
    expect(targetWork.title).toBe(sourceTitle)

    await deleteBook(ownerId, source.book.id)
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, published.bookVersionId)).get()).toBeTruthy()
    expect(db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, published.bookVersionId)).get()).toBeTruthy()
  })
})
