import { and, eq } from 'drizzle-orm'

import type { TocRulePattern } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { settings, tocRules } from '../../db/schema'
import { createId } from '../../lib/id'

/** Settings key that records that a user has been seeded (delete-all sticks). */
const SEEDED_KEY = 'tocRuleSeeded'

export interface SeedTocRule {
  name: string
  patterns: TocRulePattern[]
}

/**
 * Built-in presets installed once per user on first access. Ported from
 * legado's assets/defaultData/txtTocRule.json (single-regex rules merged into
 * our multi-level presets). sortOrder 0 is the flat preset so that the common
 * web-novel shape (第X章 only) wins ties over the nested preset; 卷·章·节
 * competes on volume/section headers, which push its count above the flat one.
 */
export const SEED_TOC_RULES: SeedTocRule[] = [
  {
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
]

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

function insertSeeds(userId: string) {
  const db = getDb()
  const now = Date.now()
  const rows = SEED_TOC_RULES.map((seed, index) => ({
    id: createId('tocr'),
    userId,
    name: seed.name,
    enabled: 1,
    sortOrder: index,
    patterns: seed.patterns,
    createdAt: now,
    updatedAt: now,
  }))
  db.insert(tocRules).values(rows).run()
}

function seedIfEmpty(userId: string) {
  const db = getDb()
  const hasRules = db.select({ id: tocRules.id }).from(tocRules).where(eq(tocRules.userId, userId)).get()
  if (!hasRules) insertSeeds(userId)
  markSeeded(userId)
}

/** Seed once per user on first access. Delete-all afterwards stays empty. */
export function ensureTocRuleSeeds(userId: string) {
  if (hasSeeded(userId)) return
  seedIfEmpty(userId)
}

/** Re-import the presets for a user who deleted all of them (POST /seed). */
export function restoreTocRuleSeeds(userId: string) {
  seedIfEmpty(userId)
}