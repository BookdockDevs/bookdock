import { eq, sql } from 'drizzle-orm'

import type { AccountRes } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { users } from '../../db/schema'
import { getStorage } from '../../storage'
import { AppError } from '../../middleware/error'
import { invalidateUserCache } from '../../middleware/auth.guard'
import { sha256 } from '../../lib/hash'

const AVATAR_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function avatarStorageKey(key: string): string {
  return `avatars/${key}`
}

function toAccountRes(row: typeof users.$inferSelect): AccountRes {
  return { id: row.id, username: row.username, role: row.role, avatarKey: row.avatarKey }
}

// Blobs are content-hash addressed and can be shared across users; delete the
// physical file only when no user row references the key (same pattern as fonts).
async function deleteBlobIfUnreferenced(key: string) {
  const db = getDb()
  const refs = db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.avatarKey, key))
    .get()
  const storage = getStorage()
  const storageKey = avatarStorageKey(key)
  if ((refs?.count ?? 0) === 0 && (await storage.exists(storageKey))) {
    await storage.delete(storageKey)
  }
}

export async function uploadAvatar(userId: string, file: File): Promise<AccountRes> {
  const ext = AVATAR_MIME_TYPES[file.type]
  if (!ext) {
    throw new AppError('UNSUPPORTED_FORMAT', `Unsupported avatar type: ${file.type || file.name}`)
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const hash = sha256(buffer)
  const key = `${hash.slice(0, 2)}/${hash}.${ext}`

  const storage = getStorage()
  const storageKey = avatarStorageKey(key)
  if (!(await storage.exists(storageKey))) {
    await storage.put(storageKey, buffer)
  }

  const db = getDb()
  const old = db.select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, userId)).get()
  if (!old) throw new AppError('USER_NOT_FOUND')
  if (old.avatarKey !== key) {
    db.update(users).set({ avatarKey: key, updatedAt: Date.now() }).where(eq(users.id, userId)).run()
    invalidateUserCache(userId)
    if (old.avatarKey) await deleteBlobIfUnreferenced(old.avatarKey)
  }
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row) throw new AppError('USER_NOT_FOUND')
  return toAccountRes(row)
}

export async function deleteAvatar(userId: string): Promise<void> {
  const db = getDb()
  const row = db.select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, userId)).get()
  if (!row) throw new AppError('USER_NOT_FOUND')
  if (!row.avatarKey) return
  db.update(users).set({ avatarKey: null, updatedAt: Date.now() }).where(eq(users.id, userId)).run()
  invalidateUserCache(userId)
  await deleteBlobIfUnreferenced(row.avatarKey)
}
