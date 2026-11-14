import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'

import type { TocRuleCreateReq, TocRuleRes, TocRuleUpdateReq } from '@bookdock/shared'
import { describeTransferIssues, normalizeTransferName, tocTransferFileSchema } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { tocRules } from '../../db/schema'
import { createId } from '../../lib/id'
import { effectiveEnabled, isCompleteIdSet, orderResourceItems, patchResourcePreference, readResourcePreferences } from '../../lib/resource-preferences'
import { AppError } from '../../middleware/error'
import { ensureTocRuleSeeds } from './seeds'

type TocRuleRow = typeof tocRules.$inferSelect

const PREFERENCE_KEY = 'tocRules'

/** Definition + the caller's personal switch, resolved once per list call. */
function toRes(row: TocRuleRow, userId: string, preferences = readResourcePreferences(userId, PREFERENCE_KEY)): TocRuleRes {
  const mine = row.userId === userId
  return {
    id: row.id,
    name: row.name,
    enabled: effectiveEnabled(preferences, row.id, mine, row.enabled === 1),
    sortOrder: row.sortOrder,
    patterns: row.patterns,
    builtIn: row.seedKey !== null,
    mine,
    availability: row.availability,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Every definition the caller can see: own rows plus instance-published rows.
 * A built-in preset is seeded once per account, so another account's copy is
 * never a shared definition — showing it would only duplicate the same preset
 * in the caller's list.
 */
function accessibleRows(userId: string): TocRuleRow[] {
  return getDb().select().from(tocRules).where(
    and(
      or(eq(tocRules.userId, userId), and(ne(tocRules.userId, userId), eq(tocRules.availability, 'instance'))),
      or(eq(tocRules.userId, userId), isNull(tocRules.seedKey)),
    ),
  ).orderBy(tocRules.sortOrder, tocRules.createdAt).all()
}

function getOwnedRule(userId: string, ruleId: string): TocRuleRow {
  const existing = getDb().select().from(tocRules).where(eq(tocRules.id, ruleId)).get()
  if (!existing || existing.userId !== userId) throw new AppError('TOC_RULE_NOT_FOUND')
  return existing
}

export function listTocRules(userId: string) {
  ensureTocRuleSeeds(userId)
  const rows = accessibleRows(userId)
  const preferences = readResourcePreferences(userId, PREFERENCE_KEY)
  const items = rows.map((row) => toRes(row, userId, preferences))
  return orderResourceItems(items, preferences, (item) => item.sortOrder)
}

/**
 * Effective list for chapter detection and every transformation path. Shared
 * rules are opt-in, so only the caller's enabled rules run — and a rule that is
 * no longer accessible never appears here at all.
 */
export function effectiveTocRules(userId: string): TocRuleRes[] {
  return listTocRules(userId).filter((rule) => rule.enabled)
}

/**
 * Resolves one explicitly referenced rule for execution. A rule that exists but
 * is not accessible answers the normal not-found error so a guessed id cannot
 * confirm another account's private rule.
 */
export function getTocRuleForExecution(userId: string, ruleId: string): TocRuleRow | null {
  const row = getDb().select().from(tocRules).where(eq(tocRules.id, ruleId)).get()
  if (!row) return null
  if (row.userId !== userId && (row.availability !== 'instance' || row.seedKey !== null)) return null
  return row
}

export function createTocRule(userId: string, data: TocRuleCreateReq) {
  const db = getDb()
  const now = Date.now()
  const maxOrder = db.select({ max: sql<number>`max(${tocRules.sortOrder})` }).from(tocRules)
    .where(eq(tocRules.userId, userId)).get()?.max ?? -1

  const row: TocRuleRow = {
    id: createId('tocr'),
    userId,
    seedKey: null,
    name: data.name,
    enabled: data.enabled === false ? 0 : 1,
    sortOrder: data.sortOrder ?? maxOrder + 1,
    patterns: data.patterns.map((p) => ({
      level: p.level,
      regex: p.regex,
      replacement: p.replacement ?? null,
      enabled: p.enabled ?? true,
    })),
    availability: data.availability ?? 'user',
    createdAt: now,
    updatedAt: now,
  }
  db.insert(tocRules).values(row).run()
  return toRes(row, userId)
}

export function updateTocRule(userId: string, ruleId: string, data: TocRuleUpdateReq) {
  const db = getDb()
  const existing = db.select().from(tocRules).where(eq(tocRules.id, ruleId)).get()
  if (!existing) throw new AppError('TOC_RULE_NOT_FOUND')
  if (existing.userId !== userId) {
    // A consumer may only flip their own switch; definitions, patterns and
    // publication state stay with the publisher.
    if (existing.availability !== 'instance') throw new AppError('TOC_RULE_NOT_FOUND')
    if (Object.keys(data).some((key) => key !== 'enabled') || data.enabled === undefined) {
      throw new AppError('FORBIDDEN', 'Only the publisher can edit a shared TOC rule')
    }
    patchResourcePreference(userId, PREFERENCE_KEY, { enabled: { [ruleId]: data.enabled } })
    return toRes(existing, userId)
  }
  const patch: Partial<TocRuleRow> = { updatedAt: Date.now() }
  if (data.name !== undefined) patch.name = data.name
  // Definition default only; the caller's own personal switch lives in their
  // preferences so publishing never leaks a private on/off choice.
  if (data.enabled !== undefined) patch.enabled = data.enabled ? 1 : 0
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder
  if (data.availability !== undefined) {
    // Built-in presets belong to one account each: every other account already
    // has the same preset, so publishing one only duplicates it for them.
    if (data.availability === 'instance' && existing.seedKey !== null) {
      throw new AppError('VALIDATION_ERROR', 'Built-in TOC rules cannot be published')
    }
    patch.availability = data.availability
  }
  // A built-in row created before that rule existed falls back to private on
  // its next save, so it cannot stay shared without a control to undo it.
  if (existing.seedKey !== null && existing.availability === 'instance') patch.availability = 'user'
  if (data.patterns !== undefined) {
    patch.patterns = data.patterns.map((p) => ({
      level: p.level,
      regex: p.regex,
      replacement: p.replacement ?? null,
      enabled: p.enabled ?? true,
    }))
  }
  db.transaction((tx) => {
    tx.update(tocRules).set(patch).where(eq(tocRules.id, ruleId)).run()
    if (data.enabled !== undefined) patchResourcePreference(userId, PREFERENCE_KEY, { enabled: { [ruleId]: data.enabled } })
  })
  return toRes(db.select().from(tocRules).where(eq(tocRules.id, ruleId)).get()!, userId)
}

export function deleteTocRule(userId: string, ruleId: string) {
  const db = getDb()
  getOwnedRule(userId, ruleId)
  db.delete(tocRules).where(eq(tocRules.id, ruleId)).run()
}

export function deleteTocRules(userId: string, ruleIds: string[]) {
  const db = getDb()
  db.transaction((tx) => {
    const targets = tx.select({ id: tocRules.id }).from(tocRules)
      .where(and(eq(tocRules.userId, userId), inArray(tocRules.id, ruleIds))).all()
    if (ruleIds.length === 0 || targets.length !== ruleIds.length) throw new AppError('TOC_RULE_NOT_FOUND')
    tx.delete(tocRules).where(and(eq(tocRules.userId, userId), inArray(tocRules.id, ruleIds))).run()
  })
}

/** Reorder the caller's whole visible list; only the personal order changes. */
export function reorderTocRules(userId: string, ruleIds: string[]) {
  const accessibleIds = accessibleRows(userId).map((row) => row.id)
  if (!isCompleteIdSet(ruleIds, accessibleIds)) throw new AppError('TOC_RULE_NOT_FOUND')
  patchResourcePreference(userId, PREFERENCE_KEY, { order: ruleIds })
  return listTocRules(userId)
}

/** Batch import from a transfer file: file order appends at max(sortOrder)+1, all disabled. */
export function importTocRules(userId: string, file: unknown) {
  const parsed = tocTransferFileSchema.safeParse(file)
  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid import file', { issues: describeTransferIssues(parsed.error) })
  }
  if (parsed.data.rules.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No importable rules')
  }
  const db = getDb()
  return db.transaction((tx) => {
    ensureTocRuleSeeds(userId)
    const maxOrder = db.select({ max: sql<number>`max(${tocRules.sortOrder})` }).from(tocRules)
      .where(eq(tocRules.userId, userId)).get()?.max ?? -1
    const now = Date.now()
    const rows: TocRuleRow[] = parsed.data.rules.map((rule, index) => ({
      id: createId('tocr'),
      userId,
      seedKey: null,
      name: rule.name,
      enabled: 0,
      sortOrder: maxOrder + 1 + index,
      patterns: rule.patterns.map((p) => ({
        level: p.level,
        regex: p.regex,
        replacement: p.replacement ?? null,
        enabled: p.enabled ?? true,
      })),
      availability: 'user',
      createdAt: now + index,
      updatedAt: now + index,
    }))

    const existingNames = new Set(
      tx.select({ name: tocRules.name }).from(tocRules).where(eq(tocRules.userId, userId)).all()
        .map((row) => normalizeTransferName(row.name)),
    )
    const seen = new Set<string>()
    parsed.data.rules.forEach((rule, index) => {
      const key = normalizeTransferName(rule.name)
      if (!key) {
        throw new AppError('VALIDATION_ERROR', 'Invalid import file', {
          issues: [{ ruleIndex: index, field: 'name', message: 'Rule name must not be blank' }],
        })
      }
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
    tx.insert(tocRules).values(rows).run()
    return rows.map((row) => toRes(row, userId))
  })
}
