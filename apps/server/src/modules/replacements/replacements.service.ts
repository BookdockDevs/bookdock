import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { compileReplacementRegex, describeTransferIssues, normalizeTransferName, replacementTransferFileSchema, type TextReplacementRes, type ReplacementCreateReq, type ReplacementOverrideReq, type ReplacementUpdateReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookVersions, textReplacementOverrides, textReplacements } from '../../db/schema'
import { createId } from '../../lib/id'
import { loadReplacementOverrides, loadReplacementRows, orderReplacementRows, REPLACEMENT_PREFERENCE_KEY, resolveReplacementEnabled } from '../../lib/replacement-effective'
import { isCompleteIdSet, patchResourcePreference } from '../../lib/resource-preferences'
import { AppError } from '../../middleware/error'
import { assertReadableBook } from '../books/books.service'

type ReplacementRow = typeof textReplacements.$inferSelect
type ReplacementOverrideRow = typeof textReplacementOverrides.$inferSelect

// override undefined = no book context (plain list); null = book context without an override row
function toRes(userId: string, row: ReplacementRow, override?: ReplacementOverrideRow | null): TextReplacementRes {
  const accountEnabled = resolveReplacementEnabled(userId, row)
  const res: TextReplacementRes = {
    id: row.id,
    bookId: row.bookId,
    scope: row.bookId ? 'book' : 'global',
    matchType: row.matchType,
    pattern: row.pattern,
    replacement: row.replacement,
    isRegex: row.isRegex === 1,
    applyTo: row.applyTo as TextReplacementRes['applyTo'],
    enabled: accountEnabled,
    name: row.name,
    group: row.group,
    spineHref: row.spineHref,
    textOffset: row.textOffset,
    originalText: row.originalText,
    ...(row.matchType === 'point' && row.relocation === 'unresolved' ? { locationAvailable: false } : {}),
    sortOrder: row.sortOrder,
    availability: row.availability,
    mine: row.userId === userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
  if (override !== undefined) {
    res.effectiveEnabled = override ? override.enabled === 1 : accountEnabled
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
  if (!bookId) {
    const rows = orderReplacementRows(userId, loadReplacementRows(userId))
    return rows.map((row) => toRes(userId, row))
  }
  await assertReadableBook(userId, bookId)
  // Book view: the caller's own global and book-scoped rules plus readable
  // shared global rules; per-book state comes from the caller's own overrides.
  const rows = orderReplacementRows(userId, loadReplacementRows(userId, bookId))
  const overrideByReplacement = loadReplacementOverrides(userId, bookId)
  return rows.map((row) =>
    toRes(userId, row, row.matchType === 'pattern' && row.bookId === null
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
    await assertReadableBook(userId, bookId)
  }
  const now = Date.now()
  const version = bookId
    ? db.select({ id: bookVersions.id }).from(bookVersions).where(eq(bookVersions.id, bookId)).get()
    : null
  const maxOrder = db.select({ max: sql<number>`max(${textReplacements.sortOrder})` }).from(textReplacements)
    .where(eq(textReplacements.userId, userId)).get()?.max ?? -1
  // Only a user-global pattern rule can be published; book-bound patterns and
  // point patches are inherently personal.
  const availability = bookId === null && matchType === 'pattern' ? (data.availability ?? 'user') : 'user'
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
    sortOrder: maxOrder + 1,
    spineHref: data.spineHref ?? null,
    textOffset: data.textOffset ?? null,
    originalText: data.originalText ?? null,
    relocation: 'ok',
    availability,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(textReplacements).values(row).run()
  return toRes(userId, row)
}

/** Batch import a transfer file: global pattern rules only, appended disabled. */
export async function importReplacements(userId: string, file: unknown) {
  const parsed = replacementTransferFileSchema.safeParse(file)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid import file', { issues: describeTransferIssues(parsed.error) })
  }
  if (parsed.data.rules.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No importable rules')
  }
  const db = getDb()
  const maxOrder = db.select({ max: sql<number>`max(${textReplacements.sortOrder})` }).from(textReplacements)
    .where(eq(textReplacements.userId, userId)).get()?.max ?? -1
  const now = Date.now()
  const rows: ReplacementRow[] = parsed.data.rules.map((rule, index) => ({
    id: createId('replacement'),
    userId,
    bookId: null,
    bookVersionId: null,
    matchType: 'pattern' as const,
    pattern: rule.pattern,
    replacement: rule.replacement ?? null,
    isRegex: rule.isRegex ? 1 : 0,
    applyTo: rule.applyTo ?? 'content',
    enabled: 0,
    name: rule.name ?? null,
    group: rule.group ?? null,
    sortOrder: maxOrder + 1 + index,
    spineHref: null,
    textOffset: null,
    originalText: null,
    relocation: 'ok',
    availability: 'user' as const,
    createdAt: now + index,
    updatedAt: now + index,
  }))

  return db.transaction((tx) => {
    const existingNames = new Set(
      tx.select({ name: textReplacements.name }).from(textReplacements).where(and(
        eq(textReplacements.userId, userId),
        eq(textReplacements.matchType, 'pattern'),
        isNull(textReplacements.bookId),
      )).all()
        .map((row) => normalizeTransferName(row.name))
        .filter((key) => key.length > 0),
    )
    const seen = new Set<string>()
    parsed.data.rules.forEach((rule, index) => {
      if (rule.name !== undefined && rule.name !== null && rule.name.length > 200) {
        throw new AppError('VALIDATION_ERROR', 'Invalid import file', {
          issues: [{ ruleIndex: index, field: 'name', message: 'Name is too long' }],
        })
      }
      const key = normalizeTransferName(rule.name)
      if (!key) return
      if (seen.has(key)) {
        throw new AppError('VALIDATION_ERROR', 'Duplicate rule name in import file', {
          issues: [{ ruleIndex: index, field: 'name', message: 'Duplicate rule name in import file' }],
        })
      }
      seen.add(key)
      if (existingNames.has(key)) {
        throw new AppError('VALIDATION_ERROR', 'Rule name already exists', {
          issues: [{ ruleIndex: index, field: 'name', message: 'Rule name already exists' }],
        })
      }
    })
    tx.insert(textReplacements).values(rows).run()
    return rows.map((row) => toRes(userId, row))
  })
}

/** A rule the caller may read but not edit: instance-published global pattern. */
function getAccessibleSharedReplacement(userId: string, replacementId: string): ReplacementRow {
  const row = getDb().select().from(textReplacements).where(eq(textReplacements.id, replacementId)).get()
  if (!row || row.userId === userId || row.availability !== 'instance' || row.matchType !== 'pattern' || row.bookId) {
    throw new AppError('REPLACEMENT_NOT_FOUND')
  }
  return row
}

export async function updateReplacement(userId: string, replacementId: string, data: ReplacementUpdateReq) {
  const db = getDb()
  const owned = db.select().from(textReplacements).where(eq(textReplacements.id, replacementId)).get()
  if (owned && owned.userId !== userId) {
    // Consumers may only flip their own personal switch. Editing patterns,
    // publication or book binding stays with the publisher.
    getAccessibleSharedReplacement(userId, replacementId)
    if (Object.keys(data).some((key) => key !== 'enabled') || data.enabled === undefined) {
      throw new AppError('FORBIDDEN', 'Only the publisher can edit a shared rule')
    }
    patchResourcePreference(userId, REPLACEMENT_PREFERENCE_KEY, { enabled: { [replacementId]: data.enabled } })
    return toRes(userId, owned, null)
  }
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
      await assertReadableBook(userId, data.bookId)
    }
    patch.bookId = data.bookId
  }
  if (data.name !== undefined) patch.name = data.name
  if (data.group !== undefined) patch.group = data.group
  if (data.pattern !== undefined) patch.pattern = data.pattern
  if (data.replacement !== undefined) patch.replacement = data.replacement
  if (data.isRegex !== undefined) patch.isRegex = data.isRegex ? 1 : 0
  if (data.applyTo !== undefined) patch.applyTo = data.applyTo
  if (data.enabled !== undefined) {
    patch.enabled = data.enabled ? 1 : 0
    patchResourcePreference(userId, REPLACEMENT_PREFERENCE_KEY, { enabled: { [replacementId]: data.enabled } })
  }
  if (data.originalText !== undefined) patch.originalText = data.originalText
  const nextBookId = patch.bookId === undefined ? existing.bookId : patch.bookId
  if (data.availability !== undefined) {
    const eligible = nextBookId === null && (patch.matchType ?? existing.matchType) === 'pattern'
    if (!eligible) throw new AppError('VALIDATION_ERROR', 'Only global pattern rules can be published')
    patch.availability = data.availability
  }
  if (patch.availability === undefined && data.availability === undefined) {
    // Unpublish when a published rule stops being a global pattern rule.
    if ((patch.matchType ?? existing.matchType) !== 'pattern' || nextBookId !== null) patch.availability = 'user'
  }
  db.update(textReplacements).set(patch).where(eq(textReplacements.id, replacementId)).run()
  return toRes(userId, db.select().from(textReplacements).where(eq(textReplacements.id, replacementId)).get()!)
}

export async function deleteReplacement(userId: string, replacementId: string) {
  const db = getDb()
  const existing = getOwnedReplacement(userId, replacementId)
  if (existing.bookId) await assertReadableBook(userId, existing.bookId)
  db.delete(textReplacements).where(eq(textReplacements.id, replacementId)).run()
}

export function deleteGlobalReplacements(userId: string, ruleIds: string[]) {
  const db = getDb()
  db.transaction((tx) => {
    const targets = tx.select({ id: textReplacements.id }).from(textReplacements)
      .where(and(eq(textReplacements.userId, userId), isNull(textReplacements.bookId),
        eq(textReplacements.matchType, 'pattern'), inArray(textReplacements.id, ruleIds))).all()
    if (ruleIds.length === 0 || targets.length !== ruleIds.length) throw new AppError('REPLACEMENT_NOT_FOUND')
    tx.delete(textReplacements).where(and(eq(textReplacements.userId, userId), inArray(textReplacements.id, ruleIds))).run()
  })
}

/**
 * Reorder the caller's whole visible settings list. Only the personal order
 * changes: the definition row keeps its own sortOrder, so another account's
 * layout is untouched. The payload must be exactly the set the settings page
 * shows — every global pattern rule the caller can run — because a partial list
 * would leave the missing ids on a layout the client never displayed. Book
 * rules are not part of that set: the saved order permutes the global slots it
 * names and leaves book-scoped rules where they run.
 */
export function reorderReplacements(userId: string, replacementIds: string[]) {
  const rows = loadReplacementRows(userId)
  const accessibleIds = rows
    .filter((row) => row.matchType === 'pattern' && row.bookId === null)
    .map((row) => row.id)
  if (!isCompleteIdSet(replacementIds, accessibleIds)) throw new AppError('REPLACEMENT_NOT_FOUND')
  patchResourcePreference(userId, REPLACEMENT_PREFERENCE_KEY, { order: replacementIds })
  return orderReplacementRows(userId, rows).map((row) => toRes(userId, row))
}

export async function setReplacementOverride(userId: string, replacementId: string, data: ReplacementOverrideReq) {
  const db = getDb()
  const row = db.select().from(textReplacements).where(eq(textReplacements.id, replacementId)).get()
  if (!row) throw new AppError('REPLACEMENT_NOT_FOUND')
  // Overrides only layer on global pattern rules the caller can run: point
  // patches are single-book and book-scoped patterns already are — both toggle
  // their own enabled switch instead.
  if (row.matchType === 'point' || row.bookId) {
    throw new AppError('VALIDATION_ERROR', 'per-book overrides only apply to global pattern rules')
  }
  if (row.userId !== userId && row.availability !== 'instance') throw new AppError('REPLACEMENT_NOT_FOUND')
  await assertReadableBook(userId, data.bookId)

  if (data.enabled === null) {
    db.delete(textReplacementOverrides).where(
      and(
        eq(textReplacementOverrides.userId, userId),
        eq(textReplacementOverrides.bookId, data.bookId),
        eq(textReplacementOverrides.replacementId, replacementId),
      ),
    ).run()
    return toRes(userId, row, null)
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
    target: [textReplacementOverrides.userId, textReplacementOverrides.bookId, textReplacementOverrides.replacementId],
    set: { enabled: data.enabled ? 1 : 0, updatedAt: now },
  }).run()
  const override = db.select().from(textReplacementOverrides).where(
    and(
      eq(textReplacementOverrides.userId, userId),
      eq(textReplacementOverrides.bookId, data.bookId),
      eq(textReplacementOverrides.replacementId, replacementId),
    ),
  ).get()!
  return toRes(userId, row, override)
}
