import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '../../db/client'
import { migrateBeforeBookRetirement } from '../../db/migration-stage'
import * as schema from '../../db/schema'
import { WebDavClient } from '../../lib/webdav'
import * as books from '../books/books.service'
import { createStorageConnection, importStorageConnectionBooks } from './storage-connection.service'
import { importWebDavBooks, updateWebDavConfig } from './webdav.service'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations')

describe.each(['webdav', 'connection'] as const)('%s import taxonomy placement', (adapter) => {
  let sqlite: Database.Database
  let connectionId: string

  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    migrateBeforeBookRetirement(db, { migrationsFolder })
    client.retargetBookIdReferences(db)
    migrate(db, { migrationsFolder })
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    db.insert(schema.users).values({ id: 'u1', username: 'user', createdAt: 1 }).run()
    db.insert(schema.instance).values({ id: 'instance', ownerUserId: 'u1', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraries).values([
      { id: 'private', userId: 'u1', type: 'private', name: 'Private', createdAt: 1, updatedAt: 1 },
      { id: 'shared', userId: 'u1', type: 'shared', name: 'Shared', visibility: 'private', createdAt: 1, updatedAt: 1 },
    ]).run()
    vi.spyOn(WebDavClient.prototype, 'download').mockResolvedValue({ buffer: Buffer.from('Synthetic book'), name: 'test.txt', size: 14 })
    vi.spyOn(books, 'uploadCatalogBook').mockResolvedValue({ bookVersionId: 'version', duplicated: false })
    vi.spyOn(books, 'uploadBook').mockResolvedValue({ book: { id: 'version' }, duplicated: false } as Awaited<ReturnType<typeof books.uploadBook>>)
    updateWebDavConfig('u1', { url: 'https://example.invalid', username: 'fixture', basePath: '/' })
    connectionId = createStorageConnection('u1', { provider: 'webdav', name: 'Fixture', endpoint: 'https://example.invalid', username: 'fixture', basePath: '/' }).id
  })

  afterEach(() => { vi.restoreAllMocks(); sqlite.close() })

  async function importBook(placement: { libraryId?: string; shelfId?: string; categoryId?: string }) {
    const request = { files: ['/test.txt'], ...placement }
    const result = adapter === 'webdav'
      ? await importWebDavBooks('u1', request)
      : await importStorageConnectionBooks('u1', connectionId, request)
    expect(result.results[0].status).toBe('success')
  }

  it('keeps private shelf and category independent with or without an explicit private library', async () => {
    await importBook({ libraryId: 'private', shelfId: 'shelf', categoryId: 'category' })
    expect(books.uploadCatalogBook).toHaveBeenCalledWith('private', 'u1', expect.any(File), expect.objectContaining({ shelfId: 'shelf', categoryId: 'category' }))
    await importBook({ shelfId: 'shelf', categoryId: 'category' })
    expect(books.uploadBook).toHaveBeenCalledWith('u1', expect.any(File), expect.objectContaining({ shelfId: 'shelf', categoryId: 'category' }), expect.any(Object))
  })

  it('keeps the legacy shared shelf parameter as category placement and accepts the explicit category field', async () => {
    await importBook({ libraryId: 'shared', shelfId: 'old-category' })
    expect(books.uploadCatalogBook).toHaveBeenLastCalledWith('shared', 'u1', expect.any(File), expect.objectContaining({ categoryId: 'old-category' }))
    await importBook({ libraryId: 'shared', shelfId: 'old-category', categoryId: 'category' })
    const options = vi.mocked(books.uploadCatalogBook).mock.calls.at(-1)![3]
    expect(options).toMatchObject({ categoryId: 'category' })
    expect(options).not.toHaveProperty('shelfId')
  })
})
