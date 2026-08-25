import { and, eq, isNull, or } from 'drizzle-orm'

import type { TextTransformRes, TransformCreateReq, TransformOverrideReq, TransformUpdateReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { books, textTransformOverrides, textTransforms } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'

type TransformRow = typeof textTransforms.$inferSelect
type OverrideRow = typeof textTransformOverrides.$inferSelect

// override undefined = no book context (plain list); null = book context without an override row
function toRes(row: TransformRow, override?: OverrideRow | null): TextTransformRes {
  const res: TextTransformRes = {
    id: row.id,
    bookId: row.bookId,
    scope: row.bookId ? 'book' : 'global',
    matchType: row.matchType,
    pattern: row.pattern,
    replacement: row.replacement,
    isRegex: row.isRegex === 1,
    caseSensitive: row.caseSensitive === 1,
    enabled: row.enabled === 1,
    name: row.name,
    group: row.group,
    spineHref: row.spineHref,
    textOffset: row.textOffset,
    originalText: row.originalText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
  if (override !== undefined) {
    res.effectiveEnabled = override ? override.enabled === 1 : row.enabled === 1
    res.hasOverride = override !== null
  }
  return res
}

function assertValidRegex(pattern: string) {
  try {
    new RegExp(pattern)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'pattern is not a valid regular expression')
  }
}

function getOwnedTransform(userId: string, transformId: string): TransformRow {
  const db = getDb()
  const existing = db.select().from(textTransforms).where(eq(textTransforms.id, transformId)).get()
  if (!existing || existing.userId !== userId) throw new AppError('TRANSFORM_NOT_FOUND')
  return existing
}

export async function listTransforms(userId: string, bookId?: string) {
  const db = getDb()
  if (!bookId) {
    const rows = await db.select().from(textTransforms).where(eq(textTransforms.userId, userId)).all()
    return rows.map((row) => toRes(row))
  }
  // Book view: user-global pattern rules (per-book state comes from overrides)
  // plus everything scoped to this book (book-scoped patterns, point patches)
  const rows = await db.select().from(textTransforms).where(
    and(
      eq(textTransforms.userId, userId),
      or(
        and(eq(textTransforms.matchType, 'pattern'), isNull(textTransforms.bookId)),
        eq(textTransforms.bookId, bookId),
      ),
    ),
  ).all()
  const overrides = await db.select().from(textTransformOverrides).where(
    and(eq(textTransformOverrides.userId, userId), eq(textTransformOverrides.bookId, bookId)),
  ).all()
  const overrideByTransform = new Map(overrides.map((o) => [o.transformId, o]))
  return rows.map((row) =>
    toRes(row, row.matchType === 'pattern' && row.bookId === null
      ? overrideByTransform.get(row.id) ?? null
      : null),
  )
}

export async function createTransform(userId: string, data: TransformCreateReq) {
  const db = getDb()
  const matchType = data.matchType ?? 'pattern'
  if (matchType === 'point' && !data.bookId) {
    throw new AppError('VALIDATION_ERROR', 'bookId is required for point transforms')
  }
  // Null bookId = user-global pattern rule; set = book-scoped pattern or point patch
  const bookId = data.bookId ?? null
  if (bookId) {
    const book = db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
    if (!book) throw new AppError('BOOK_NOT_FOUND')
  }
  const now = Date.now()
  const row: TransformRow = {
    id: createId('transform'),
    userId,
    bookId,
    matchType,
    pattern: data.pattern ?? null,
    replacement: data.replacement ?? null,
    isRegex: data.isRegex ? 1 : 0,
    caseSensitive: data.caseSensitive ? 1 : 0,
    enabled: data.enabled === false ? 0 : 1,
    name: data.name ?? null,
    group: data.group ?? null,
    spineHref: data.spineHref ?? null,
    textOffset: data.textOffset ?? null,
    originalText: data.originalText ?? null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(textTransforms).values(row).run()
  return toRes(row)
}

export async function updateTransform(userId: string, transformId: string, data: TransformUpdateReq) {
  const db = getDb()
  const existing = getOwnedTransform(userId, transformId)
  if (data.matchType === 'point') {
    // Point patches need anchor information only a text selection provides;
    // converting a rule into one would have no idea which spot to fix
    throw new AppError('VALIDATION_ERROR', 'point transforms must be created from a text selection')
  }
  const mergedIsRegex = data.isRegex ?? existing.isRegex === 1
  const mergedPattern = data.pattern ?? existing.pattern
  if (mergedIsRegex && mergedPattern) assertValidRegex(mergedPattern)
  const patch: Partial<TransformRow> = { updatedAt: Date.now() }
  if (data.matchType === 'pattern' && existing.matchType === 'point') {
    // point → pattern: the snapshot becomes the pattern, anchors are meaningless
    patch.matchType = 'pattern'
    patch.spineHref = null
    patch.textOffset = null
    patch.originalText = null
  }
  if (data.bookId !== undefined) {
    if (data.bookId !== null) {
      const book = db.select({ id: books.id }).from(books).where(and(eq(books.id, data.bookId), eq(books.userId, userId))).get()
      if (!book) throw new AppError('BOOK_NOT_FOUND')
    }
    patch.bookId = data.bookId
  }
  if (data.name !== undefined) patch.name = data.name
  if (data.group !== undefined) patch.group = data.group
  if (data.pattern !== undefined) patch.pattern = data.pattern
  if (data.replacement !== undefined) patch.replacement = data.replacement
  if (data.isRegex !== undefined) patch.isRegex = data.isRegex ? 1 : 0
  if (data.caseSensitive !== undefined) patch.caseSensitive = data.caseSensitive ? 1 : 0
  if (data.enabled !== undefined) patch.enabled = data.enabled ? 1 : 0
  if (data.originalText !== undefined) patch.originalText = data.originalText
  db.update(textTransforms).set(patch).where(eq(textTransforms.id, transformId)).run()
  return toRes(db.select().from(textTransforms).where(eq(textTransforms.id, transformId)).get()!)
}

export async function deleteTransform(userId: string, transformId: string) {
  const db = getDb()
  getOwnedTransform(userId, transformId)
  db.delete(textTransforms).where(eq(textTransforms.id, transformId)).run()
}

export async function setTransformOverride(userId: string, transformId: string, data: TransformOverrideReq) {
  const db = getDb()
  const existing = getOwnedTransform(userId, transformId)
  // Overrides only layer on user-global pattern rules: point patches are
  // single-book, book-scoped patterns already are — both toggle their own
  // enabled switch instead.
  if (existing.matchType === 'point' || existing.bookId) {
    throw new AppError('VALIDATION_ERROR', 'per-book overrides only apply to global pattern rules')
  }
  const book = db.select({ id: books.id }).from(books).where(and(eq(books.id, data.bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')

  if (data.enabled === null) {
    db.delete(textTransformOverrides).where(
      and(eq(textTransformOverrides.bookId, data.bookId), eq(textTransformOverrides.transformId, transformId)),
    ).run()
    return toRes(existing, null)
  }

  const now = Date.now()
  db.insert(textTransformOverrides).values({
    id: createId('tfo'),
    userId,
    bookId: data.bookId,
    transformId,
    enabled: data.enabled ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [textTransformOverrides.bookId, textTransformOverrides.transformId],
    set: { enabled: data.enabled ? 1 : 0, updatedAt: now },
  }).run()
  const override = db.select().from(textTransformOverrides).where(
    and(eq(textTransformOverrides.bookId, data.bookId), eq(textTransformOverrides.transformId, transformId)),
  ).get()!
  return toRes(existing, override)
}
