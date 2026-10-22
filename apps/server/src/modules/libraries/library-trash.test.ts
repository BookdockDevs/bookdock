import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirementIncluding as migrate } from '../../db/migration-stage'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { uploadCatalogBook } from '../books/books.service'
import { updateLibrary } from './libraries.service'
import { resolveSharedVersionRead } from './library-access'
import {
  deleteCatalogBook,
  deleteCatalogVersion,
  emptyLibraryTrash,
  listCatalogBooks,
  permanentDeleteCatalogBook,
  purgeLibraryTrashIfNeeded,
  restoreCatalogBook,
} from './catalog.service'

function txtFile(name: string, text: string) {
  return new File([text], name, { type: 'text/plain' })
}

describe('shared library trash', () => {
  let db: ReturnType<typeof drizzle<typeof schema>>
  let raw: Database.Database
  let ownerId: string
  let adminId: string
  let memberId: string
  let libraryId: string

  beforeEach(() => {
    raw = new Database(':memory:')
    db = drizzle(raw, { schema })
    const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url))
    migrate(db, { migrationsFolder }, ['0041_idea_discussion', '0042_storage_connections', '0043_storage_backend', '0044_storage_s3', '0046_book_reviews', '0048_content_files', '0055_activity_events'])
    vi.spyOn(client, 'getDb').mockReturnValue(db as never)
    const files = new Map<string, Buffer>()
    const driver: StorageDriver = {
      put: async (key, data) => { files.set(key, Buffer.isBuffer(data) ? data : Buffer.from('x')) },
      get: async () => { throw new Error('missing') },
      delete: async (key) => { files.delete(key) },
      exists: async (key) => files.has(key),
      size: async (key) => files.get(key)?.length ?? 0,
    }
    vi.spyOn(storage, 'getStorage').mockReturnValue(driver)
    registerParser(new TxtParser())
    const now = 1
    ownerId = createId('u')
    adminId = createId('u')
    memberId = createId('u')
    for (const [id, name] of [[ownerId, 'owner'], [adminId, 'admin'], [memberId, 'member']] as const) {
      db.insert(schema.users).values({ id, username: name, role: 'member', createdAt: now, updatedAt: now }).run()
    }
    libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'private', createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.libraryMemberships).values([
      { id: createId('m'), libraryId, userId: adminId, role: 'admin', createdAt: now, updatedAt: now },
      { id: createId('m'), libraryId, userId: memberId, role: 'member', createdAt: now, updatedAt: now },
    ]).run()
  })

  it('soft-deletes on manager delete; only the owner opens the trash', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: 'A' })
    expect(await deleteCatalogBook(adminId, libraryId, created.libraryBookId)).toMatchObject({ trashed: true })
    expect((await listCatalogBooks(ownerId, libraryId, {})).items).toHaveLength(0)
    await expect(listCatalogBooks(adminId, libraryId, { trash: true })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(listCatalogBooks(memberId, libraryId, { trash: true })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await listCatalogBooks(ownerId, libraryId, { trash: true })).items).toHaveLength(1)
    await expect(resolveSharedVersionRead(libraryId, created.bookVersionId, memberId)).rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    await expect(restoreCatalogBook(adminId, libraryId, created.libraryBookId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await restoreCatalogBook(ownerId, libraryId, created.libraryBookId)
    expect((await listCatalogBooks(memberId, libraryId, {})).items).toHaveLength(1)
    const events = db.select().from(schema.activityEvents)
      .where(eq(schema.activityEvents.workId, created.libraryBookId)).all()
      .sort((a, b) => a.eventType.localeCompare(b.eventType))
    expect(events.map((event) => [event.eventType, event.actorUserId, event.audience])).toEqual([
      ['work.added', ownerId, 'library'],
      ['work.trashed', adminId, 'manager'],
      ['work.restored', ownerId, 'manager'],
    ].sort((a, b) => a[0].localeCompare(b[0])))
  })

  it('owner empties and permanently deletes; admin cannot', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: 'A' })
    await deleteCatalogBook(ownerId, libraryId, created.libraryBookId)
    await expect(permanentDeleteCatalogBook(adminId, libraryId, created.libraryBookId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(emptyLibraryTrash(adminId, libraryId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await emptyLibraryTrash(ownerId, libraryId)).toMatchObject({ count: 1 })
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, created.libraryBookId)).get()).toBeUndefined()
    const deletion = db.select().from(schema.activityEvents)
      .where(eq(schema.activityEvents.targetId, created.libraryBookId)).all()
      .find((event) => event.eventType === 'work.deleted')
    expect(deletion).toMatchObject({ actorUserId: ownerId, audience: 'manager', targetKind: 'work' })
    expect(deletion?.operationId).toBeTruthy()
  })

  it('hard-deletes directly while the switch is off', async () => {
    await updateLibrary(ownerId, libraryId, { trashEnabled: false })
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: 'A' })
    expect(await deleteCatalogBook(adminId, libraryId, created.libraryBookId)).toMatchObject({ trashed: false })
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, created.libraryBookId)).get()).toBeUndefined()
    expect(db.select().from(schema.activityEvents)
      .where(eq(schema.activityEvents.targetId, created.libraryBookId)).all())
      .toEqual(expect.arrayContaining([expect.objectContaining({
        eventType: 'work.deleted', audience: 'manager', actorUserId: adminId,
      })]))
  })

  it('records direct version deletion with its work and acting manager', async () => {
    const first = await uploadCatalogBook(libraryId, ownerId, txtFile('first.txt', '第一章甲'), { title: 'Two versions' })
    await uploadCatalogBook(libraryId, ownerId, txtFile('second.txt', '第一章乙'), { libraryBookId: first.libraryBookId })
    await deleteCatalogVersion(ownerId, libraryId, first.libraryBookId, first.versionLinkId!)

    const event = db.select().from(schema.activityEvents)
      .where(eq(schema.activityEvents.targetId, first.versionLinkId!)).get()
    expect(event).toMatchObject({
      eventType: 'version.deleted', audience: 'manager', actorUserId: ownerId,
      targetKind: 'version', workId: first.libraryBookId, versionId: first.bookVersionId,
    })
  })

  it('records automatic trash purge as a system manager event', async () => {
    db.update(schema.libraries).set({ trashAutoCleanDays: 1 }).where(eq(schema.libraries.id, libraryId)).run()
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('old.txt', '第一章甲'), { title: 'Expired work' })
    await deleteCatalogBook(ownerId, libraryId, created.libraryBookId)
    db.update(schema.libraryBooks)
      .set({ deletedAt: Date.now() - 2 * 24 * 60 * 60 * 1000 })
      .where(eq(schema.libraryBooks.id, created.libraryBookId)).run()

    expect(await purgeLibraryTrashIfNeeded(libraryId)).toBe(1)
    const event = db.select().from(schema.activityEvents)
      .where(eq(schema.activityEvents.targetId, created.libraryBookId)).all()
      .find((row) => row.eventType === 'work.deleted')
    expect(event).toMatchObject({ actorUserId: null, audience: 'manager', targetKind: 'work' })
    expect(event?.operationId).toBeTruthy()
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, created.libraryBookId)).get()).toBeUndefined()
  })
})
