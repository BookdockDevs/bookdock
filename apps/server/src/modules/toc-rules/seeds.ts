import { and, eq, isNull, sql } from 'drizzle-orm'

import type { TocRulePattern } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { settings, tocRules } from '../../db/schema'
import { createId } from '../../lib/id'

/** Settings key that records that a user has been seeded (delete-all sticks). */
const SEEDED_KEY = 'tocRuleSeeded'
const SEED_ORDER_MIGRATED_KEY = 'tocRuleSeedOrderV8'
const RETIRED_FLAT_SEED_KEY = 'toc.zh-flat'
const MIGRATABLE_DEFAULT_ORDERS = [
  ['toc.zh-hierarchy', 'toc.zh-flat', 'toc.numeric', 'toc.en'],
  ['toc.zh-flat', 'toc.zh-hierarchy', 'toc.numeric', 'toc.en'],
  ['toc.zh-hierarchy', 'toc.numeric', 'toc.en'],
]

export interface SeedTocRule {
  seedKey: string
  name: string
  patterns: TocRulePattern[]
}

/**
 * Built-in presets installed once per user on first access. The single-regex
 * patterns are merged into our multi-level presets. The hierarchy preset is
 * first so volume/chapter recognition has priority; the scanner
 * compacts levels that are not observed in the current book.
 */
const DEFAULT_SEED_ORDER = ['toc.zh-hierarchy', 'toc.numeric', 'toc.en']

const ZH_FLAT_NAME = '中文网文（章/回 平铺）'
const LEGACY_ZH_HIERARCHY_NAME = '中文网文（卷·章·节）'
const ZH_HIERARCHY_NAME = '中文网文（卷·章）'
const ZH_VOLUME_REGEX = '^[ \\t　]{0,4}第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}卷.{0,30}$'
const ZH_LEGACY_CHAPTER_REGEX = '^[ \\t　]{0,4}第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}章.{0,30}$'
const ZH_CHAPTER_REGEX = '^[ \\t　]{0,4}(?:序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}(?:章|回(?![合来事去])|话|集(?![合和]))).{0,30}$'
const ZH_SECTION_REGEX = '^[ \\t　]{0,4}第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}节(?!课).{0,30}$'
const ZH_FLAT_REGEX = '^[ \\t　]{0,4}(?:序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}(?:章|回(?![合来事去])|话|集(?![合和]))).{0,30}$'

const ZH_HIERARCHY_WITH_SECTION_PATTERNS: TocRulePattern[] = [
  { level: 1, regex: ZH_VOLUME_REGEX, replacement: null, enabled: true },
  { level: 2, regex: ZH_CHAPTER_REGEX, replacement: null, enabled: true },
  { level: 3, regex: ZH_SECTION_REGEX, replacement: null, enabled: true },
]

const ZH_HIERARCHY_PATTERNS: TocRulePattern[] = ZH_HIERARCHY_WITH_SECTION_PATTERNS.slice(0, 2)

const LEGACY_ZH_HIERARCHY_PATTERNS: TocRulePattern[] = [
  { level: 1, regex: ZH_VOLUME_REGEX, replacement: null, enabled: true },
  { level: 2, regex: ZH_LEGACY_CHAPTER_REGEX, replacement: null, enabled: true },
  { level: 3, regex: ZH_SECTION_REGEX, replacement: null, enabled: true },
]

const LEGACY_ZH_FLAT_PATTERNS: TocRulePattern[] = [
  { level: 1, regex: ZH_FLAT_REGEX, replacement: null, enabled: true },
]

export const SEED_TOC_RULES: SeedTocRule[] = [
  {
    seedKey: 'toc.zh-hierarchy',
    name: ZH_HIERARCHY_NAME,
    patterns: ZH_HIERARCHY_PATTERNS,
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

function hasSamePatterns(actual: unknown, expected: TocRulePattern[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function migrateBuiltInDefinitions(userId: string) {
  const db = getDb()
  const rows = db.select().from(tocRules).where(eq(tocRules.userId, userId)).all()
  const hierarchy = rows.find((row) => row.seedKey === 'toc.zh-hierarchy')
  if (
    hierarchy
    && (hierarchy.name === ZH_HIERARCHY_NAME || hierarchy.name === LEGACY_ZH_HIERARCHY_NAME)
    && (hasSamePatterns(hierarchy.patterns, LEGACY_ZH_HIERARCHY_PATTERNS) || hasSamePatterns(hierarchy.patterns, ZH_HIERARCHY_WITH_SECTION_PATTERNS))
  ) {
    db.update(tocRules)
      .set({ name: ZH_HIERARCHY_NAME, patterns: ZH_HIERARCHY_PATTERNS, updatedAt: Date.now() })
      .where(eq(tocRules.id, hierarchy.id))
      .run()
  }

  for (const row of rows) {
    if (
      row.seedKey === RETIRED_FLAT_SEED_KEY
      && row.name === ZH_FLAT_NAME
      && row.enabled === 1
      && hasSamePatterns(row.patterns, LEGACY_ZH_FLAT_PATTERNS)
    ) {
      db.delete(tocRules).where(eq(tocRules.id, row.id)).run()
    }
  }
}

function migrateLegacyDefaultOrder(userId: string) {
  if (hasSeedOrderMigrated(userId)) return
  const db = getDb()
  const rows = db.select().from(tocRules).where(eq(tocRules.userId, userId)).all()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
  const currentSeedOrder = rows.map((row) => row.seedKey)
  const isPreviousDefault = MIGRATABLE_DEFAULT_ORDERS.some((defaultOrder) =>
    currentSeedOrder.length === defaultOrder.length
      && currentSeedOrder.every((seedKey, index) => seedKey === defaultOrder[index]),
  )

  migrateBuiltInDefinitions(userId)

  if (isPreviousDefault) {
    const activeRows = db.select().from(tocRules).where(eq(tocRules.userId, userId)).all()
    for (const [sortOrder, seedKey] of DEFAULT_SEED_ORDER.entries()) {
      const row = activeRows.find((item) => item.seedKey === seedKey)
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
