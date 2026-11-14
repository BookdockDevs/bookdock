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
import { migrateLegacyAiSettings } from './ai-legacy-migration'

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

function saveSetting(db: TestDb, userId: string, key: string, value: unknown) {
  db.insert(schema.settings).values({ id: `setting_${userId}_${key}`, userId, key, value }).run()
}

function readSetting(db: TestDb, userId: string, key: string) {
  return db.select().from(schema.settings).where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, key))).get()?.value
}

function connections(db: TestDb, userId: string) {
  return db.select().from(schema.aiConnections).where(eq(schema.aiConnections.userId, userId)).all()
}

function models(db: TestDb, connectionId: string) {
  return db.select().from(schema.aiModels).where(eq(schema.aiModels.connectionId, connectionId)).all()
}

function legacyAiDocument(overrides: Record<string, unknown> = {}) {
  return {
    profiles: [{
      id: 'profile-a',
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      embeddingModel: null,
      encryptedApiKey: 'encrypted-key',
      models: [
        { id: 'deepseek-chat', name: 'deepseek-chat', capabilities: { tools: true } },
        { id: 'deepseek-reasoner', name: 'deepseek-reasoner', capabilities: { tools: true, reasoning: true } },
      ],
      embeddingModels: [],
      createdAt: 100,
      updatedAt: 200,
    }],
    activeProfileId: 'profile-a',
    prompts: [{ id: 'p1', name: 'prompt', prompt: 'text', enabled: true, order: 10 }],
    modes: [{ id: 'assistant', name: '助理', prompt: '', builtIn: true }],
    ...overrides,
  }
}

describe('legacy AI settings conversion', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  it('materializes a profile as a connection with its models and a default model', () => {
    const userId = account(db, 'user-1')
    saveSetting(db, userId, 'ai', legacyAiDocument())

    migrateLegacyAiSettings(db)

    const rows = connections(db, userId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'profile-a',
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      encryptedApiKey: 'encrypted-key',
      availability: 'user',
      createdAt: 100,
      updatedAt: 200,
    })

    const entries = models(db, 'profile-a')
    // The configured model is materialized even when discovery never listed it,
    // which is the old resolver's provider-default fallback.
    expect(entries.map((entry) => entry.upstreamModelId).sort()).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    if (!entries.every((entry) => entry.enabled === 1)) throw new Error('migrated models must stay selectable')
    expect(entries.find((entry) => entry.upstreamModelId === 'deepseek-reasoner')?.capabilities).toEqual({ tools: true, reasoning: true })

    const ai = readSetting(db, userId, 'ai')
    expect(ai).not.toHaveProperty('profiles')
    expect(ai).not.toHaveProperty('activeProfileId')
    expect(ai).not.toHaveProperty('defaultModelId')
    expect((ai as { prompts?: unknown[] }).prompts).toHaveLength(1)
    expect((ai as { modes?: unknown[] }).modes).toHaveLength(1)
  })

  it('is idempotent and keeps derived ids stable across restarts', () => {
    const userId = account(db, 'user-1')
    saveSetting(db, userId, 'ai', legacyAiDocument())

    migrateLegacyAiSettings(db)
    const firstModelIds = models(db, 'profile-a').map((entry) => entry.id).sort()

    migrateLegacyAiSettings(db)

    expect(connections(db, userId)).toHaveLength(1)
    expect(models(db, 'profile-a').map((entry) => entry.id).sort()).toEqual(firstModelIds)
    expect(readSetting(db, userId, 'ai')).not.toHaveProperty('defaultModelId')
  })

  it('derives a connection id when another account already owns the profile id', () => {
    const owner = account(db, 'user-1')
    const other = account(db, 'user-2')
    db.insert(schema.aiConnections).values({
      id: 'profile-a', userId: owner, name: 'Existing', provider: 'openai', baseUrl: null,
      encryptedApiKey: null, availability: 'user', createdAt: 1, updatedAt: 1,
    }).run()
    saveSetting(db, other, 'ai', legacyAiDocument())

    migrateLegacyAiSettings(db)

    const rows = connections(db, other)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).not.toBe('profile-a')
    expect(rows[0]!.id).toMatch(/^ai-connection_/)
    expect(rows[0]!.name).toBe('DeepSeek')
    // The pre-existing row keeps its owner untouched.
    expect(connections(db, owner).map((row) => row.id)).toEqual(['profile-a'])
  })

  it('rewrites the translation channel to an internal model id', () => {
    const userId = account(db, 'user-1')
    saveSetting(db, userId, 'ai', legacyAiDocument())
    saveSetting(db, userId, 'translation', { targetLang: 'ja', channel: { kind: 'ai', profileId: 'profile-a', model: 'deepseek-reasoner' } })

    migrateLegacyAiSettings(db)

    const translation = readSetting(db, userId, 'translation') as { targetLang: string; channel: { kind: string; modelId: string | null } }
    expect(translation.targetLang).toBe('ja')
    expect(translation.channel.kind).toBe('ai')
    const reasoner = models(db, 'profile-a').find((entry) => entry.upstreamModelId === 'deepseek-reasoner')
    expect(translation.channel.modelId).toBe(reasoner?.id)
  })

  it('falls back to the profile default model when the channel named none', () => {
    const userId = account(db, 'user-1')
    saveSetting(db, userId, 'ai', legacyAiDocument())
    saveSetting(db, userId, 'translation', { targetLang: 'zh-Hans', channel: { kind: 'ai', profileId: 'profile-a', model: null } })

    migrateLegacyAiSettings(db)

    const translation = readSetting(db, userId, 'translation') as { channel: { modelId: string | null } }
    const chat = models(db, 'profile-a').find((entry) => entry.upstreamModelId === 'deepseek-chat')
    expect(translation.channel.modelId).toBe(chat?.id)
  })

  it('nulls an unmappable channel model instead of inventing one', () => {
    const userId = account(db, 'user-1')
    saveSetting(db, userId, 'ai', legacyAiDocument({ profiles: [{ id: 'profile-a', provider: 'openai', model: null, models: [] }] }))
    saveSetting(db, userId, 'translation', { targetLang: 'zh-Hans', channel: { kind: 'ai', profileId: 'profile-a', model: 'unknown-model' } })

    migrateLegacyAiSettings(db)

    const translation = readSetting(db, userId, 'translation') as { channel: { modelId: string | null } }
    expect(translation.channel).toEqual({ kind: 'ai', modelId: null })
  })

  it('leaves already-converted documents untouched', () => {
    const userId = account(db, 'user-1')
    saveSetting(db, userId, 'ai', { defaultModelId: 'ai-model_kept', prompts: [] })
    saveSetting(db, userId, 'translation', { targetLang: 'en', channel: { kind: 'ai', modelId: 'ai-model_kept' } })

    migrateLegacyAiSettings(db)

    expect(connections(db, userId)).toEqual([])
    expect(readSetting(db, userId, 'ai')).toEqual({ defaultModelId: 'ai-model_kept', prompts: [] })
    expect(readSetting(db, userId, 'translation')).toEqual({ targetLang: 'en', channel: { kind: 'ai', modelId: 'ai-model_kept' } })
  })

  it('keeps an existing default model when the legacy document already had one', () => {
    const userId = account(db, 'user-1')
    saveSetting(db, userId, 'ai', legacyAiDocument({ defaultModelId: 'ai-model_existing' }))

    migrateLegacyAiSettings(db)

    expect((readSetting(db, userId, 'ai') as { defaultModelId: string }).defaultModelId).toBe('ai-model_existing')
  })
})
