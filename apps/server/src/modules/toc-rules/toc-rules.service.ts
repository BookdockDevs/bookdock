import { eq, sql } from 'drizzle-orm'

import type { TocRuleCreateReq, TocRuleRes, TocRuleUpdateReq } from '@bookdock/shared'

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
