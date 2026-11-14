import { and, asc, eq, ne, or } from 'drizzle-orm'

import { isAiEmbeddingModel } from '@bookdock/shared'
import type {
  AiConnectionCreateReq,
  AiConnectionRes,
  AiConnectionUpdateReq,
  AiModelCapabilities,
  AiModelEntryCreateReq,
  AiModelEntryRes,
  AiModelEntryUpdateReq,
  AiModelRes,
  AiProvider,
  AiProtocol,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { aiConnections, aiModels, settings } from '../../db/schema'
import { createId } from '../../lib/id'
import { assertCanPublish } from '../../lib/publish-permission'
import { AppError } from '../../middleware/error'
import { AI_PROVIDER_MAP, assertDraftBaseUrlAllowed, memberBaseUrlAllowed, normalizeProvider, requiresApiKey } from './ai.providers'
import { decryptApiKey, encryptApiKey } from './ai.secrets'

export const AI_SETTINGS_KEY = 'ai'
/** Keep in sync with MAX_MODEL_OPTIONS in ai.service.ts: one discovery pull adds at most this many models. */
const MAX_DISCOVERED_MODELS = 500

type ConnectionRow = typeof aiConnections.$inferSelect
type ModelRow = typeof aiModels.$inferSelect

export interface AiModelExecution {
  modelId: string
  connectionId: string | null
  provider: AiProvider
  protocol: AiProtocol
  baseUrl?: string
  apiKey?: string
  upstreamModelId?: string
  capabilities?: AiModelCapabilities
  configuredByUser: boolean
}

export interface StoredAiPreferences {
  lastUsedModels?: { chat?: string | null; translate?: string | null }
  prompts?: unknown
  modes?: unknown
  defaultAssistantMode?: unknown
  lastUsedConversationSettings?: unknown
}

export function readAiSettings(userId: string): StoredAiPreferences {
  const row = getDb().select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, AI_SETTINGS_KEY))).get()
  return row?.value && typeof row.value === 'object' && !Array.isArray(row.value) ? row.value as StoredAiPreferences : {}
}

function toConnectionRes(row: ConnectionRow, userId: string): AiConnectionRes {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    availability: row.availability,
    mine: row.userId === userId,
    apiKeyConfigured: Boolean(decryptApiKey(row.encryptedApiKey ?? undefined)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toModelEntryRes(row: ModelRow, connection: ConnectionRow, userId: string): AiModelEntryRes {
  return {
    id: row.id,
    connectionId: connection.id,
    connectionName: connection.name,
    provider: connection.provider,
    upstreamModelId: row.upstreamModelId,
    name: row.name,
    enabled: row.enabled === 1,
    ...(row.capabilities ? { capabilities: row.capabilities } : {}),
    mine: connection.userId === userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Own connections plus connections published to the instance. */
function accessibleConnections(userId: string): ConnectionRow[] {
  return getDb().select().from(aiConnections).where(
    or(eq(aiConnections.userId, userId), and(ne(aiConnections.userId, userId), eq(aiConnections.availability, 'instance'))),
  ).orderBy(asc(aiConnections.createdAt)).all()
}

/**
 * Model catalog. The publisher sees their own entries including disabled ones
 * (that is what the management UI edits); other accounts only see entries the
 * publisher exposed.
 */
function accessibleModels(userId: string, connections = accessibleConnections(userId)): { model: ModelRow; connection: ConnectionRow }[] {
  const byId = new Map(connections.map((connection) => [connection.id, connection]))
  if (byId.size === 0) return []
  const rows = getDb().select().from(aiModels).all()
  return rows.flatMap((model) => {
    const connection = byId.get(model.connectionId)
    if (!connection) return []
    if (connection.userId !== userId && model.enabled !== 1) return []
    return [{ model, connection }]
  }).sort((a, b) => a.model.createdAt - b.model.createdAt)
}

export function listAiConnections(userId: string): AiConnectionRes[] {
  return accessibleConnections(userId).map((row) => toConnectionRes(row, userId))
}

export function listAiModelEntries(userId: string): AiModelEntryRes[] {
  return accessibleModels(userId).map(({ model, connection }) => toModelEntryRes(model, connection, userId))
}

export function getAiCatalog(userId: string) {
  return {
    connections: listAiConnections(userId),
    models: listAiModelEntries(userId),
  } satisfies { connections: AiConnectionRes[]; models: AiModelEntryRes[] }
}

function getOwnedConnection(userId: string, connectionId: string): ConnectionRow {
  const row = getDb().select().from(aiConnections).where(eq(aiConnections.id, connectionId)).get()
  if (!row || row.userId !== userId) throw new AppError('AI_CONNECTION_NOT_FOUND', 'AI connection not found')
  return row
}

function getOwnedModel(userId: string, modelId: string): { model: ModelRow; connection: ConnectionRow } {
  const model = getDb().select().from(aiModels).where(eq(aiModels.id, modelId)).get()
  if (!model) throw new AppError('AI_MODEL_NOT_FOUND', 'AI model not found')
  const connection = getDb().select().from(aiConnections).where(eq(aiConnections.id, model.connectionId)).get()
  if (!connection || connection.userId !== userId) throw new AppError('AI_MODEL_NOT_FOUND', 'AI model not found')
  return { model, connection }
}

export function createAiConnection(userId: string, role: string, input: AiConnectionCreateReq): AiConnectionRes {
  const provider = normalizeProvider(input.provider)
  const baseUrl = input.baseUrl?.trim() || null
  assertDraftBaseUrlAllowed(role, provider, baseUrl)
  const now = Date.now()
  const row: ConnectionRow = {
    id: createId('ai-connection'),
    userId,
    name: input.name.trim().slice(0, 100) || AI_PROVIDER_MAP.get(provider)!.name,
    provider,
    baseUrl,
    encryptedApiKey: encryptApiKey(input.apiKey ?? null) || null,
    availability: 'user',
    createdAt: now,
    updatedAt: now,
  }
  getDb().insert(aiConnections).values(row).run()
  return toConnectionRes(row, userId)
}

export function updateAiConnection(userId: string, role: string, connectionId: string, input: AiConnectionUpdateReq): AiConnectionRes {
  const existing = getOwnedConnection(userId, connectionId)
  const provider = input.provider ? normalizeProvider(input.provider) : existing.provider
  const providerChanged = provider !== existing.provider
  const baseUrl = Object.hasOwn(input, 'baseUrl')
    ? input.baseUrl?.trim() || null
    : providerChanged ? AI_PROVIDER_MAP.get(provider)?.defaultBaseUrl ?? null : existing.baseUrl
  assertDraftBaseUrlAllowed(role, provider, baseUrl)
  assertCanPublish(role, input.availability)
  const next: ConnectionRow = {
    ...existing,
    name: input.name === undefined ? existing.name : input.name.trim().slice(0, 100),
    provider,
    baseUrl,
    updatedAt: Date.now(),
  }
  if (input.availability !== undefined) next.availability = input.availability
  if (Object.hasOwn(input, 'apiKey')) next.encryptedApiKey = encryptApiKey(input.apiKey ?? null) || null
  if (providerChanged && !Object.hasOwn(input, 'apiKey')) next.encryptedApiKey = null
  getDb().update(aiConnections).set({
    name: next.name,
    provider: next.provider,
    baseUrl: next.baseUrl,
    availability: next.availability,
    encryptedApiKey: next.encryptedApiKey,
    updatedAt: next.updatedAt,
  }).where(eq(aiConnections.id, connectionId)).run()
  return toConnectionRes(next, userId)
}

export function deleteAiConnection(userId: string, connectionId: string) {
  getOwnedConnection(userId, connectionId)
  // A stored model choice is never rewritten on delete: the stale id stays and
  // `resolveAiExecution` treats it as absent, serving the call from the
  // fallback chain until the user picks again.
  getDb().delete(aiConnections).where(eq(aiConnections.id, connectionId)).run()
}

function normalizeCapabilities(value: AiModelCapabilities | null | undefined): AiModelCapabilities | null {
  if (!value) return null
  const capabilities: AiModelCapabilities = {
    ...(value.vision ? { vision: true } : {}),
    ...(value.tools ? { tools: true } : {}),
    ...(value.reasoning ? { reasoning: true } : {}),
    ...(value.embedding ? { embedding: true } : {}),
  }
  return Object.keys(capabilities).length ? capabilities : null
}

export function createAiModel(userId: string, connectionId: string, input: AiModelEntryCreateReq): AiModelEntryRes {
  const connection = getOwnedConnection(userId, connectionId)
  const upstreamModelId = input.upstreamModelId.trim().slice(0, 200)
  if (!upstreamModelId) throw new AppError('VALIDATION_ERROR', 'Upstream model id is required')
  const now = Date.now()
  try {
    getDb().insert(aiModels).values({
      id: createId('ai-model'),
      connectionId,
      upstreamModelId,
      name: input.name?.trim().slice(0, 200) || upstreamModelId,
      enabled: 1,
      capabilities: normalizeCapabilities(input.capabilities),
      createdAt: now,
      updatedAt: now,
    }).run()
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) throw new AppError('VALIDATION_ERROR', 'This model is already added')
    throw error
  }
  const created = getDb().select().from(aiModels)
    .where(and(eq(aiModels.connectionId, connectionId), eq(aiModels.upstreamModelId, upstreamModelId))).get()!
  return toModelEntryRes(created, connection, userId)
}

export function updateAiModel(userId: string, modelId: string, input: AiModelEntryUpdateReq): AiModelEntryRes {
  const { model, connection } = getOwnedModel(userId, modelId)
  const patch: Partial<ModelRow> = { updatedAt: Date.now() }
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 200) || model.upstreamModelId
  if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0
  if (input.capabilities !== undefined) patch.capabilities = normalizeCapabilities(input.capabilities)
  if (input.upstreamModelId !== undefined) {
    const upstreamModelId = input.upstreamModelId.trim().slice(0, 200)
    if (!upstreamModelId) throw new AppError('VALIDATION_ERROR', 'Upstream model id is required')
    patch.upstreamModelId = upstreamModelId
  }
  try {
    getDb().update(aiModels).set(patch).where(eq(aiModels.id, modelId)).run()
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) throw new AppError('VALIDATION_ERROR', 'This model is already added')
    throw error
  }
  return toModelEntryRes(getDb().select().from(aiModels).where(eq(aiModels.id, modelId)).get()!, connection, userId)
}

export function deleteAiModel(userId: string, modelId: string) {
  getOwnedModel(userId, modelId)
  // Same rule as deleting a connection: the stale id stays in stored choices
  // and `resolveAiExecution` treats it as absent via the fallback chain.
  getDb().delete(aiModels).where(eq(aiModels.id, modelId)).run()
}

/**
 * Merges a discovery refresh on the upstream id: internal ids, manual entries,
 * capability overrides and enabled states survive, and nothing is deleted just
 * because a provider stopped listing it. New discoveries arrive disabled so a
 * refresh cannot silently change which model runs.
 */
export function mergeDiscoveredModels(userId: string, connectionId: string, discovered: readonly AiModelRes[]): AiModelEntryRes[] {
  const connection = getOwnedConnection(userId, connectionId)
  const existing = getDb().select().from(aiModels).where(eq(aiModels.connectionId, connectionId)).all()
  const byUpstream = new Map(existing.map((row) => [row.upstreamModelId, row]))
  const now = Date.now()
  getDb().transaction((tx) => {
    discovered.slice(0, MAX_DISCOVERED_MODELS).forEach((model, index) => {
      const upstreamModelId = model.id.trim().slice(0, 200)
      if (!upstreamModelId) return
      const current = byUpstream.get(upstreamModelId)
      if (current) {
        // Refresh presentation metadata only; capabilities stay a manual override.
        tx.update(aiModels).set({
          name: current.name === current.upstreamModelId ? model.name.slice(0, 200) : current.name,
          updatedAt: now,
        }).where(eq(aiModels.id, current.id)).run()
        return
      }
      tx.insert(aiModels).values({
        id: createId('ai-model'),
        connectionId,
        upstreamModelId,
        name: model.name.trim().slice(0, 200) || upstreamModelId,
        enabled: 0,
        capabilities: normalizeCapabilities(model.capabilities),
        createdAt: now + index,
        updatedAt: now,
      }).run()
    })
  })
  return getDb().select().from(aiModels).where(eq(aiModels.connectionId, connectionId)).all()
    .map((row) => toModelEntryRes(row, connection, userId))
}

/** Surfaces that remember the model they last ran with. */
export type AiModelSurface = 'chat' | 'translate'

export function readLastUsedModels(userId: string): { chat: string | null; translate: string | null } {
  const stored = readAiSettings(userId).lastUsedModels
  return {
    chat: typeof stored?.chat === 'string' && stored.chat ? stored.chat : null,
    translate: typeof stored?.translate === 'string' && stored.translate ? stored.translate : null,
  }
}

function writeLastUsedModel(userId: string, surface: AiModelSurface, modelId: string) {
  const row = getDb().select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, AI_SETTINGS_KEY))).get()
  const value = {
    ...(row?.value as Record<string, unknown> | undefined ?? {}),
    lastUsedModels: { ...readLastUsedModels(userId), [surface]: modelId },
  }
  if (row) getDb().update(settings).set({ value }).where(eq(settings.id, row.id)).run()
  else getDb().insert(settings).values({ id: createId('setting'), userId, key: AI_SETTINGS_KEY, value }).run()
}

/**
 * Resolves an explicitly chosen model, strictly: failures escape as errors.
 * Used by surfaces that must honor the exact choice (the model test endpoint);
 * execution surfaces wrap it with tryResolveModel and fall back instead.
 */
export function resolveExplicitModel(userId: string, role: string, modelId: string): AiModelExecution {
  const model = getDb().select().from(aiModels).where(eq(aiModels.id, modelId)).get()
  const connection = model ? getDb().select().from(aiConnections).where(eq(aiConnections.id, model.connectionId)).get() : undefined
  if (!model || !connection || model.enabled !== 1) throw new AppError('AI_MODEL_UNAVAILABLE', 'The selected model is no longer available')
  if (connection.userId !== userId && connection.availability !== 'instance') {
    throw new AppError('AI_MODEL_UNAVAILABLE', 'The selected model is no longer available')
  }
  const baseUrl = connection.baseUrl?.trim() || AI_PROVIDER_MAP.get(connection.provider)?.defaultBaseUrl || undefined
  // A shared connection is authorized as a published resource; the caller never
  // gains endpoint rights they would not have for their own connection.
  if (connection.userId === userId && role === 'member' && baseUrl && !memberBaseUrlAllowed(connection.provider, baseUrl)) {
    throw new AppError('AI_NOT_ALLOWED', 'Members can only use the default provider endpoint')
  }
  const apiKey = decryptApiKey(connection.encryptedApiKey ?? undefined)
  if (requiresApiKey(connection.provider, baseUrl) && !apiKey) {
    throw new AppError('AI_NOT_CONFIGURED', 'This AI connection has no credential')
  }
  return {
    modelId: model.id,
    connectionId: connection.id,
    provider: connection.provider,
    protocol: AI_PROVIDER_MAP.get(connection.provider)!.protocol,
    baseUrl,
    apiKey,
    upstreamModelId: model.upstreamModelId,
    ...(model.capabilities ? { capabilities: model.capabilities } : {}),
    configuredByUser: true,
  }
}

/** Same as resolveExplicitModel but reports an unusable model as null. */
function tryResolveModel(userId: string, role: string, modelId: string): AiModelExecution | null {
  try {
    return resolveExplicitModel(userId, role, modelId)
  } catch (error) {
    // Authorization problems stay loud: silently serving a member from another
    // path would hide an endpoint policy change.
    if (error instanceof AppError && ['AI_MODEL_UNAVAILABLE', 'AI_NOT_CONFIGURED'].includes(error.code)) return null
    throw error
  }
}

/** First enabled, accessible, chat-capable model in creation order. */
function firstChatCapableModelId(userId: string): string | null {
  const rows = getDb().select({ model: aiModels })
    .from(aiModels).innerJoin(aiConnections, eq(aiModels.connectionId, aiConnections.id))
    .where(and(eq(aiModels.enabled, 1), or(eq(aiConnections.userId, userId), eq(aiConnections.availability, 'instance'))))
    .orderBy(asc(aiModels.createdAt)).all()
  for (const { model } of rows) {
    if (isAiEmbeddingModel({ id: model.upstreamModelId, name: model.name }) || model.capabilities?.embedding) continue
    return model.id
  }
  return null
}

/**
 * The single authorized resolver for every executable path. A stale explicit
 * choice (deleted, unpublished, disabled, unusable) counts as absent: the
 * surface's last-used model wins, then the first chat-capable model. Every
 * successful run records itself as the surface's last-used model.
 */
export function resolveAiExecution(userId: string, role: string, requestedModelId?: string | null, surface?: AiModelSurface): AiModelExecution {
  // A stale explicit choice (deleted, switched off or no longer shared) counts
  // as if it was never made: the chain below picks the model instead.
  if (requestedModelId) {
    const execution = tryResolveModel(userId, role, requestedModelId)
    if (execution) {
      if (surface) writeLastUsedModel(userId, surface, execution.modelId)
      return execution
    }
  }

  const lastUsed = surface ? readLastUsedModels(userId)[surface] : null
  if (lastUsed) {
    const execution = tryResolveModel(userId, role, lastUsed)
    if (execution && !execution.capabilities?.embedding && !isAiEmbeddingModel({ id: execution.upstreamModelId ?? '', name: execution.upstreamModelId ?? '' })) {
      if (surface) writeLastUsedModel(userId, surface, execution.modelId)
      return execution
    }
  }

  const firstModelId = firstChatCapableModelId(userId)
  if (firstModelId) {
    const execution = tryResolveModel(userId, role, firstModelId)
    if (execution) {
      if (surface) writeLastUsedModel(userId, surface, execution.modelId)
      return execution
    }
  }

  throw new AppError('AI_NOT_CONFIGURED', 'AI is not configured on this server')
}

/** Owner-facing execution view of a saved connection; used by discovery and saved-state tests. */
export function connectionExecution(userId: string, connectionId: string): AiModelExecution {
  const row = getOwnedConnection(userId, connectionId)
  const baseUrl = row.baseUrl?.trim() || AI_PROVIDER_MAP.get(row.provider)?.defaultBaseUrl || undefined
  const apiKey = decryptApiKey(row.encryptedApiKey ?? undefined)
  return {
    modelId: '',
    connectionId: row.id,
    provider: row.provider,
    protocol: AI_PROVIDER_MAP.get(row.provider)!.protocol,
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    configuredByUser: true,
  }
}

/** Chat and translation require a non-embedding model. */
export function assertChatCapable(execution: AiModelExecution) {
  if (execution.capabilities?.embedding) throw new AppError('VALIDATION_ERROR', 'This operation requires a chat model')
  const upstream = execution.upstreamModelId ?? ''
  if (isAiEmbeddingModel({ id: upstream, name: upstream })) throw new AppError('VALIDATION_ERROR', 'This operation requires a chat model')
}
