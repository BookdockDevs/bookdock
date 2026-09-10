import { and, eq, isNull, sql } from 'drizzle-orm'

import type { TocRulePattern } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { settings, tocRules } from '../../db/schema'
import { createId } from '../../lib/id'

/** Settings key that records that a user has been seeded (delete-all sticks). */
const SEEDED_KEY = 'tocRuleSeeded'
const SEED_ORDER_MIGRATED_KEY = 'tocRuleSeedOrderV4'
const LEGACY_SEED_ORDER = ['toc.zh-flat', 'toc.zh-hierarchy', 'toc.numeric', 'toc.en']

export interface SeedTocRule {
  seedKey: string
  name: string
  patterns: TocRulePattern[]
}

/**
 * Built-in presets installed once per user on first access. The single-regex
 * patterns are merged into our multi-level presets. The volume/chapter/section
 * preset is first because it is the most specific built-in rule.
 */
const DEFAULT_SEED_ORDER = ['toc.zh-hierarchy', 'toc.zh-flat', 'toc.numeric', 'toc.en']

export const SEED_TOC_RULES: SeedTocRule[] = [
  {
    seedKey: 'toc.zh-flat',
    name: '中文网文（章/回 平铺）',
    patterns: [
      {
        level: 1,
        regex: '^[ \\t　]{0,4}(?:序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}(?:章|回(?![合来事去])|话|集(?![合和]))).{0,30}$',
        replacement: null,
        enabled: true,
      },
    ],
  },
  {
    seedKey: 'toc.zh-hierarchy',
    name: '中文网文（卷·章·节）',
    patterns: [
      {
        level: 1,
        regex: '^[ \\t　]{0,4}第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}卷.{0,30}$',
        replacement: null,
        enabled: true,
      },
      {
        level: 2,
        regex: '^[ \\t　]{0,4}第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}章.{0,30}$',
        replacement: null,
        enabled: true,
      },
      {
        level: 3,
        regex: '^[ \\t　]{0,4}第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}节(?!课).{0,30}$',
        replacement: null,
        enabled: true,
      },
    ],
  },
  {
    seedKey: 'toc.en',
    name: 'English Chapter/Section/Part',
    patterns: [
      {
        level: 1,
        regex: '^[ \\t　]{0,4}(?:[Cc]hapter|[Ss]ection|[Pp]art|ＰＡＲＴ|[Nn][oO][.、]|[Ee]pisode)\\s{0,4}\\d{1,4}.{0,30}$',
        replacement: null,
        enabled: true,
      },
    ],
  },
  {
    seedKey: 'toc.numeric',
    name: '数字/大写数字 分隔符 标题',
    patterns: [
      {
        level: 1,
        regex: '^[ \\t　]{0,4}(?:\\d{1,5}[:：,.， 、_—\\-]|[〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]{1,8}章?[ 、_—\\-]).{1,30}$',
        replacement: null,
        enabled: true,
      },
    ],
  },
].sort((a, b) => DEFAULT_SEED_ORDER.indexOf(a.seedKey) - DEFAULT_SEED_ORDER.indexOf(b.seedKey))

function hasSeeded(userId: string): boolean {
  const db = getDb()
  const row = db.select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, SEEDED_KEY))).get()
  return row !== undefined
}

function markSeeded(userId: string) {
  const db = getDb()
  const existing = db.select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, SEEDED_KEY))).get()
  if (existing) {
    db.update(settings).set({ value: 1 }).where(eq(settings.id, existing.id)).run()
  } else {
    db.insert(settings).values({ id: createId('setting'), userId, key: SEEDED_KEY, value: 1 }).run()
  }
}

function hasSeedOrderMigrated(userId: string): boolean {
  const db = getDb()
  const row = db.select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, SEED_ORDER_MIGRATED_KEY))).get()
  return row !== undefined
}

function markSeedOrderMigrated(userId: string) {
  const db = getDb()
  db.insert(settings).values({ id: createId('setting'), userId, key: SEED_ORDER_MIGRATED_KEY, value: 1 }).run()
}

function migrateLegacyDefaultOrder(userId: string) {
  if (hasSeedOrderMigrated(userId)) return
  const db = getDb()
  const rows = db.select().from(tocRules).where(eq(tocRules.userId, userId)).all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
  const currentSeedOrder = rows.map((row) => row.seedKey)
  const isLegacyDefault = currentSeedOrder.length === LEGACY_SEED_ORDER.length
    && currentSeedOrder.every((seedKey, index) => seedKey === LEGACY_SEED_ORDER[index])

  if (isLegacyDefault) {
    for (const [sortOrder, seedKey] of DEFAULT_SEED_ORDER.entries()) {
      const row = rows.find((item) => item.seedKey === seedKey)
      if (row) db.update(tocRules).set({ sortOrder }).where(eq(tocRules.id, row.id)).run()
    }
  }
  markSeedOrderMigrated(userId)
}

function insertSeeds(userId: string, seeds: readonly SeedTocRule[] = SEED_TOC_RULES, startOrder = 0) {
  const db = getDb()
  const now = Date.now()
  const rows = seeds.map((seed, index) => ({
    id: createId('tocr'),
    userId,
    seedKey: seed.seedKey,
    name: seed.name,
    enabled: 1,
    sortOrder: startOrder + index,
    patterns: seed.patterns,
    createdAt: now,
    updatedAt: now,
  }))
  db.insert(tocRules).values(rows).run()
}

function backfillLegacySeedKeys(userId: string) {
  const db = getDb()
  const legacyRows = db.select().from(tocRules)
    .where(and(eq(tocRules.userId, userId), isNull(tocRules.seedKey)))
    .all()

  for (const row of legacyRows) {
    const seed = SEED_TOC_RULES.find((candidate) => candidate.name === row.name && JSON.stringify(candidate.patterns) === JSON.stringify(row.patterns))
    if (seed) db.update(tocRules).set({ seedKey: seed.seedKey }).where(eq(tocRules.id, row.id)).run()
  }
}

function seedIfEmpty(userId: string) {
  const db = getDb()
  const hasRules = db.select({ id: tocRules.id }).from(tocRules).where(eq(tocRules.userId, userId)).get()
  if (!hasRules) insertSeeds(userId)
  markSeeded(userId)
}

/** Seed once per user on first access. Delete-all afterwards stays empty. */
export function ensureTocRuleSeeds(userId: string) {
  backfillLegacySeedKeys(userId)
  if (!hasSeeded(userId)) seedIfEmpty(userId)
  migrateLegacyDefaultOrder(userId)
}

/** Add missing built-in presets without changing any existing user rules. */
export function restoreTocRuleSeeds(userId: string) {
  const db = getDb()
  backfillLegacySeedKeys(userId)
  const existingSeedKeys = new Set(
    db.select({ seedKey: tocRules.seedKey }).from(tocRules).where(eq(tocRules.userId, userId)).all()
      .map((rule) => rule.seedKey)
      .filter((seedKey): seedKey is string => seedKey !== null),
  )
  const missing = SEED_TOC_RULES.filter((seed) => !existingSeedKeys.has(seed.seedKey))
  if (missing.length > 0) {
    const maxOrder = db.select({ max: sql<number>`max(${tocRules.sortOrder})` }).from(tocRules)
      .where(eq(tocRules.userId, userId)).get()?.max ?? -1
    insertSeeds(userId, missing, maxOrder + 1)
  }
  markSeeded(userId)
}
