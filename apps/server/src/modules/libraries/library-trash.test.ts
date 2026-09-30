import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
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
  emptyLibraryTrash,
  listCatalogBooks,
  permanentDeleteCatalogBook,
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
    migrate(db, { migrationsFolder })
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
  })

  it('owner empties and permanently deletes; admin cannot', async () => {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: 'A' })
    await deleteCatalogBook(ownerId, libraryId, created.libraryBookId)
    await expect(permanentDeleteCatalogBook(adminId, libraryId, created.libraryBookId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(emptyLibraryTrash(adminId, libraryId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await emptyLibraryTrash(ownerId, libraryId)).toMatchObject({ count: 1 })
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, created.libraryBookId)).get()).toBeUndefined()
  })

  it('hard-deletes directly while the switch is off', async () => {
    await updateLibrary(ownerId, libraryId, { trashEnabled: false })
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('a.txt', '甲'), { title: 'A' })
    expect(await deleteCatalogBook(adminId, libraryId, created.libraryBookId)).toMatchObject({ trashed: false })
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, created.libraryBookId)).get()).toBeUndefined()
  })
})
