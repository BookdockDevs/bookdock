import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import type { InstanceThemeItemKind, InstanceThemeLibraryRes, ThemeAssetRes } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { instanceThemeItems, themeAssets } from '../../db/schema'
import { sha256 } from '../../lib/hash'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'

const MAX_THEME_ASSET_BYTES = 10 * 1024 * 1024

const MIME_TO_EXT: Record<'image/png' | 'image/jpeg' | 'image/webp', string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

type ThemeAssetMime = keyof typeof MIME_TO_EXT

export function themeAssetKey(hash: string, mime: ThemeAssetMime): string {
  return `theme-assets/${hash.slice(0, 2)}/${hash}.${MIME_TO_EXT[mime]}`
}

function toAssetRes(row: typeof themeAssets.$inferSelect): ThemeAssetRes {
  return {
    assetId: row.assetId,
    fileName: row.fileName,
    mime: row.mime,
    size: row.size,
    width: row.width,
    height: row.height,
    contentHash: row.contentHash,
    scope: row.scope,
    createdAt: row.createdAt,
  }
}

function detectImageMime(buffer: Buffer, declaredType: string): ThemeAssetMime | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (declaredType === 'image/png' || declaredType === 'image/jpeg' || declaredType === 'image/webp') {
    return declaredType
  }
  return null
}

export async function uploadThemeAsset(
  userId: string,
  input: { assetId: string; file: File; width?: number; height?: number },
): Promise<ThemeAssetRes> {
  if (!input.assetId || input.assetId.length > 120) {
    throw new AppError('VALIDATION_ERROR', 'Invalid asset id')
  }
  if (input.file.size <= 0) {
    throw new AppError('VALIDATION_ERROR', 'Empty theme asset')
  }
  if (input.file.size > MAX_THEME_ASSET_BYTES) {
    throw new AppError('UPLOAD_TOO_LARGE', 'Theme asset exceeds 10 MB limit')
  }
  const buffer = Buffer.from(await input.file.arrayBuffer())
  const mime = detectImageMime(buffer, input.file.type)
  if (!mime) {
    throw new AppError('UNSUPPORTED_FORMAT', 'Unsupported theme asset image format')
  }
  const contentHash = sha256(buffer)
  const key = themeAssetKey(contentHash, mime)
  const storage = getStorage()
  if (!(await storage.exists(key))) {
    await storage.put(key, buffer)
  }

  const db = getDb()
  const existing = db
    .select()
    .from(themeAssets)
    .where(and(eq(themeAssets.userId, userId), eq(themeAssets.assetId, input.assetId)))
    .get()

  const now = Date.now()
  if (existing) {
    db.update(themeAssets)
      .set({
        fileName: input.file.name || existing.fileName,
        mime,
        contentHash,
        size: buffer.length,
        width: input.width ?? existing.width,
        height: input.height ?? existing.height,
      })
      .where(eq(themeAssets.id, existing.id))
      .run()
    const updated = db.select().from(themeAssets).where(eq(themeAssets.id, existing.id)).get()!
    return toAssetRes(updated)
  }

  const row: typeof themeAssets.$inferInsert = {
    id: createId('tasset'),
    userId,
    assetId: input.assetId,
    scope: 'user',
    fileName: input.file.name || `${input.assetId}.${MIME_TO_EXT[mime]}`,
    mime,
    contentHash,
    size: buffer.length,
    width: input.width ?? 0,
    height: input.height ?? 0,
    createdAt: now,
  }
  db.insert(themeAssets).values(row).run()
  return toAssetRes(row as typeof themeAssets.$inferSelect)
}

export function getThemeAssetFile(userId: string | null, assetId: string) {
  const db = getDb()
  if (userId) {
    const own = db
      .select()
      .from(themeAssets)
      .where(and(eq(themeAssets.userId, userId), eq(themeAssets.assetId, assetId)))
      .get()
    if (own) return { row: own, key: themeAssetKey(own.contentHash, own.mime) }
  }
  const shared = db
    .select()
    .from(themeAssets)
    .where(and(eq(themeAssets.assetId, assetId), eq(themeAssets.scope, 'instance')))
    .get()
  if (!shared) {
    throw new AppError('THEME_ASSET_NOT_FOUND', 'Theme asset not found')
  }
  return { row: shared, key: themeAssetKey(shared.contentHash, shared.mime) }
}

export async function deleteThemeAsset(userId: string, assetId: string): Promise<void> {
  const db = getDb()
  const row = db
    .select()
    .from(themeAssets)
    .where(and(eq(themeAssets.userId, userId), eq(themeAssets.assetId, assetId)))
    .get()
  if (!row) return
  db.delete(themeAssets).where(eq(themeAssets.id, row.id)).run()
  const refs = db
    .select({ count: sql<number>`count(*)` })
    .from(themeAssets)
    .where(eq(themeAssets.contentHash, row.contentHash))
    .get()
  const storage = getStorage()
  const key = themeAssetKey(row.contentHash, row.mime)
  if ((refs?.count ?? 0) === 0 && (await storage.exists(key))) {
    await storage.delete(key)
  }
}

export function getInstanceThemeLibrary(): InstanceThemeLibraryRes {
  const db = getDb()
  const rows = db.select().from(instanceThemeItems).orderBy(asc(instanceThemeItems.createdAt)).all()
  const result: InstanceThemeLibraryRes = { palettes: [], css: [], highlights: [], themes: [] }
  for (const row of rows) {
    if (row.kind === 'palette') result.palettes.push(row.payload)
    else if (row.kind === 'css') result.css.push(row.payload)
    else if (row.kind === 'highlight') result.highlights.push(row.payload)
    else if (row.kind === 'theme') result.themes.push(row.payload)
  }
  return result
}

function collectReferencedAssetIds(rows: (typeof instanceThemeItems.$inferSelect)[]): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    const payload = row.payload
    if (row.kind === 'palette' && typeof payload.wallpaperAssetId === 'string' && payload.wallpaperAssetId) {
      ids.add(payload.wallpaperAssetId)
    }
    if (row.kind === 'css' && Array.isArray(payload.assets)) {
      for (const asset of payload.assets) {
        if (asset && typeof asset === 'object' && typeof (asset as { id?: unknown }).id === 'string') {
          ids.add((asset as { id: string }).id)
        }
      }
    }
  }
  return ids
}

export function publishInstanceThemeItems(
  ownerUserId: string,
  userRole: string,
  input: {
    items: { kind: InstanceThemeItemKind; itemId: string; payload: Record<string, unknown> }[]
    assetIds?: string[]
  },
): InstanceThemeLibraryRes {
  if (userRole !== 'owner') {
    throw new AppError('FORBIDDEN', 'Owner only')
  }
  const db = getDb()
  const now = Date.now()
  db.transaction((tx) => {
    for (const item of input.items) {
      const existing = tx
        .select()
        .from(instanceThemeItems)
        .where(and(eq(instanceThemeItems.kind, item.kind), eq(instanceThemeItems.itemId, item.itemId)))
        .get()
      if (existing) {
        tx.update(instanceThemeItems)
          .set({ payload: item.payload, updatedAt: now })
          .where(eq(instanceThemeItems.id, existing.id))
          .run()
      } else {
        tx.insert(instanceThemeItems)
          .values({
            id: createId('ithm'),
            kind: item.kind,
            itemId: item.itemId,
            ownerUserId,
            payload: item.payload,
            createdAt: now,
            updatedAt: now,
          })
          .run()
      }
    }

    const allRows = tx.select().from(instanceThemeItems).all()
    const referencedAssetIds = collectReferencedAssetIds(allRows)
    for (const id of input.assetIds ?? []) referencedAssetIds.add(id)
    if (referencedAssetIds.size > 0) {
      tx.update(themeAssets)
        .set({ scope: 'instance' })
        .where(and(eq(themeAssets.userId, ownerUserId), inArray(themeAssets.assetId, Array.from(referencedAssetIds))))
        .run()
    }
  })
  return getInstanceThemeLibrary()
}

export function removeInstanceThemeItem(
  userRole: string,
  kind: InstanceThemeItemKind,
  itemId: string,
): InstanceThemeLibraryRes {
  if (userRole !== 'owner') {
    throw new AppError('FORBIDDEN', 'Owner only')
  }
  const db = getDb()
  db.transaction((tx) => {
    const deleted = tx
      .delete(instanceThemeItems)
      .where(and(eq(instanceThemeItems.kind, kind), eq(instanceThemeItems.itemId, itemId)))
      .run()
    if (deleted.changes === 0) {
      throw new AppError('THEME_ITEM_NOT_FOUND', 'Instance theme item not found')
    }
    const remaining = tx.select().from(instanceThemeItems).all()
    const referencedAssetIds = collectReferencedAssetIds(remaining)
    const sharedAssets = tx.select().from(themeAssets).where(eq(themeAssets.scope, 'instance')).all()
    const unreferencedIds = sharedAssets
      .filter((asset) => !referencedAssetIds.has(asset.assetId))
      .map((asset) => asset.id)
    if (unreferencedIds.length > 0) {
      tx.update(themeAssets).set({ scope: 'user' }).where(inArray(themeAssets.id, unreferencedIds)).run()
    }
  })
  return getInstanceThemeLibrary()
}
