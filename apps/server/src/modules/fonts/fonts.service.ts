import { and, asc, eq, or, sql } from 'drizzle-orm'

import type { FontListItem, FontScope } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { fonts } from '../../db/schema'
import { getStorage } from '../../storage'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { sha256 } from '../../lib/hash'
import { parseFontFamily } from '../../lib/font-name'

const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const
type FontFormat = (typeof FONT_EXTENSIONS)[number]

export function fontKey(hash: string, ext: string): string {
  return `fonts/${hash.slice(0, 2)}/${hash}.${ext}`
}

function toListItem(row: typeof fonts.$inferSelect, userId: string): FontListItem {
  return {
    id: row.id,
    family: row.family,
    fileName: row.fileName,
    format: row.format,
    size: row.size,
    scope: row.scope,
    mine: row.userId === userId,
    createdAt: row.createdAt,
  }
}

export async function listFonts(userId: string): Promise<FontListItem[]> {
  const db = getDb()
  const rows = db
    .select()
    .from(fonts)
    .where(or(eq(fonts.userId, userId), eq(fonts.scope, 'instance')))
    .orderBy(asc(fonts.createdAt))
    .all()
  return rows.map((row) => toListItem(row, userId))
}

export async function uploadFont(userId: string, file: File, scope: FontScope): Promise<FontListItem> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!FONT_EXTENSIONS.includes(ext as FontFormat)) {
    throw new AppError('UNSUPPORTED_FORMAT', `Unsupported font format: ${file.name}`)
  }
  const format = ext as FontFormat
  const buffer = Buffer.from(await file.arrayBuffer())
  const contentHash = sha256(buffer)

  const db = getDb()
  const existing = db
    .select()
    .from(fonts)
    .where(and(eq(fonts.userId, userId), eq(fonts.contentHash, contentHash)))
    .get()
  if (existing) return toListItem(existing, userId)

  const family =
    (format === 'ttf' || format === 'otf' ? parseFontFamily(buffer) : null) ??
    file.name.replace(/\.[^.]+$/, '')

  const key = fontKey(contentHash, format)
  const storage = getStorage()
  // The blob is content-hash addressed and shared across users' font rows
  if (!(await storage.exists(key))) {
    await storage.put(key, buffer)
  }

  const row: typeof fonts.$inferInsert = {
    id: createId('font'),
    userId,
    scope,
    family,
    fileName: file.name,
    format,
    contentHash,
    size: buffer.length,
    createdAt: Date.now(),
  }
  db.insert(fonts).values(row).run()
  return toListItem(row as typeof fonts.$inferSelect, userId)
}

export async function updateFontScope(
  userId: string,
  userRole: string,
  fontId: string,
  scope: FontScope,
): Promise<FontListItem> {
  if (userRole !== 'owner') {
    throw new AppError('FORBIDDEN', 'Owner only')
  }
  const db = getDb()
  const row = db.select().from(fonts).where(eq(fonts.id, fontId)).get()
  if (!row) throw new AppError('FONT_NOT_FOUND')
  db.update(fonts).set({ scope }).where(eq(fonts.id, fontId)).run()
  return toListItem({ ...row, scope }, userId)
}

export async function deleteFont(userId: string, userRole: string, fontId: string): Promise<void> {
  const db = getDb()
  const row = db.select().from(fonts).where(eq(fonts.id, fontId)).get()
  if (!row) throw new AppError('FONT_NOT_FOUND')
  if (row.userId !== userId && userRole !== 'owner') {
    throw new AppError('FORBIDDEN', 'Only the uploader or an owner can delete this font')
  }
  db.delete(fonts).where(eq(fonts.id, fontId)).run()

  // Blobs are content-hash addressed and shared across font rows; delete the
  // physical file only when no other row references it (same pattern as books).
  const refs = db
    .select({ count: sql<number>`count(*)` })
    .from(fonts)
    .where(eq(fonts.contentHash, row.contentHash))
    .get()
  const storage = getStorage()
  const key = fontKey(row.contentHash, row.format)
  if ((refs?.count ?? 0) === 0 && (await storage.exists(key))) {
    await storage.delete(key)
  }
}

export async function getFontFile(userId: string, fontId: string) {
  const db = getDb()
  const row = db.select().from(fonts).where(eq(fonts.id, fontId)).get()
  // Invisible fonts answer 404 like missing ones — no existence leak
  if (!row || (row.userId !== userId && row.scope !== 'instance')) {
    throw new AppError('FONT_NOT_FOUND')
  }
  return row
}
