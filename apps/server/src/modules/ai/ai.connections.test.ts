import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { migrateBeforeBookRetirementIncluding } from '../../db/migration-stage'
import * as schema from '../../db/schema'

vi.mock('../../config', () => ({
  config: {
    jwtSecret: 'test-secret',
  },
}))

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))

import { getDb } from '../../db/client'
import {
  createAiConnection,
  createAiModel,
  deleteAiConnection,
  deleteAiModel,
  getAiCatalog,
  mergeDiscoveredModels,
  readLastUsedModels,
  resolveAiExecution,
  resolveExplicitModel,
  updateAiConnection,
  updateAiModel,
} from './ai.connections.service'
import { decryptApiKey, encryptApiKey } from './ai.secrets'
import { getAiConfig, getAiStatus } from './ai.service'

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

function settingsValue(db: TestDb, userId: string) {
  return db.select().from(schema.settings).where(and(eq(schema.settings.userId, userId), eq(schema.settings.key, 'ai'))).get()?.value as
    | { lastUsedModels?: { chat?: string | null; translate?: string | null } }
    | undefined
}

describe('AI connections', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  it('stores a credential encrypted and never returns it', () => {
    account(db, 'owner-1')
    const connection = createAiConnection('owner-1', 'member', {
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'plain-secret',
    })

    expect(connection).toEqual(expect.objectContaining({
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      availability: 'user',
      mine: true,
      apiKeyConfigured: true,
    }))
    expect(connection).not.toHaveProperty('apiKey')

    const row = db.select().from(schema.aiConnections).where(eq(schema.aiConnections.id, connection.id)).get()
    expect(row?.encryptedApiKey).toEqual(expect.any(String))
    expect(row?.encryptedApiKey).not.toContain('plain-secret')
    expect(decryptApiKey(row?.encryptedApiKey ?? undefined)).toBe('plain-secret')
  })

  it('clears the stored key when the provider changes without a replacement', () => {
    account(db, 'owner-1')
    const connection = createAiConnection('owner-1', 'owner', {
      name: 'Hosted', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'plain-secret',
    })

    const updated = updateAiConnection('owner-1', 'member', connection.id, { provider: 'openai', baseUrl: 'https://api.openai.com/v1' })
    expect(updated).toMatchObject({ provider: 'openai', apiKeyConfigured: false })

    const renamed = updateAiConnection('owner-1', 'member', connection.id, { name: 'Renamed' })
    expect(renamed).toMatchObject({ name: 'Renamed', apiKeyConfigured: false })
  })

  it('keeps the existing key when the provider is unchanged and no new key is sent', () => {
    account(db, 'owner-1')
    const connection = createAiConnection('owner-1', 'member', {
      name: 'Hosted', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'plain-secret',
    })

    expect(updateAiConnection('owner-1', 'member', connection.id, { name: 'Renamed' })).toMatchObject({ apiKeyConfigured: true })
    expect(updateAiConnection('owner-1', 'member', connection.id, { apiKey: null })).toMatchObject({ apiKeyConfigured: false })
  })

  it('hides other accounts connections behind NOT_FOUND', () => {
    account(db, 'owner-1')
    account(db, 'owner-2')
    const connection = createAiConnection('owner-1', 'member', { name: 'Mine', provider: 'openai', baseUrl: 'https://api.openai.com/v1' })

    expect(() => updateAiConnection('owner-2', 'member', connection.id, { name: 'Stolen' })).toThrow(expect.objectContaining({ code: 'AI_CONNECTION_NOT_FOUND' }))
    expect(() => deleteAiConnection('owner-2', connection.id)).toThrow(expect.objectContaining({ code: 'AI_CONNECTION_NOT_FOUND' }))
    expect(() => createAiModel('owner-2', connection.id, { upstreamModelId: 'gpt-x' })).toThrow(expect.objectContaining({ code: 'AI_CONNECTION_NOT_FOUND' }))
  })

  it('limits publishing to the instance owner', () => {
    account(db, 'user-1')
    const connection = createAiConnection('user-1', 'member', { name: 'Mine', provider: 'openai', baseUrl: 'https://api.openai.com/v1' })

    expect(() => updateAiConnection('user-1', 'member', connection.id, { availability: 'instance' }))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
    expect(updateAiConnection('user-1', 'owner', connection.id, { availability: 'instance' })).toMatchObject({ availability: 'instance' })
  })

  it('shows a published connection to other accounts but only its enabled models', () => {
    account(db, 'owner-1')
    account(db, 'member-1')
    const connection = createAiConnection('owner-1', 'owner', {
      name: 'Shared', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'shared-secret',
    })
    const exposed = createAiModel('owner-1', connection.id, { upstreamModelId: 'gpt-exposed' })
    const hidden = createAiModel('owner-1', connection.id, { upstreamModelId: 'gpt-hidden' })
    updateAiModel('owner-1', hidden.id, { enabled: false })
    updateAiConnection('owner-1', 'owner', connection.id, { availability: 'instance' })

    const ownerCatalog = getAiCatalog('owner-1')
    expect(ownerCatalog.connections).toHaveLength(1)
    expect(ownerCatalog.models.map((model) => model.id).sort()).toEqual([exposed.id, hidden.id].sort())

    const memberCatalog = getAiCatalog('member-1')
    expect(memberCatalog.connections).toEqual([expect.objectContaining({ id: connection.id, mine: false, apiKeyConfigured: true })])
    expect(memberCatalog.models).toEqual([expect.objectContaining({ id: exposed.id, mine: false })])

    // An unpublished connection is invisible even to a member that knows the id.
    updateAiConnection('owner-1', 'owner', connection.id, { availability: 'user' })
    expect(getAiCatalog('member-1').connections).toEqual([])
    expect(getAiCatalog('member-1').models).toEqual([])
  })

  it('resolves an explicit model and records the per-surface last-used model', () => {
    account(db, 'user-1')
    const connection = createAiConnection('user-1', 'member', {
      name: 'Hosted', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'plain-secret',
    })
    const model = createAiModel('user-1', connection.id, { upstreamModelId: 'gpt-4o-mini' })
    const translateModel = createAiModel('user-1', connection.id, { upstreamModelId: 'gpt-4o' })

    // Without a surface nothing is recorded (test/diagnostic paths).
    expect(resolveAiExecution('user-1', 'member', model.id)).toMatchObject({
      modelId: model.id, connectionId: connection.id, provider: 'openai', upstreamModelId: 'gpt-4o-mini', apiKey: 'plain-secret',
    })
    expect(settingsValue(db, 'user-1')?.lastUsedModels).toBeUndefined()

    // Chat and translation remember their models independently.
    resolveAiExecution('user-1', 'member', model.id, 'chat')
    resolveAiExecution('user-1', 'member', translateModel.id, 'translate')
    expect(settingsValue(db, 'user-1')?.lastUsedModels).toEqual({ chat: model.id, translate: translateModel.id })

    // A request without an explicit model resolves to the surface's last-used one.
    expect(resolveAiExecution('user-1', 'member', null, 'chat')).toMatchObject({ modelId: model.id })
    expect(resolveAiExecution('user-1', 'member', null, 'translate')).toMatchObject({ modelId: translateModel.id })
    expect(readLastUsedModels('user-1')).toEqual({ chat: model.id, translate: translateModel.id })
  })

  it('falls through a dangling last-used model to the first runnable model', () => {
    account(db, 'user-1')
    const first = createAiConnection('user-1', 'member', {
      name: 'Hosted', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'plain-secret',
    })
    const firstModel = createAiModel('user-1', first.id, { upstreamModelId: 'gpt-4o-mini' })
    const second = createAiConnection('user-1', 'member', {
      name: 'Backup', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'plain-secret',
    })
    const secondModel = createAiModel('user-1', second.id, { upstreamModelId: 'gpt-4o' })
    updateAiModel('user-1', secondModel.id, { enabled: true })
    resolveAiExecution('user-1', 'member', secondModel.id, 'chat')

    deleteAiConnection('user-1', second.id)

    // The stale last-used entry silently falls through to the next candidate.
    expect(resolveAiExecution('user-1', 'member', null, 'chat').modelId).toBe(firstModel.id)
    // And the successful fallback becomes the new last-used model.
    expect(readLastUsedModels('user-1').chat).toBe(firstModel.id)
  })

  it('treats a stale model choice as absent and falls through the chain', () => {
    account(db, 'user-1')
    const connection = createAiConnection('user-1', 'member', {
      name: 'Hosted', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'plain-secret',
    })
    const model = createAiModel('user-1', connection.id, { upstreamModelId: 'gpt-4o-mini' })
    updateAiModel('user-1', model.id, { enabled: false })
    const kept = createAiModel('user-1', connection.id, { upstreamModelId: 'gpt-4o' })
    updateAiModel('user-1', kept.id, { enabled: true })

    // A stale (disabled) choice counts as absent: the chain serves the call
    // with the one runnable model, never an error.
    expect(resolveAiExecution('user-1', 'member', model.id).modelId).toBe(kept.id)

    deleteAiConnection('user-1', connection.id)
    expect(() => resolveAiExecution('user-1', 'member', model.id)).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' }))
  })

  it('throws AI_NOT_CONFIGURED when no model exists at all', () => {
    account(db, 'user-1')

    expect(() => resolveAiExecution('user-1', 'member', null, 'translate')).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' }))
  })

  it('rejects a member-owned non-default endpoint before any request', () => {
    account(db, 'user-1')
    // The route refuses this at write time; seed the row so the resolver rule
    // itself is covered for data written by older builds.
    const connectionId = 'ai-connection_local'
    db.insert(schema.aiConnections).values({
      id: connectionId, userId: 'user-1', name: 'Local', provider: 'openai',
      baseUrl: 'http://127.0.0.1:9999/v1', encryptedApiKey: encryptApiKey('plain-secret'),
      availability: 'user', createdAt: 1, updatedAt: 1,
    }).run()
    const connection = { id: connectionId }
    const model = createAiModel('user-1', connection.id, { upstreamModelId: 'local-model' })

    expect(() => resolveAiExecution('user-1', 'member', model.id)).toThrow(expect.objectContaining({ code: 'AI_NOT_ALLOWED' }))
    // The same row is usable for the instance owner, who owns the connection.
    expect(resolveAiExecution('user-1', 'owner', model.id)).toMatchObject({ connectionId: connection.id })
  })

  it('requires a credential for hosted providers', () => {
    account(db, 'user-1')
    const connection = createAiConnection('user-1', 'member', {
      name: 'Hosted', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1',
    })
    const model = createAiModel('user-1', connection.id, { upstreamModelId: 'deepseek-chat' })

    expect(() => resolveExplicitModel('user-1', 'member', model.id)).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' }))
  })

  it('merges discovered models without losing manual metadata or exposure', () => {
    account(db, 'owner-1')
    const connection = createAiConnection('owner-1', 'member', {
      name: 'Hosted', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'plain-secret',
    })
    const manual = createAiModel('owner-1', connection.id, { upstreamModelId: 'gpt-manual', name: 'Manual name', capabilities: { vision: true } })
    updateAiModel('owner-1', manual.id, { enabled: true })

    const merged = mergeDiscoveredModels('owner-1', connection.id, [
      { id: 'gpt-manual', name: 'Provider name' },
      { id: 'gpt-new', name: 'New model', capabilities: { tools: true } },
    ])

    const manualEntry = merged.find((entry) => entry.upstreamModelId === 'gpt-manual')
    expect(manualEntry).toMatchObject({ id: manual.id, name: 'Manual name', enabled: true, capabilities: { vision: true } })
    const newEntry = merged.find((entry) => entry.upstreamModelId === 'gpt-new')
    expect(newEntry).toMatchObject({ name: 'New model', enabled: false, capabilities: { tools: true } })

    // A later refresh never deletes entries the provider no longer returns.
    const second = mergeDiscoveredModels('owner-1', connection.id, [{ id: 'gpt-other', name: 'Other' }])
    expect(second.map((entry) => entry.upstreamModelId).sort()).toEqual(['gpt-manual', 'gpt-new', 'gpt-other'])
  })

  it('rejects duplicate upstream entries on the same connection', () => {
    account(db, 'owner-1')
    const connection = createAiConnection('owner-1', 'member', {
      name: 'Hosted', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'plain-secret',
    })
    createAiModel('owner-1', connection.id, { upstreamModelId: 'gpt-4o-mini' })

    expect(() => createAiModel('owner-1', connection.id, { upstreamModelId: 'gpt-4o-mini' }))
      .toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }))
  })

  it('deletes a model without touching its connection', () => {
    account(db, 'owner-1')
    const connection = createAiConnection('owner-1', 'member', {
      name: 'Hosted', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'plain-secret',
    })
    const model = createAiModel('owner-1', connection.id, { upstreamModelId: 'gpt-4o-mini' })

    deleteAiModel('owner-1', model.id)

    expect(db.select().from(schema.aiModels).all()).toEqual([])
    expect(db.select().from(schema.aiConnections).where(eq(schema.aiConnections.id, connection.id)).get()).toBeTruthy()
  })

  it('offers only enabled models on the chat status and keeps disabled ones manageable', () => {
    account(db, 'owner-1')
    const connection = createAiConnection('owner-1', 'member', {
      name: 'Hosted', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'plain-secret',
    })
    const enabled = createAiModel('owner-1', connection.id, { upstreamModelId: 'gpt-4o-mini' })
    const disabled = createAiModel('owner-1', connection.id, { upstreamModelId: 'gpt-4o' })
    updateAiModel('owner-1', disabled.id, { enabled: false })

    // The chat selector is an execution surface: a switched-off model cannot run.
    expect(getAiStatus('owner-1').models.map((model) => model.id)).toEqual([enabled.id])
    // Management still shows it to its owner so it can be switched back on.
    expect(getAiConfig('owner-1').models.map((model) => model.id).sort()).toEqual([enabled.id, disabled.id].sort())
  })

  it('round-trips a re-encrypted key through the shared secret format', () => {
    const ciphertext = encryptApiKey('round-trip')
    expect(ciphertext).not.toContain('round-trip')
    expect(decryptApiKey(ciphertext)).toBe('round-trip')
    expect(decryptApiKey(undefined)).toBeUndefined()
    expect(decryptApiKey('not-a-payload')).toBeUndefined()
  })
})
