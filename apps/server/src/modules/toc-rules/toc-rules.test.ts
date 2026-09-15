import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { tocRuleCreateSchema, tocRuleUpdateSchema, tocRuleReorderSchema } from '@bookdock/shared'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { errorHandler } from '../../middleware/error'
import tocRuleRoutes from './toc-rules.routes'
import {
  listTocRules,
  createTocRule,
  updateTocRule,
  deleteTocRule,
  reorderTocRules,
} from './toc-rules.service'
import { restoreTocRuleSeeds, SEED_TOC_RULES } from './seeds'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

describe('toc-rules service', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let otherId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    ownerId = createId('user')
    db.insert(schema.users).values({
      id: ownerId,
      username: 'owner',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()
    otherId = createId('user')
    db.insert(schema.users).values({
      id: otherId,
      username: 'other',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()
  })

  function sampleRule(name = '中文网文') {
    return {
      name,
      patterns: [
        { level: 1, regex: '^第[0-9一二三四五六七八九十百千]+章', replacement: '$1', enabled: true },
        { level: 2, regex: '^第[0-9一二三四五六七八九十百千]+节', replacement: null, enabled: true },
      ],
    }
  }

  it('creates a rule with default enabled/sortOrder and defaults pattern fields', async () => {
    const created = createTocRule(ownerId, sampleRule())
    expect(created.enabled).toBe(true)
    expect(created.sortOrder).toBe(0)
    expect(created.patterns[0]).toMatchObject({
      level: 1,
      replacement: '$1',
      enabled: true,
    })
    expect(created.patterns[1].replacement).toBeNull()

    const items = await listTocRules(ownerId)
    expect(items.some((i) => i.id === created.id)).toBe(true)
  })

  it('assigns incrementing sortOrder across creates', async () => {
    createTocRule(ownerId, sampleRule('a'))
    const second = createTocRule(ownerId, sampleRule('b'))
    const third = createTocRule(ownerId, sampleRule('c'))
    expect(second.sortOrder).toBe(1)
    expect(third.sortOrder).toBe(2)
  })

  it('lists only the owner\'s rules and does not leak other users\'', async () => {
    createTocRule(ownerId, sampleRule('mine'))
    createTocRule(otherId, sampleRule('theirs'))
    const items = await listTocRules(ownerId)
    expect(items.some((i) => i.name === 'mine')).toBe(true)
    expect(items.some((i) => i.name === 'theirs')).toBe(false)
  })

  it('updates fields and normalizes patterns', async () => {
    const created = createTocRule(ownerId, sampleRule())
    const updated = updateTocRule(ownerId, created.id, {
      name: 'renamed',
      enabled: false,
      patterns: [{ level: 1, regex: '^Chapter', replacement: null, enabled: false }],
    })
    expect(updated.name).toBe('renamed')
    expect(updated.enabled).toBe(false)
    expect(updated.patterns).toHaveLength(1)
    expect(updated.patterns[0].replacement).toBeNull()
  })

  it('partial update keeps untouched fields', async () => {
    const created = createTocRule(ownerId, sampleRule())
    const updated = updateTocRule(ownerId, created.id, { name: 'only name' })
    expect(updated.enabled).toBe(true)
    expect(updated.patterns).toHaveLength(2)
  })

  it('rejects update and delete of another user\'s rule with TOC_RULE_NOT_FOUND', async () => {
    const created = createTocRule(ownerId, sampleRule())
    expect(() => updateTocRule(otherId, created.id, { name: 'x' }))
      .toThrowError(expect.objectContaining({ code: 'TOC_RULE_NOT_FOUND' }))
    expect(() => deleteTocRule(otherId, created.id))
      .toThrowError(expect.objectContaining({ code: 'TOC_RULE_NOT_FOUND' }))
    expect((await listTocRules(ownerId)).some((r) => r.id === created.id)).toBe(true)
  })

  it('rejects update and delete of a missing rule with TOC_RULE_NOT_FOUND', async () => {
    expect(() => updateTocRule(ownerId, 'missing-rule', { name: 'x' }))
      .toThrowError(expect.objectContaining({ code: 'TOC_RULE_NOT_FOUND' }))
    expect(() => deleteTocRule(ownerId, 'missing-rule'))
      .toThrowError(expect.objectContaining({ code: 'TOC_RULE_NOT_FOUND' }))
  })

  it('deletes the owner\'s rule', async () => {
    const created = createTocRule(ownerId, sampleRule())
    await deleteTocRule(ownerId, created.id)
    const items = await listTocRules(ownerId)
    expect(items.some((r) => r.id === created.id)).toBe(false)
  })

  it('reorders the whole list and rewrites sortOrder 0..n-1', async () => {
    const a = createTocRule(ownerId, sampleRule('a'))
    const b = createTocRule(ownerId, sampleRule('b'))
    const c = createTocRule(ownerId, sampleRule('c'))

    const reordered = reorderTocRules(ownerId, [c.id, a.id, b.id])
    const mine = reordered.filter((r) => ['a', 'b', 'c'].includes(r.name))
    expect(mine.map((r) => r.name)).toEqual(['c', 'a', 'b'])
    expect(mine.map((r) => r.sortOrder)).toEqual([0, 1, 2])
  })

  it('rejects reorder with a foreign user\'s or unknown rule id', async () => {
    const a = createTocRule(ownerId, sampleRule('a'))
    const b = createTocRule(otherId, sampleRule('b'))
    expect(() => reorderTocRules(ownerId, [a.id, b.id]))
      .toThrowError(expect.objectContaining({ code: 'TOC_RULE_NOT_FOUND' }))
    expect(() => reorderTocRules(ownerId, [a.id, 'missing']))
      .toThrowError(expect.objectContaining({ code: 'TOC_RULE_NOT_FOUND' }))
  })

  it('rejects reorder with a duplicate id', async () => {
    const a = createTocRule(ownerId, sampleRule('a'))
    const b = createTocRule(ownerId, sampleRule('b'))
    expect(() => reorderTocRules(ownerId, [a.id, a.id, b.id]))
      .toThrowError(expect.objectContaining({ code: 'TOC_RULE_NOT_FOUND' }))
  })

  it('seeds the built-in presets on first list, and only once', async () => {
    const first = await listTocRules(ownerId)
    expect(first).toHaveLength(SEED_TOC_RULES.length)
    expect(first.map((r) => r.sortOrder)).toEqual(SEED_TOC_RULES.map((_, i) => i))
    expect(first.every((r) => r.enabled)).toBe(true)
    expect(first.every((r) => r.builtIn)).toBe(true)
    expect(first.map((r) => r.name)).toEqual(SEED_TOC_RULES.map((s) => s.name))
    expect(first[0]?.name).toBe('中文网文（卷·章）')
    expect(await listTocRules(ownerId)).toHaveLength(SEED_TOC_RULES.length)
  })

  it('merges flat Chinese title forms into the hierarchy preset', async () => {
    const hierarchy = (await listTocRules(ownerId)).find((rule) => rule.name === '中文网文（卷·章）')!
    expect(hierarchy.patterns).toHaveLength(2)
    expect(hierarchy.patterns[1]?.regex).toContain('序章')
    expect(hierarchy.patterns[1]?.regex).toContain('回')
    expect((await listTocRules(ownerId)).some((rule) => rule.name === '中文网文（章/回 平铺）')).toBe(false)
  })

  it('retires an untouched legacy flat preset and upgrades the hierarchy preset', async () => {
    const legacyFlatRegex = '^[ \\t　]{0,4}(?:序章|楔子|正文(?!完|结)|终章|后记|尾声|番外|第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}(?:章|回(?![合来事去])|话|集(?![合和]))).{0,30}$'
    const legacyChapterRegex = '^[ \\t　]{0,4}第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}章.{0,30}$'
    const legacySectionRegex = '^[ \\t　]{0,4}第\\s{0,4}[\\d〇零一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+?\\s{0,4}节(?!课).{0,30}$'
    const currentRules = new Map(SEED_TOC_RULES.map((rule) => [rule.seedKey, rule]))
    const now = Date.now()
    const rows = [
      { seedKey: 'toc.zh-hierarchy', name: '中文网文（卷·章·节）', patterns: [{ level: 1, regex: currentRules.get('toc.zh-hierarchy')!.patterns[0]!.regex, replacement: null, enabled: true }, { level: 2, regex: legacyChapterRegex, replacement: null, enabled: true }, { level: 3, regex: legacySectionRegex, replacement: null, enabled: true }] },
      { seedKey: 'toc.zh-flat', name: '中文网文（章/回 平铺）', patterns: [{ level: 1, regex: legacyFlatRegex, replacement: null, enabled: true }] },
      { seedKey: 'toc.numeric', name: currentRules.get('toc.numeric')!.name, patterns: currentRules.get('toc.numeric')!.patterns },
      { seedKey: 'toc.en', name: currentRules.get('toc.en')!.name, patterns: currentRules.get('toc.en')!.patterns },
    ]
    rows.forEach((row, index) => db.insert(schema.tocRules).values({
      id: createId('tocr'),
      userId: ownerId,
      seedKey: row.seedKey,
      name: row.name,
      enabled: 1,
      sortOrder: index,
      patterns: row.patterns,
      createdAt: now,
      updatedAt: now,
    }).run())

    const migrated = await listTocRules(ownerId)
    expect(migrated.map((rule) => rule.name)).toEqual([
      '中文网文（卷·章）',
      '数字/大写数字 分隔符 标题',
      'English Chapter/Section/Part',
    ])
    expect(migrated[0]?.patterns[1]?.regex).toContain('序章')
  })

  it('delete-all sticks until restore is requested', async () => {
    const seeds = await listTocRules(ownerId)
    for (const rule of seeds) await deleteTocRule(ownerId, rule.id)
    expect(await listTocRules(ownerId)).toHaveLength(0)

    restoreTocRuleSeeds(ownerId)
    const restored = await listTocRules(ownerId)
    expect(restored).toHaveLength(SEED_TOC_RULES.length)
    expect(restored.map((r) => r.name)).toEqual(SEED_TOC_RULES.map((s) => s.name))
  })

  it('restores missing built-ins without changing user rules', async () => {
    const initial = await listTocRules(ownerId)
    await deleteTocRule(ownerId, initial[1]!.id)
    const mine = createTocRule(ownerId, sampleRule('mine'))
    const mineBefore = (await listTocRules(ownerId)).find((rule) => rule.id === mine.id)!

    restoreTocRuleSeeds(ownerId)
    const items = await listTocRules(ownerId)
    expect(items.map((rule) => rule.name)).toEqual([
      initial[0]!.name,
      initial[2]!.name,
      'mine',
      initial[1]!.name,
    ])
    expect(items.find((rule) => rule.id === mine.id)).toMatchObject({
      name: mineBefore.name,
      sortOrder: mineBefore.sortOrder,
      patterns: mineBefore.patterns,
    })

    restoreTocRuleSeeds(ownerId)
    expect(await listTocRules(ownerId)).toHaveLength(SEED_TOC_RULES.length + 1)
  })

  it('seeds are per-user', async () => {
    listTocRules(ownerId)
    expect(await listTocRules(otherId)).toHaveLength(SEED_TOC_RULES.length)
  })

  it('does not mark user-created rules as built-in', () => {
    const created = createTocRule(ownerId, sampleRule('mine'))
    expect(created.builtIn).toBe(false)
  })

  it('backfills the source marker for an exact legacy built-in rule', async () => {
    const seed = SEED_TOC_RULES[0]!
    db.insert(schema.tocRules).values({
      id: createId('tocr'),
      userId: ownerId,
      seedKey: null,
      name: seed.name,
      enabled: 1,
      sortOrder: 0,
      patterns: seed.patterns,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()

    const [rule] = await listTocRules(ownerId)
    expect(rule?.builtIn).toBe(true)
  })
})

describe('toc-rules routes', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string

  function createApp() {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('/api/v1/toc-rules/*', async (c, next) => {
      c.set('user', { id: ownerId, username: 'owner', role: 'owner', avatarKey: null })
      return next()
    })
    app.route('/api/v1/toc-rules', tocRuleRoutes)
    return app
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    ownerId = createId('user')
    db.insert(schema.users).values({
      id: ownerId,
      username: 'owner',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()
  })

  it('PUT /reorder is routed to the static handler, not PUT /:ruleId', async () => {
    const app = createApp()
    const a = createTocRule(ownerId, { name: 'a', patterns: [{ level: 1, regex: '^第[0-9]+章' }] })
    const b = createTocRule(ownerId, { name: 'b', patterns: [{ level: 1, regex: '^Chapter' }] })

    const res = await app.request('http://test/api/v1/toc-rules/reorder', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tocRuleIds: [b.id, a.id] }),
    })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { name: string; sortOrder: number }[] }
    const mine = data.filter((r) => ['a', 'b'].includes(r.name))
    expect(mine.map((r) => r.name)).toEqual(['b', 'a'])
    expect(mine.map((r) => r.sortOrder)).toEqual([0, 1])
  })

  it('GET / seeds the built-in presets on first access', async () => {
    const app = createApp()
    const res = await app.request('http://test/api/v1/toc-rules')
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { name: string }[] }
    expect(data).toHaveLength(SEED_TOC_RULES.length)
  })

  it('POST /seed restores presets after the user deleted all rules', async () => {
    const app = createApp()
    const seeds = await listTocRules(ownerId)
    for (const rule of seeds) await deleteTocRule(ownerId, rule.id)
    expect(await listTocRules(ownerId)).toHaveLength(0)

    const res = await app.request('http://test/api/v1/toc-rules/seed', { method: 'POST' })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { name: string }[] }
    expect(data).toHaveLength(SEED_TOC_RULES.length)
    expect(data.map((r) => r.name)).toEqual(SEED_TOC_RULES.map((s) => s.name))
  })

  it('PUT /:ruleId updates an existing rule', async () => {
    const app = createApp()
    const created = createTocRule(ownerId, { name: 'a', patterns: [{ level: 1, regex: '^第[0-9]+章' }] })

    const res = await app.request(`http://test/api/v1/toc-rules/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { name: string } }
    expect(data.name).toBe('renamed')
  })

  it('PUT /:ruleId with a missing rule returns TOC_RULE_NOT_FOUND', async () => {
    const app = createApp()
    const res = await app.request('http://test/api/v1/toc-rules/missing', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('TOC_RULE_NOT_FOUND')
  })
})

describe('toc-rule schemas', () => {
  it('accepts a valid create payload and fills defaults', () => {
    const parsed = tocRuleCreateSchema.safeParse({
      name: '中文网文',
      patterns: [{ level: 1, regex: '^第[0-9]+章' }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.patterns[0].replacement).toBeNull()
      expect(parsed.data.patterns[0].enabled).toBe(true)
    }
  })

  it('rejects empty patterns and invalid level', () => {
    expect(tocRuleCreateSchema.safeParse({ name: 'x', patterns: [] }).success).toBe(false)
    expect(tocRuleCreateSchema.safeParse({
      name: 'x',
      patterns: [{ level: 0, regex: '^x' }],
    }).success).toBe(false)
  })

  it('requires pattern levels to follow their array positions', () => {
    expect(tocRuleCreateSchema.safeParse({
      name: 'x',
      patterns: [
        { level: 1, regex: '^卷' },
        { level: 1, regex: '^章' },
      ],
    }).success).toBe(false)
    expect(tocRuleCreateSchema.safeParse({
      name: 'x',
      patterns: [
        { level: 1, regex: '^卷' },
        { level: 3, regex: '^节' },
      ],
    }).success).toBe(false)
  })

  it('rejects invalid regex at creation', () => {
    expect(tocRuleCreateSchema.safeParse({
      name: 'x',
      patterns: [{ level: 1, regex: '([' }],
    }).success).toBe(false)
  })

  it('validates partial update and reorder payloads', () => {
    expect(tocRuleUpdateSchema.safeParse({ name: 'x' }).success).toBe(true)
    expect(tocRuleUpdateSchema.safeParse({}).success).toBe(true)
    expect(tocRuleUpdateSchema.safeParse({ patterns: [] }).success).toBe(false)
    expect(tocRuleReorderSchema.safeParse({ tocRuleIds: ['a', 'b'] }).success).toBe(true)
    // empty list is a harmless no-op at the service layer (loop does nothing)
    expect(tocRuleReorderSchema.safeParse({ tocRuleIds: [] }).success).toBe(true)
  })
})
