import { createHash } from 'node:crypto'

import { eq } from 'drizzle-orm'

import type { AiPromptScope } from '@bookdock/shared'

import type { getDb } from '../../db/client'
import { aiPrompts, settings } from '../../db/schema'
import { createId } from '../../lib/id'
import { isBuiltInPromptSeed } from './ai.prompts.service'

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const AI_SETTINGS_KEY = 'ai'
const SEEDED_KEY = 'aiPromptSeeded'
const MAX_LEGACY_PROMPTS = 24

interface LegacyPrompt {
  id: string
  name: string
  prompt: string
  scope: AiPromptScope
  enabled: boolean
  order: number
}

/**
 * Quick commands used to live in one array inside the personal `ai` settings
 * document. They are now definition rows with an owner, so the upgrade has to
 * materialize a row per entry and drop the array from the document — otherwise
 * the same command would live in two places with two writers.
 *
 * The conversion runs on every boot and is idempotent: a converted document no
 * longer carries `prompts`, and a generated id is derived from
 * `(user, legacy id)`, so a retried upgrade converges instead of duplicating.
 */

function derivedPromptId(userId: string, legacyId: string) {
  return `aiprompt_${createHash('sha256').update(`${userId}\u0000${legacyId}`).digest('hex').slice(0, 21)}`
}

function scopeOf(value: unknown): AiPromptScope {
  return value === 'selection' || value === 'reading' || value === 'both' ? value : 'both'
}

function legacyPrompts(value: unknown): LegacyPrompt[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const prompts: LegacyPrompt[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 100) : ''
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 80) : ''
    const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim().slice(0, 2_000) : ''
    if (!id || !name || !prompt || seen.has(id)) continue
    seen.add(id)
    prompts.push({
      id,
      name,
      prompt,
      scope: scopeOf(raw.scope),
      enabled: raw.enabled !== false,
      order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? Math.trunc(raw.order) : prompts.length * 10,
    })
    if (prompts.length >= MAX_LEGACY_PROMPTS) break
  }
  return prompts
}

function isLegacyPromptDocument(value: unknown) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray((value as Record<string, unknown>).prompts)
}

/**
 * Reuses the legacy id when it is still free so an upgraded account keeps the
 * identifiers its client already knew (including the built-in ids). A collision
 * with another account falls back to a derived id: the command is never dropped
 * and never attributed to the wrong owner.
 */
function promptRowId(tx: Tx, userId: string, legacyId: string): string {
  for (const id of [legacyId, derivedPromptId(userId, legacyId)]) {
    const existing = tx.select({ userId: aiPrompts.userId }).from(aiPrompts).where(eq(aiPrompts.id, id)).get()
    if (!existing || existing.userId === userId) return id
  }
  return derivedPromptId(userId, legacyId)
}

function convertPromptDocument(tx: Tx, row: typeof settings.$inferSelect) {
  const value = { ...(row.value as Record<string, unknown>) }
  const prompts = legacyPrompts(value.prompts)
  const now = Date.now()
  // The array was the only store for these commands, so the rows owned by this
  // account are exactly what is being materialized.
  tx.delete(aiPrompts).where(eq(aiPrompts.userId, row.userId)).run()
  if (prompts.length > 0) {
    tx.insert(aiPrompts).values(prompts.map((prompt, index) => ({
      id: promptRowId(tx, row.userId, prompt.id),
      userId: row.userId,
      seedKey: isBuiltInPromptSeed(prompt.id) ? prompt.id : null,
      name: prompt.name,
      prompt: prompt.prompt,
      scope: prompt.scope,
      enabled: prompt.enabled ? 1 : 0,
      sortOrder: prompt.order,
      availability: 'user' as const,
      createdAt: now + index,
      updatedAt: now + index,
    }))).run()
  }
  delete value.prompts
  tx.update(settings).set({ value }).where(eq(settings.id, row.id)).run()
  // Keeps an explicitly emptied command list empty instead of seeding presets
  // on the next read.
  tx.insert(settings).values({ id: createId('setting'), userId: row.userId, key: SEEDED_KEY, value: 1 })
    .onConflictDoNothing().run()
}

export function migrateLegacyAiPrompts(db: Db) {
  const rows = db.select().from(settings).where(eq(settings.key, AI_SETTINGS_KEY)).all()
    .filter((row) => isLegacyPromptDocument(row.value))
  if (rows.length === 0) return
  db.transaction((tx) => {
    for (const row of rows) convertPromptDocument(tx, row)
  })
}
