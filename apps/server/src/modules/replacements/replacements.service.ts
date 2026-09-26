import { and, eq, isNull, or } from 'drizzle-orm'

import { compileReplacementRegex, type TextReplacementRes, type ReplacementCreateReq, type ReplacementOverrideReq, type ReplacementUpdateReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { books, bookVersions, libraries, libraryBookVersions, textReplacementOverrides, textReplacements } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'

function assertBookAccessible(userId: string, bookId: string) {
  const db = getDb()
  const legacy = db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (legacy) return
  // Version-native books have no legacy row: existence is the private library.
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  const version = library && db.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.bookVersionId, bookId))).get()
  if (!version) throw new AppError('BOOK_NOT_FOUND')
}

type ReplacementRow = typeof textReplacements.$inferSelect
type ReplacementOverrideRow = typeof textReplacementOverrides.$inferSelect

// override undefined = no book context (plain list); null = book context without an override row
function toRes(row: ReplacementRow, override?: ReplacementOverrideRow | null): TextReplacementRes {
  const res: TextReplacementRes = {
    id: row.id,
    bookId: row.bookId,
    scope: row.bookId ? 'book' : 'global',
    matchType: row.matchType,
    pattern: row.pattern,
    replacement: row.replacement,
    isRegex: row.isRegex === 1,
    applyTo: row.applyTo as TextReplacementRes['applyTo'],
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
    compileReplacementRegex(pattern)
  } catch {
    throw new AppError('VALIDATION_ERROR', 'pattern is not a valid regular expression')
  }
}

function getOwnedReplacement(userId: string, replacementId: string): ReplacementRow {
  const db = getDb()
  const existing = db.select().from(textReplacements).where(eq(textReplacements.id, replacementId)).get()
  if (!existing || existing.userId !== userId) throw new AppError('REPLACEMENT_NOT_FOUND')
  return existing
}

export async function listReplacements(userId: string, bookId?: string) {
  const db = getDb()
  if (!bookId) {
    const rows = await db.select().from(textReplacements).where(eq(textReplacements.userId, userId)).all()
    return rows.map((row) => toRes(row))
  }
  // Book view: user-global pattern rules (per-book state comes from overrides)
  // plus everything scoped to this book (book-scoped patterns, point patches)
  const rows = await db.select().from(textReplacements).where(
    and(
      eq(textReplacements.userId, userId),
      or(
        and(eq(textReplacements.matchType, 'pattern'), isNull(textReplacements.bookId)),
        eq(textReplacements.bookId, bookId),
      ),
    ),
  ).all()
  const overrides = await db.select().from(textReplacementOverrides).where(
    and(eq(textReplacementOverrides.userId, userId), eq(textReplacementOverrides.bookId, bookId)),
  ).all()
  const overrideByReplacement = new Map(overrides.map((o) => [o.replacementId, o]))
  return rows.map((row) =>
    toRes(row, row.matchType === 'pattern' && row.bookId === null
      ? overrideByReplacement.get(row.id) ?? null
      : null),
  )
}

export async function createReplacement(userId: string, data: ReplacementCreateReq) {
  const db = getDb()
  const matchType = data.matchType ?? 'pattern'
  if (matchType === 'point' && !data.bookId) {
    throw new AppError('VALIDATION_ERROR', 'bookId is required for point replacements')
  }
  if (matchType === 'point' && data.applyTo && data.applyTo !== 'content') {
    throw new AppError('VALIDATION_ERROR', 'point replacements only apply to content')
  }
  // Null bookId = user-global pattern rule; set = book-scoped pattern or point patch
  const bookId = data.bookId ?? null
  if (bookId) {
    assertBookAccessible(userId, bookId)
  }
  const now = Date.now()
  const version = bookId
    ? db.select({ id: bookVersions.id }).from(bookVersions).where(eq(bookVersions.id, bookId)).get()
    : null
  const row: ReplacementRow = {
    id: createId('replacement'),
    userId,
    bookId,
    // Scoped rules bind the version when the book already migrated (0.3:
    // version id reuses book id); compat-window writes stay unbound.
    bookVersionId: version?.id ?? null,
    matchType,
    pattern: data.pattern ?? null,
    replacement: data.replacement ?? null,
    isRegex: data.isRegex ? 1 : 0,
    applyTo: matchType === 'point' ? 'content' : (data.applyTo ?? 'content'),
    enabled: data.enabled === false ? 0 : 1,
    name: data.name ?? null,
    group: data.group ?? null,
    spineHref: data.spineHref ?? null,
    textOffset: data.textOffset ?? null,
    originalText: data.originalText ?? null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(textReplacements).values(row).run()
  return toRes(row)
}

export async function updateReplacement(userId: string, replacementId: string, data: ReplacementUpdateReq) {
  const db = getDb()
  const existing = getOwnedReplacement(userId, replacementId)
  if (data.matchType === 'point') {
    // Point patches need anchor information only a text selection provides;
    // converting a rule into one would have no idea which spot to fix
    throw new AppError('VALIDATION_ERROR', 'point replacements must be created from a text selection')
  }
  const mergedIsRegex = data.isRegex ?? existing.isRegex === 1
  const mergedPattern = data.pattern ?? existing.pattern
  const mergedMatchType = data.matchType ?? existing.matchType
  if (mergedMatchType === 'point' && data.applyTo && data.applyTo !== 'content') {
    throw new AppError('VALIDATION_ERROR', 'point replacements only apply to content')
  }
  if (mergedIsRegex && mergedPattern) assertValidRegex(mergedPattern)
  const patch: Partial<ReplacementRow> = { updatedAt: Date.now() }
  if (data.matchType === 'pattern' && existing.matchType === 'point') {
    // point → pattern: the snapshot becomes the pattern, anchors are meaningless
    patch.matchType = 'pattern'
    patch.spineHref = null
    patch.textOffset = null
    patch.originalText = null
  }
  if (data.bookId !== undefined) {
    if (data.bookId !== null) {
      assertBookAccessible(userId, data.bookId)
    }
    patch.bookId = data.bookId
  }
  if (data.name !== undefined) patch.name = data.name
  if (data.group !== undefined) patch.group = data.group
  if (data.pattern !== undefined) patch.pattern = data.pattern
  if (data.replacement !== undefined) patch.replacement = data.replacement
  if (data.isRegex !== undefined) patch.isRegex = data.isRegex ? 1 : 0
  if (data.applyTo !== undefined) patch.applyTo = data.applyTo
  if (data.enabled !== undefined) patch.enabled = data.enabled ? 1 : 0
  if (data.originalText !== undefined) patch.originalText = data.originalText
  db.update(textReplacements).set(patch).where(eq(textReplacements.id, replacementId)).run()
  return toRes(db.select().from(textReplacements).where(eq(textReplacements.id, replacementId)).get()!)
}

export async function deleteReplacement(userId: string, replacementId: string) {
  const db = getDb()
  getOwnedReplacement(userId, replacementId)
  db.delete(textReplacements).where(eq(textReplacements.id, replacementId)).run()
}

export async function setReplacementOverride(userId: string, replacementId: string, data: ReplacementOverrideReq) {
  const db = getDb()
  const existing = getOwnedReplacement(userId, replacementId)
  // Overrides only layer on user-global pattern rules: point patches are
  // single-book, book-scoped patterns already are — both toggle their own
  // enabled switch instead.
  if (existing.matchType === 'point' || existing.bookId) {
    throw new AppError('VALIDATION_ERROR', 'per-book overrides only apply to global pattern rules')
  }
  assertBookAccessible(userId, data.bookId)

  if (data.enabled === null) {
    db.delete(textReplacementOverrides).where(
      and(eq(textReplacementOverrides.bookId, data.bookId), eq(textReplacementOverrides.replacementId, replacementId)),
    ).run()
    return toRes(existing, null)
  }

  const now = Date.now()
  db.insert(textReplacementOverrides).values({
    id: createId('rpo'),
    userId,
    bookId: data.bookId,
    replacementId,
    enabled: data.enabled ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [textReplacementOverrides.bookId, textReplacementOverrides.replacementId],
    set: { enabled: data.enabled ? 1 : 0, updatedAt: now },
  }).run()
  const override = db.select().from(textReplacementOverrides).where(
    and(eq(textReplacementOverrides.bookId, data.bookId), eq(textReplacementOverrides.replacementId, replacementId)),
  ).get()!
  return toRes(existing, override)
}
