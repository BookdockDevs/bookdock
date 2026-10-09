import crypto from 'node:crypto'
import { and, eq } from 'drizzle-orm'

import type {
  WebDavConfig,
  WebDavConfigRes,
  WebDavConfigUpdateReq,
  WebDavEntry,
  WebDavImportItemResult,
  WebDavImportReq,
  WebDavImportRes,
  WebDavTestReq,
} from '@bookdock/shared'

import { config } from '../../config'
import { getDb } from '../../db/client'
import { settings } from '../../db/schema'
import { createId } from '../../lib/id'
import { WebDavClient } from '../../lib/webdav'
import { AppError } from '../../middleware/error'
import { assertUserUploadAllowed, getInstanceSettings } from '../auth/auth.service'
import { uploadBook, uploadCatalogBook } from '../books/books.service'
import { isTitleNormalizeEnabled } from '../settings/settings.service'

const WEBDAV_SETTINGS_KEY = 'webdav'

function encryptionKey() {
  return crypto.createHash('sha256').update(config.jwtSecret).digest()
}

export function encryptPassword(password: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

export function decryptPassword(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.')
    if (!ivEncoded || !tagEncoded || !ciphertextEncoded) return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    return plain
  } catch {
    return null
  }
}

function getStoredConfig(userId: string): WebDavConfig | null {
  const db = getDb()
  const row = db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, WEBDAV_SETTINGS_KEY)))
    .get()
  return row ? (row.value as WebDavConfig) : null
}

function saveStoredConfig(userId: string, value: WebDavConfig): void {
  const db = getDb()
  const existing = db
    .select()
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, WEBDAV_SETTINGS_KEY)))
    .get()

  if (existing) {
    db.update(settings).set({ value }).where(eq(settings.id, existing.id)).run()
  } else {
    db.insert(settings).values({
      id: createId('setting'),
      userId,
      key: WEBDAV_SETTINGS_KEY,
      value,
    }).run()
  }
}

export function getWebDavConfig(userId: string): WebDavConfigRes {
  const stored = getStoredConfig(userId)
  return {
    configured: Boolean(stored?.url && stored?.username),
    url: stored?.url || '',
    username: stored?.username || '',
    basePath: stored?.basePath || '/',
    hasPassword: Boolean(stored?.encryptedPassword),
  }
}

export function updateWebDavConfig(userId: string, patch: WebDavConfigUpdateReq): WebDavConfigRes {
  const existing = getStoredConfig(userId)

  let encryptedPassword = existing?.encryptedPassword
  if (patch.password !== undefined) {
    if (patch.password.trim().length > 0) {
      encryptedPassword = encryptPassword(patch.password)
    } else {
      encryptedPassword = undefined
    }
  }

  const updated: WebDavConfig = {
    url: patch.url.trim(),
    username: patch.username.trim(),
    encryptedPassword,
    basePath: patch.basePath !== undefined ? patch.basePath.trim() || '/' : (existing?.basePath || '/'),
  }

  saveStoredConfig(userId, updated)
  return getWebDavConfig(userId)
}

export function deleteWebDavConfig(userId: string): void {
  const db = getDb()
  db.delete(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, WEBDAV_SETTINGS_KEY)))
    .run()
}

export function getClientForUser(userId: string, override?: WebDavTestReq): WebDavClient {
  const stored = getStoredConfig(userId)
  const url = (override?.url !== undefined ? override.url.trim() : stored?.url) || ''
  const username = (override?.username !== undefined ? override.username.trim() : stored?.username) || ''
  const basePath = (override?.basePath !== undefined ? override.basePath.trim() : stored?.basePath) || '/'

  let password = ''
  if (override?.password !== undefined) {
    password = override.password
  } else if (stored?.encryptedPassword) {
    password = decryptPassword(stored.encryptedPassword) || ''
  }

  if (!url || !username) {
    throw new AppError('WEBDAV_NOT_CONFIGURED', 'WebDAV server URL and username must be configured')
  }

  return new WebDavClient({
    url,
    username,
    password,
    basePath: basePath || '/',
  })
}

export async function testWebDavConnection(userId: string, req?: WebDavTestReq): Promise<{ success: boolean; latencyMs: number }> {
  const client = getClientForUser(userId, req)
  return await client.testConnection()
}

export async function listWebDavFiles(userId: string, path = '/'): Promise<WebDavEntry[]> {
  const client = getClientForUser(userId)
  const instance = getInstanceSettings()
  return await client.list(path, instance.uploadMaxBytes)
}

export async function importWebDavBooks(userId: string, req: WebDavImportReq): Promise<WebDavImportRes> {
  // Hard upload gate
  assertUserUploadAllowed(userId)

  const client = getClientForUser(userId)
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
