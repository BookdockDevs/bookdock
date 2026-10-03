import { and, eq, inArray, sql } from 'drizzle-orm'

import type { TocRuleCreateReq, TocRuleRes, TocRuleUpdateReq } from '@bookdock/shared'
import { describeTransferIssues, normalizeTransferName, tocTransferFileSchema } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { tocRules } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { ensureTocRuleSeeds } from './seeds'

type TocRuleRow = typeof tocRules.$inferSelect

function toRes(row: TocRuleRow): TocRuleRes {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    sortOrder: row.sortOrder,
    patterns: row.patterns,
    builtIn: row.seedKey !== null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function getOwnedRule(userId: string, ruleId: string): TocRuleRow {
  const db = getDb()
  const existing = db.select().from(tocRules).where(eq(tocRules.id, ruleId)).get()
  if (!existing || existing.userId !== userId) throw new AppError('TOC_RULE_NOT_FOUND')
  return existing
}

export function listTocRules(userId: string) {
  ensureTocRuleSeeds(userId)
  const db = getDb()
  const rows = db.select().from(tocRules).where(eq(tocRules.userId, userId))
    .orderBy(tocRules.sortOrder, tocRules.createdAt)
    .all()
  return rows.map(toRes)
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
    createdAt: now,
    updatedAt: now,
  }
  db.insert(tocRules).values(row).run()
  return toRes(row)
}

export function updateTocRule(userId: string, ruleId: string, data: TocRuleUpdateReq) {
  const db = getDb()
  getOwnedRule(userId, ruleId)
  const patch: Partial<TocRuleRow> = { updatedAt: Date.now() }
  if (data.name !== undefined) patch.name = data.name
  if (data.enabled !== undefined) patch.enabled = data.enabled ? 1 : 0
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder
  if (data.patterns !== undefined) {
    patch.patterns = data.patterns.map((p) => ({
      level: p.level,
      regex: p.regex,
      replacement: p.replacement ?? null,
      enabled: p.enabled ?? true,
    }))
  }
  db.update(tocRules).set(patch).where(eq(tocRules.id, ruleId)).run()
  return toRes(db.select().from(tocRules).where(eq(tocRules.id, ruleId)).get()!)
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

/** Reorder the whole rule list: ids in display order become sortOrder 0..n-1. */
export function reorderTocRules(userId: string, ruleIds: string[]) {
  const db = getDb()
  const owned = new Set(db.select({ id: tocRules.id }).from(tocRules).where(eq(tocRules.userId, userId)).all().map((r) => r.id))
  const seen = new Set<string>()
  for (const id of ruleIds) {
    if (!owned.has(id) || seen.has(id)) throw new AppError('TOC_RULE_NOT_FOUND')
    seen.add(id)
  }
  const now = Date.now()
  ruleIds.forEach((id, index) => {
    db.update(tocRules).set({ sortOrder: index, updatedAt: now }).where(eq(tocRules.id, id)).run()
  })
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
    return rows.map(toRes)
  })
}
