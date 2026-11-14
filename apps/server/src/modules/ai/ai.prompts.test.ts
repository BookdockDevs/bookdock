import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { migrateBeforeBookRetirementIncluding } from '../../db/migration-stage'
import * as schema from '../../db/schema'

vi.mock('../../config', () => ({
  config: {
    aiBaseUrl: null,
    aiApiKey: null,
    aiModel: null,
    aiProvider: 'openai',
    jwtSecret: 'test-secret',
  },
}))

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))

import { getDb } from '../../db/client'
import { migrateLegacyAiPrompts } from './ai-prompts-migration'
import {
  aiPromptsRestoreAvailable,
  createAiPrompt,
  deleteAiPrompt,
  ensureAiPromptSeeds,
  listAiPrompts,
  resolveAiPromptForExecution,
  restoreAiPrompts,
  reorderAiPrompts,
  updateAiPrompt,
} from './ai.prompts.service'

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrateBeforeBookRetirementIncluding(db, { migrationsFolder: './src/db/migrations' }, [])
  return db
}

type TestDb = ReturnType<typeof createTestDb>

function account(db: TestDb, id: string) {
  db.insert(schema.users).values({ id, username: id, createdAt: Date.now() }).run()
  return id
}

function readPreference(db: TestDb, userId: string) {
  return db.select().from(schema.settings)
    .where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, 'aiPrompts'))).get()?.value as
    { enabled: Record<string, boolean>; order: string[] } | undefined
}

describe('quick command definitions', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  it('seeds the built-in presets once and repeated reads never duplicate them', () => {
    const userId = account(db, 'user-1')

    const first = listAiPrompts(userId)
    expect(first.filter((prompt) => prompt.builtIn)).toHaveLength(5)

    // A second boot/seed pass and further reads converge on the same rows.
    ensureAiPromptSeeds(userId)
    const second = listAiPrompts(userId)
    expect(second).toHaveLength(first.length)
    expect(second.map((prompt) => prompt.id)).toEqual(first.map((prompt) => prompt.id))
  })

  it('keeps user modifications to built-ins instead of re-applying the defaults', () => {
    const userId = account(db, 'user-1')
    const builtIn = listAiPrompts(userId).find((prompt) => prompt.builtIn && prompt.scope === 'reading')!

    updateAiPrompt(userId, 'owner', builtIn.id, { name: '总结（改）', prompt: '改动后的提示词' })

    ensureAiPromptSeeds(userId)
    const kept = listAiPrompts(userId).find((prompt) => prompt.id === builtIn.id)!
    expect(kept).toMatchObject({ name: '总结（改）', prompt: '改动后的提示词', builtIn: true })
  })

  it('rejects a member publishing to all users, on create and on update', () => {
    const userId = account(db, 'member-1')
    const created = createAiPrompt(userId, 'member', { name: '回顾', prompt: '请回顾' })

    expect(() => createAiPrompt(userId, 'member', { name: '公开', prompt: '请总结', availability: 'instance' }))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
    expect(() => updateAiPrompt(userId, 'member', created.id, { availability: 'instance' }))
      .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))

    // A member keeps the command but never gains the wider audience.
    expect(listAiPrompts(userId).find((prompt) => prompt.id === created.id)?.availability).toBe('user')
  })

  it('lets the owner publish, serve and unshare a command', () => {
    const owner = account(db, 'owner-1')
    const consumer = account(db, 'member-1')
    const published = createAiPrompt(owner, 'owner', { name: '共读', prompt: '请总结全书', availability: 'instance' })

    // The publisher keeps the command on; a consumer starts with it off.
    expect(listAiPrompts(owner).find((prompt) => prompt.id === published.id)).toMatchObject({ enabled: true, availability: 'instance' })
    expect(listAiPrompts(consumer).find((prompt) => prompt.id === published.id)).toMatchObject({ enabled: false, mine: false })

    updateAiPrompt(owner, 'owner', published.id, { availability: 'user' })

    expect(listAiPrompts(consumer).some((prompt) => prompt.id === published.id)).toBe(false)
    expect(() => resolveAiPromptForExecution(consumer, published.id))
      .toThrowError(expect.objectContaining({ code: 'AI_PROMPT_UNAVAILABLE' }))
  })

  it('keeps a shared command read-only for consumers: only their own switch moves', () => {
    const owner = account(db, 'owner-1')
    const consumer = account(db, 'member-1')
    const published = createAiPrompt(owner, 'owner', { name: '共读', prompt: '请总结全书', availability: 'instance' })

    for (const patch of [
      { name: '改名' },
      { prompt: '改写提示词' },
      { scope: 'selection' as const },
      { availability: 'user' as const },
    ]) {
      expect(() => updateAiPrompt(consumer, 'member', published.id, patch))
        .toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
    }

    const toggled = updateAiPrompt(consumer, 'member', published.id, { enabled: true })

    expect(toggled.enabled).toBe(true)
    // The definition row and the publisher's own switch stay untouched.
    const row = db.select().from(schema.aiPrompts).where(eq(schema.aiPrompts.id, published.id)).get()!
    expect(row).toMatchObject({ name: '共读', prompt: '请总结全书', enabled: 1, userId: owner })
    expect((readPreference(db, consumer)?.enabled ?? {})[published.id]).toBe(true)
  })

  it('gives each account an independent switch and order for shared commands', () => {
    const owner = account(db, 'owner-1')
    const first = account(db, 'member-1')
    const second = account(db, 'member-2')
    const published = createAiPrompt(owner, 'owner', { name: '共读', prompt: '请总结全书', availability: 'instance' })

    updateAiPrompt(first, 'member', published.id, { enabled: true })
    reorderAiPrompts(first, { ids: [published.id, ...listAiPrompts(first).filter((prompt) => prompt.id !== published.id).map((prompt) => prompt.id)] })

    // The other consumer keeps the default (off, definition order); the
    // publisher's definition row and preference document never moved.
    expect(listAiPrompts(second).find((prompt) => prompt.id === published.id)).toMatchObject({ enabled: false })
    expect(db.select().from(schema.aiPrompts).where(eq(schema.aiPrompts.id, published.id)).get()?.sortOrder)
      .toBe(10)
    expect(listAiPrompts(first)[0]?.id).toBe(published.id)
    expect(readPreference(db, owner)).toBeUndefined()
  })

  it('refuses execution from a stale reference and always serves the current definition', () => {
    const owner = account(db, 'owner-1')
    const consumer = account(db, 'member-1')
    const published = createAiPrompt(owner, 'owner', { name: '共读', prompt: '旧提示词', availability: 'instance' })
    updateAiPrompt(consumer, 'member', published.id, { enabled: true })

    expect(resolveAiPromptForExecution(consumer, published.id).prompt).toBe('旧提示词')

    updateAiPrompt(owner, 'owner', published.id, { prompt: '新提示词' })
    expect(resolveAiPromptForExecution(consumer, published.id).prompt).toBe('新提示词')

    deleteAiPrompt(owner, published.id)
    expect(() => resolveAiPromptForExecution(consumer, published.id))
      .toThrowError(expect.objectContaining({ code: 'AI_PROMPT_UNAVAILABLE' }))
  })

  it('never treats another account\'s built-in preset as a shared definition', () => {
    const first = account(db, 'member-1')
    const second = account(db, 'member-2')

    listAiPrompts(first)
    listAiPrompts(second)

    // Both accounts own their seeded copy, so neither sees the other's rows.
    for (const prompt of listAiPrompts(second)) expect(prompt.mine).toBe(true)
    expect(listAiPrompts(second)).toHaveLength(5)
  })

  it('restores only missing built-in presets and never touches custom commands or edits', () => {
    const owner = account(db, 'owner-1')
    const consumer = account(db, 'member-1')
    const published = createAiPrompt(owner, 'owner', { name: '共读', prompt: '请总结全书', availability: 'instance' })
    updateAiPrompt(consumer, 'member', published.id, { enabled: true })

    const user = account(db, 'member-2')
    listAiPrompts(user)
    const custom = createAiPrompt(user, 'member', { name: '回顾', prompt: '请回顾' })
    const modified = listAiPrompts(user).find((prompt) => prompt.builtIn && prompt.scope === 'reading')!
    const deleted = listAiPrompts(user).find((prompt) => prompt.builtIn && prompt.scope === 'selection')!
    updateAiPrompt(user, 'member', modified.id, { prompt: '改动后的提示词' })
    deleteAiPrompt(user, deleted.id)

    expect(aiPromptsRestoreAvailable(user)).toBe(true)
    const restored = restoreAiPrompts(user)

    expect(restored.filter((prompt) => prompt.builtIn)).toHaveLength(5)
    // Custom commands and edits to built-ins survive the restore.
    expect(listAiPrompts(user).find((prompt) => prompt.id === custom.id)).toMatchObject({ name: '回顾' })
    expect(listAiPrompts(user).find((prompt) => prompt.id === modified.id)).toMatchObject({ prompt: '改动后的提示词' })
    expect(listAiPrompts(user).filter((prompt) => prompt.builtIn && prompt.name === deleted.name)).toHaveLength(1)
    expect(aiPromptsRestoreAvailable(user)).toBe(false)
    // The shared command consumer keeps their own choice about it.
    expect(listAiPrompts(consumer).find((prompt) => prompt.id === published.id)).toMatchObject({ enabled: true })
    expect(readPreference(db, consumer)?.order).not.toContain(published.id)
  })
})

describe('legacy quick command conversion', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  function saveAiDocument(userId: string, prompts: unknown[]) {
    db.insert(schema.settings).values({ id: `setting_${userId}_ai`, userId, key: 'ai', value: { prompts, modes: [] } }).run()
  }

  function rows(userId: string) {
    return db.select().from(schema.aiPrompts).where(eq(schema.aiPrompts.userId, userId)).all()
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }

  it('materializes the legacy array as owned rows keeping ids, text, switch and order', () => {
    const userId = account(db, 'user-1')
    saveAiDocument(userId, [
      { id: 'explain-selection', name: '解释（改）', prompt: '自定义解释', scope: 'selection', enabled: true, order: 30 },
      { id: 'custom-review', name: '回顾', prompt: '请回顾', enabled: false, order: 10 },
    ])

    migrateLegacyAiPrompts(db)

    const converted = rows(userId)
    expect(converted).toHaveLength(2)
    expect(converted[0]).toMatchObject({
      id: 'custom-review', name: '回顾', prompt: '请回顾', enabled: 0, sortOrder: 10,
      seedKey: null, availability: 'user',
    })
    expect(converted[1]).toMatchObject({
      id: 'explain-selection', name: '解释（改）', prompt: '自定义解释', enabled: 1, sortOrder: 30,
      seedKey: 'explain-selection',
    })
    // The array leaves the document so the two stores never diverge.
    const ai = db.select().from(schema.settings).where(eq(schema.settings.userId, userId)).get()!.value as Record<string, unknown>
    expect(ai).not.toHaveProperty('prompts')

    // The conversion counts as seeding: listing afterwards adds no presets.
    expect(listAiPrompts(userId).map((prompt) => prompt.name)).toEqual(['回顾', '解释（改）'])
  })

  it('derives an id when another account already owns the legacy id', () => {
    const owner = account(db, 'user-1')
    const other = account(db, 'user-2')
    db.insert(schema.aiPrompts).values({
      id: 'custom-review', userId: owner, seedKey: null, name: '别人的', prompt: 'x',
      scope: 'both', enabled: 1, sortOrder: 0, availability: 'user', createdAt: 1, updatedAt: 1,
    }).run()
    saveAiDocument(other, [{ id: 'custom-review', name: '我的', prompt: '请回顾', enabled: true, order: 10 }])

    migrateLegacyAiPrompts(db)

    const converted = rows(other)
    expect(converted).toHaveLength(1)
    expect(converted[0]!.id).not.toBe('custom-review')
    expect(converted[0]!.name).toBe('我的')
    expect(db.select().from(schema.aiPrompts).where(eq(schema.aiPrompts.id, 'custom-review')).get()?.userId).toBe(owner)
  })

  it('is idempotent: rerunning the conversion converges instead of duplicating', () => {
    const userId = account(db, 'user-1')
    saveAiDocument(userId, [
      { id: 'explain-selection', name: '解释这段', prompt: '请解释', scope: 'selection', enabled: true, order: 10 },
      { id: 'custom-review', name: '回顾', prompt: '请回顾', enabled: true, order: 20 },
    ])

    migrateLegacyAiPrompts(db)
    const first = rows(userId).map((row) => [row.id, row.name, row.sortOrder])

    migrateLegacyAiPrompts(db)

    expect(rows(userId).map((row) => [row.id, row.name, row.sortOrder])).toEqual(first)
  })

  it('keeps an emptied legacy list empty instead of reseeding presets', () => {
    const userId = account(db, 'user-1')
    saveAiDocument(userId, [])

    migrateLegacyAiPrompts(db)

    expect(rows(userId)).toHaveLength(0)
    listAiPrompts(userId)
    expect(rows(userId)).toHaveLength(0)
  })
})
