import { and, desc, eq } from 'drizzle-orm'

import type {
  CreateStorageConnectionReq,
  StorageConnectionRes,
  StorageProviderType,
  TestDirectStorageConnectionReq,
  TestStorageConnectionReq,
  UpdateStorageConnectionReq,
  WebDavEntry,
  WebDavImportItemResult,
  WebDavImportReq,
  WebDavImportRes,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { settings, storageConnections } from '../../db/schema'
import { createId } from '../../lib/id'
import { WebDavClient } from '../../lib/webdav'
import { AppError } from '../../middleware/error'
import { resetStorage } from '../../storage'
import { assertUserUploadAllowed, getInstanceSettings } from '../auth/auth.service'
import { uploadBook, uploadCatalogBook } from '../books/books.service'
import { isTitleNormalizeEnabled } from '../settings/settings.service'
import { decryptPassword, encryptPassword } from './webdav.service'

function maybeMigrateLegacyWebDav(userId: string): void {
  const db = getDb()
  const existingRows = db
    .select({ id: storageConnections.id })
    .from(storageConnections)
    .where(eq(storageConnections.userId, userId))
    .all()

  if (existingRows.length > 0) return

  const legacySetting = db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, 'webdav')))
    .get()

  if (!legacySetting || !legacySetting.value) return

  const val = legacySetting.value as {
    url?: string
    username?: string
    encryptedPassword?: string
    basePath?: string
  }

  if (!val.url || !val.username) return

  const now = Date.now()
  db.insert(storageConnections).values({
    id: createId('storage_conn'),
    userId,
    name: '我的网盘',
    provider: 'webdav',
    endpoint: val.url,
    username: val.username,
    encryptedPassword: val.encryptedPassword,
    basePath: val.basePath || '/',
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  }).run()
}

export function listStorageConnections(userId: string): StorageConnectionRes[] {
  maybeMigrateLegacyWebDav(userId)
  const db = getDb()

  const rows = db
    .select()
    .from(storageConnections)
    .where(eq(storageConnections.userId, userId))
    .orderBy(desc(storageConnections.createdAt))
    .all()

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    provider: row.provider as StorageProviderType,
    endpoint: row.endpoint,
    username: row.username,
    basePath: row.basePath,
    hasSecrets: Boolean(row.encryptedPassword),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export function getStorageConnection(userId: string, id: string): StorageConnectionRes {
  const db = getDb()
  const row = db
    .select()
    .from(storageConnections)
    .where(and(eq(storageConnections.id, id), eq(storageConnections.userId, userId)))
    .get()

  if (!row) {
    throw new AppError('STORAGE_CONNECTION_NOT_FOUND', 'Storage connection not found')
  }

  return {
    id: row.id,
    name: row.name,
    provider: row.provider as StorageProviderType,
    endpoint: row.endpoint,
    username: row.username,
    basePath: row.basePath,
    hasSecrets: Boolean(row.encryptedPassword),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function createStorageConnection(userId: string, req: CreateStorageConnectionReq): StorageConnectionRes {
  const db = getDb()

  const encryptedPassword = req.password && req.password.trim().length > 0
    ? encryptPassword(req.password.trim())
    : undefined

  const now = Date.now()
  const id = createId('storage_conn')

  db.insert(storageConnections).values({
    id,
    userId,
    name: req.name.trim(),
    provider: req.provider || 'webdav',
    endpoint: req.endpoint.trim(),
    username: req.username.trim(),
    encryptedPassword,
    basePath: req.basePath?.trim() || '/',
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  }).run()

  return getStorageConnection(userId, id)
}

export function updateStorageConnection(userId: string, id: string, req: UpdateStorageConnectionReq): StorageConnectionRes {
  const db = getDb()
  const existing = db
    .select()
    .from(storageConnections)
    .where(and(eq(storageConnections.id, id), eq(storageConnections.userId, userId)))
    .get()

  if (!existing) {
    throw new AppError('STORAGE_CONNECTION_NOT_FOUND', 'Storage connection not found')
  }

  let encryptedPassword = existing.encryptedPassword
  if (req.password !== undefined) {
    if (req.password.trim().length > 0) {
      encryptedPassword = encryptPassword(req.password.trim())
    } else {
      encryptedPassword = null
    }
  }

  db.update(storageConnections)
    .set({
      name: req.name !== undefined ? req.name.trim() : existing.name,
      endpoint: req.endpoint !== undefined ? req.endpoint.trim() : existing.endpoint,
      username: req.username !== undefined ? req.username.trim() : existing.username,
      encryptedPassword,
      basePath: req.basePath !== undefined ? req.basePath.trim() || '/' : existing.basePath,
      updatedAt: Date.now(),
    })
    .where(and(eq(storageConnections.id, id), eq(storageConnections.userId, userId)))
    .run()

  // The tiered driver caches the WebDAV client built from this row;
  // drop the cache so the next read picks up the new endpoint/credentials.
  resetStorage()

  return getStorageConnection(userId, id)
}

export function deleteStorageConnection(userId: string, id: string): void {
  const db = getDb()
  const existing = db
    .select()
    .from(storageConnections)
    .where(and(eq(storageConnections.id, id), eq(storageConnections.userId, userId)))
    .get()

  if (!existing) {
    throw new AppError('STORAGE_CONNECTION_NOT_FOUND', 'Storage connection not found')
  }

  db.delete(storageConnections)
    .where(and(eq(storageConnections.id, id), eq(storageConnections.userId, userId)))
    .run()

  // Drop the cached driver so a deleted backend connection stops being used.
  resetStorage()
}

function getWebDavClientForConnection(userId: string, id: string, override?: TestStorageConnectionReq): WebDavClient {
  const db = getDb()
  const row = db
    .select()
    .from(storageConnections)
    .where(and(eq(storageConnections.id, id), eq(storageConnections.userId, userId)))
    .get()

  if (!row) {
    throw new AppError('STORAGE_CONNECTION_NOT_FOUND', 'Storage connection not found')
  }

  const endpoint = (override?.endpoint !== undefined ? override.endpoint.trim() : row.endpoint) || ''
  const username = (override?.username !== undefined ? override.username.trim() : row.username) || ''
  const basePath = (override?.basePath !== undefined ? override.basePath.trim() : row.basePath) || '/'

  let password = ''
  if (override?.password !== undefined) {
    password = override.password
  } else if (row.encryptedPassword) {
    password = decryptPassword(row.encryptedPassword) || ''
  }

  return new WebDavClient({
    url: endpoint,
    username,
    password,
    basePath: basePath || '/',
  })
}

export async function testDirectStorageConnection(req: TestDirectStorageConnectionReq): Promise<{ success: boolean; latencyMs: number }> {
  const client = new WebDavClient({
    url: req.endpoint.trim(),
    username: req.username.trim(),
    password: req.password || '',
    basePath: req.basePath?.trim() || '/',
  })
  return await client.testConnection()
}

export async function testStorageConnection(
  userId: string,
  id: string,
  override?: TestStorageConnectionReq,
): Promise<{ success: boolean; latencyMs: number }> {
  const client = getWebDavClientForConnection(userId, id, override)
  return await client.testConnection()
}

export async function listStorageConnectionFiles(userId: string, id: string, path = '/'): Promise<WebDavEntry[]> {
  const client = getWebDavClientForConnection(userId, id)
  const instance = getInstanceSettings()
  return await client.list(path, instance.uploadMaxBytes)
}

export async function importStorageConnectionBooks(
  userId: string,
  id: string,
  req: WebDavImportReq,
): Promise<WebDavImportRes> {
  assertUserUploadAllowed(userId)

  const client = getWebDavClientForConnection(userId, id)
  const instance = getInstanceSettings()
  const normalizeTitle = isTitleNormalizeEnabled(userId)
  const results: WebDavImportItemResult[] = []

  for (const filePath of req.files) {
    const rawName = filePath.split('/').filter(Boolean).pop() || 'book'
    const lowerName = rawName.toLowerCase()

    if (!lowerName.endsWith('.epub') && !lowerName.endsWith('.txt')) {
      results.push({
        path: filePath,
        name: rawName,
        status: 'error',
        errorMessage: 'Unsupported format (only .epub and .txt are supported)',
      })
      continue
    }

    try {
      const downloaded = await client.download(filePath)

      if (instance.uploadMaxBytes && downloaded.size > instance.uploadMaxBytes) {
        results.push({
          path: filePath,
          name: downloaded.name,
          status: 'error',
          errorMessage: 'File size exceeds maximum upload limit',
        })
        continue
      }

      const mimeType = downloaded.name.toLowerCase().endsWith('.epub') ? 'application/epub+zip' : 'text/plain'
      const file = new File([new Uint8Array(downloaded.buffer)], downloaded.name, { type: mimeType })

      if (req.libraryId) {
        const catalogRes = await uploadCatalogBook(req.libraryId, userId, file, {
          categoryId: req.shelfId,
          tagIds: req.tagIds,
          normalizeTitle,
        })
        results.push({
          path: filePath,
          name: downloaded.name,
          status: catalogRes.duplicated ? 'duplicate' : 'success',
          bookId: catalogRes.bookVersionId,
        })
      } else {
        const uploadRes = await uploadBook(
          userId,
          file,
          { shelfId: req.shelfId, tagIds: req.tagIds },
          { normalizeTitle, allowCorresponding: true },
        )
        results.push({
          path: filePath,
          name: downloaded.name,
          status: uploadRes.duplicated ? 'duplicate' : 'success',
          bookId: uploadRes.book.id,
          correspondingBookId: uploadRes.corresponding?.id,
        })
      }
    } catch (err) {
      results.push({
        path: filePath,
        name: rawName,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const successCount = results.filter((r) => r.status === 'success').length
  const duplicateCount = results.filter((r) => r.status === 'duplicate').length
  const errorCount = results.filter((r) => r.status === 'error').length

  return {
    results,
    total: results.length,
    successCount,
    duplicateCount,
    errorCount,
  }
}
