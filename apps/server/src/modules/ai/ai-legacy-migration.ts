import { createHash } from 'node:crypto'

import { eq, inArray } from 'drizzle-orm'

import type { AiModelCapabilities, AiProvider } from '@bookdock/shared'

import type { getDb } from '../../db/client'
import { aiConnections, aiModels, settings } from '../../db/schema'
import { AI_PROVIDER_MAP, normalizeProvider } from './ai.providers'

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * One release upgrade for AI persistence: legacy account settings carried a
 * bounded list of profiles that bundled credentials, discovered models and a
 * selected model, plus a translation preference that pointed at one of them.
 * The new shape splits that into `ai_connections` / `ai_models` rows, so the
 * conversion has to materialize rows and rewrite both settings documents in one
 * transaction.
 *
 * It runs on every boot and is idempotent: a converted document no longer has
 * `profiles`, and every generated id is derived from `(user, profile, upstream
 * model)`, so a retried upgrade converges instead of duplicating rows.
 */

interface LegacyModelEntry {
  id: string
  name: string
  capabilities?: AiModelCapabilities
}

const MAX_LEGACY_PROFILES = 20
const MAX_LEGACY_MODELS = 200

function legacyKey(userId: string, profileId: string, upstreamModelId: string) {
  return `${userId}\u0000${profileId}\u0000${upstreamModelId}`
}

function derivedModelId(key: string) {
  return `ai-model_${createHash('sha256').update(key).digest('hex').slice(0, 21)}`
}

function derivedConnectionId(key: string) {
  return `ai-connection_${createHash('sha256').update(key).digest('hex').slice(0, 21)}`
}

function timestamp(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

function capabilitiesOf(value: unknown): AiModelCapabilities | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const capabilities: AiModelCapabilities = {
    ...(raw.vision === true ? { vision: true } : {}),
    ...(raw.tools === true ? { tools: true } : {}),
    ...(raw.reasoning === true ? { reasoning: true } : {}),
    ...(raw.embedding === true ? { embedding: true } : {}),
  }
  return Object.keys(capabilities).length ? capabilities : undefined
}

function legacyModelEntries(value: unknown): LegacyModelEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 200) : ''
    if (!id) return []
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : id
    const capabilities = capabilitiesOf(raw.capabilities)
    return [{ id, name, ...(capabilities ? { capabilities } : {}) }]
  })
}

function isLegacyAiDocument(value: unknown) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as Record<string, unknown>).profiles)
}

function isLegacyTranslationDocument(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const channel = (value as Record<string, unknown>).channel
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) return false
  const raw = channel as Record<string, unknown>
  return Object.hasOwn(raw, 'profileId') || Object.hasOwn(raw, 'model')
}

interface ConversionMaps {
  /** `(user, profile, upstream model)` -> internal model id. */
  models: Map<string, string>
  /** `(user, profile)` -> the model that profile had selected. */
  selected: Map<string, string>
  /** Legacy active profile per user, for translation rows without a profile. */
  active: Map<string, string>
}

/**
 * Reuses the legacy profile id as the connection id when free. A profile id
 * already owned by another account falls back to a derived id so the data is
 * never dropped or attributed to the wrong user.
 */
function ensureConnection(tx: Tx, userId: string, profileId: string, profile: Record<string, unknown>) {
  const provider: AiProvider = normalizeProvider(profile.provider)
  for (const id of [profileId, derivedConnectionId(`${userId}\u0000${profileId}`)]) {
    const existing = tx.select().from(aiConnections).where(eq(aiConnections.id, id)).get()
    if (existing) {
      if (existing.userId === userId) return id
      continue
    }
    const baseUrl = typeof profile.baseUrl === 'string' && profile.baseUrl.trim() ? profile.baseUrl.trim() : null
    const name = typeof profile.name === 'string' && profile.name.trim()
      ? profile.name.trim().slice(0, 100)
      : AI_PROVIDER_MAP.get(provider)?.name ?? provider
    const createdAt = timestamp(profile.createdAt, Date.now())
    tx.insert(aiConnections).values({
      id,
      userId,
      name,
      provider,
      baseUrl,
      encryptedApiKey: typeof profile.encryptedApiKey === 'string' && profile.encryptedApiKey ? profile.encryptedApiKey : null,
      availability: 'user',
      createdAt,
      updatedAt: timestamp(profile.updatedAt, createdAt),
    }).run()
    return id
  }
  return null
}

function convertAiDocument(tx: Tx, row: typeof settings.$inferSelect, maps: ConversionMaps) {
  const value = { ...(row.value as Record<string, unknown>) }
  const profiles = (Array.isArray(value.profiles) ? value.profiles : []).slice(0, MAX_LEGACY_PROFILES)
  const activeId = typeof value.activeProfileId === 'string' ? value.activeProfileId.trim() : ''
  const now = Date.now()

  profiles.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const profile = raw as Record<string, unknown>
    const profileId = typeof profile.id === 'string' ? profile.id.trim() : ''
    if (!profileId) return
    const connectionId = ensureConnection(tx, row.userId, profileId, profile)
    if (!connectionId) return

    const provider = normalizeProvider(profile.provider)
    const catalog = AI_PROVIDER_MAP.get(provider)
    const entries = new Map<string, LegacyModelEntry>()
    for (const entry of [...legacyModelEntries(profile.models), ...legacyModelEntries(profile.embeddingModels)]) {
      if (!entries.has(entry.id) && entries.size < MAX_LEGACY_MODELS) entries.set(entry.id, entry)
    }
    const selectedUpstream = typeof profile.model === 'string' && profile.model.trim()
      ? profile.model.trim().slice(0, 200)
      : catalog?.defaultModel ?? null
    const embeddingUpstream = typeof profile.embeddingModel === 'string' && profile.embeddingModel.trim()
      ? profile.embeddingModel.trim().slice(0, 200)
      : null
    // The old resolver fell back to the provider's default model, so the
    // configured model is materialized even when discovery never listed it.
    for (const upstream of [selectedUpstream, embeddingUpstream]) {
      if (upstream && !entries.has(upstream)) entries.set(upstream, { id: upstream, name: upstream })
    }

    const createdAt = timestamp(profile.createdAt, now + index)
    let sequence = 0
    for (const entry of entries.values()) {
      const key = legacyKey(row.userId, profileId, entry.id)
      const modelId = derivedModelId(key)
      maps.models.set(key, modelId)
      const exists = tx.select({ id: aiModels.id }).from(aiModels).where(eq(aiModels.id, modelId)).get()
      if (!exists) {
        tx.insert(aiModels).values({
          id: modelId,
          connectionId,
          upstreamModelId: entry.id,
          name: entry.name,
          enabled: 1,
          capabilities: entry.capabilities ?? null,
          createdAt: createdAt + sequence,
          updatedAt: createdAt + sequence,
        }).run()
      }
      sequence += 1
    }

    if (selectedUpstream) {
      const selected = maps.models.get(legacyKey(row.userId, profileId, selectedUpstream))
      if (selected) maps.selected.set(`${row.userId}\u0000${profileId}`, selected)
    }
  })

  const activeProfileId = activeId || (typeof profiles[0] === 'object' && profiles[0] ? String((profiles[0] as Record<string, unknown>).id ?? '') : '')
  if (activeProfileId) maps.active.set(row.userId, activeProfileId)

  // The legacy "default model" concept is retired; the resolver now remembers
  // the last-used model per surface, so nothing is written for it here.
  delete value.profiles
  delete value.activeProfileId
  tx.update(settings).set({ value }).where(eq(settings.id, row.id)).run()
}

function convertTranslationDocument(tx: Tx, row: typeof settings.$inferSelect, maps: ConversionMaps) {
  const value = { ...(row.value as Record<string, unknown>) }
  const channel = value.channel && typeof value.channel === 'object' && !Array.isArray(value.channel)
    ? { ...(value.channel as Record<string, unknown>) }
    : {}
  const legacyProfileId = typeof channel.profileId === 'string' && channel.profileId.trim() ? channel.profileId.trim() : null
  const legacyModel = typeof channel.model === 'string' && channel.model.trim() ? channel.model.trim().slice(0, 200) : null
  const profileId = legacyProfileId ?? maps.active.get(row.userId) ?? null
  const modelId = legacyModel && profileId
    ? maps.models.get(legacyKey(row.userId, profileId, legacyModel)) ?? null
    : profileId
      ? maps.selected.get(`${row.userId}\u0000${profileId}`) ?? null
      : null
  value.channel = { kind: 'ai', modelId }
  tx.update(settings).set({ value }).where(eq(settings.id, row.id)).run()
}

export function migrateLegacyAiSettings(db: Db) {
  const rows = db.select().from(settings).where(inArray(settings.key, ['ai', 'translation'])).all()
  const aiRows = rows.filter((row) => row.key === 'ai' && isLegacyAiDocument(row.value))
  const translationRows = rows.filter((row) => row.key === 'translation' && isLegacyTranslationDocument(row.value))
  if (aiRows.length === 0 && translationRows.length === 0) return

  const maps: ConversionMaps = { models: new Map(), selected: new Map(), active: new Map() }
  db.transaction((tx) => {
    for (const row of aiRows) convertAiDocument(tx, row, maps)
    for (const row of translationRows) convertTranslationDocument(tx, row, maps)
  })
}
