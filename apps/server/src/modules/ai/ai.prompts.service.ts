import { and, eq, isNull, or, sql } from 'drizzle-orm'

import type { AiPromptCreateReq, AiPromptReorderReq, AiPromptScope, AiPromptTemplate, AiPromptUpdateReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { aiPrompts, settings } from '../../db/schema'
import { createId } from '../../lib/id'
import { assertCanPublish } from '../../lib/publish-permission'
import { effectiveEnabled, isCompleteIdSet, orderResourceItems, patchResourcePreference, readResourcePreferences } from '../../lib/resource-preferences'
import { AppError } from '../../middleware/error'

type PromptRow = typeof aiPrompts.$inferSelect

export const AI_PROMPT_PREFERENCE_KEY = 'aiPrompts'
/** Records that an account has been seeded, so deleting every command sticks. */
const SEEDED_KEY = 'aiPromptSeeded'

interface SeedPrompt {
  seedKey: string
  name: string
  prompt: string
  scope: AiPromptScope
  order: number
}

/**
 * Built-in quick commands. `seedKey` is the stable identity: restore-defaults
 * upserts on it and the migration recognizes the previous built-ins by it, so
 * repeated boots or upgrades never generate a second copy.
 */
const SEED_PROMPTS: readonly SeedPrompt[] = [
  { seedKey: 'explain-selection', name: '解释这段', prompt: '请解释以下内容，并说明其中的关键概念和隐含信息。\n\n内容：\n{SELTEXT}', scope: 'selection', order: 10 },
  { seedKey: 'translate-selection', name: '翻译这段', prompt: '请翻译以下内容；处理好指代、语气和专有名词，保留原意，不要擅自补充信息。\n\n待翻译内容：\n{SELTEXT}', scope: 'selection', order: 20 },
  { seedKey: 'summarize-selection', name: '概括这段', prompt: '请概括以下内容，提炼主要信息和关键细节；只根据提供的内容回答，不要补充未出现的事实。\n\n内容：\n{SELTEXT}', scope: 'selection', order: 30 },
  { seedKey: 'questions-selection', name: '提出问题', prompt: '请围绕以下内容提出 3—5 个有助于理解和思考的问题，并简要说明每个问题关注的文本线索。\n\n内容：\n{SELTEXT}', scope: 'selection', order: 40 },
  { seedKey: 'summarize-chapter', name: '总结当前章节', prompt: '请根据下面提供的当前章节正文，梳理主要情节、人物关系和关键线索；只依据这段正文回答，不要补充未提供的内容。\n\n当前章节正文：\n{CHAPTER}', scope: 'reading', order: 50 },
]

const SEED_KEYS = new Set(SEED_PROMPTS.map((prompt) => prompt.seedKey))

function hasSeeded(userId: string): boolean {
  return getDb().select({ id: settings.id }).from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, SEEDED_KEY))).get() !== undefined
}

function markSeeded(userId: string) {
  getDb().insert(settings).values({ id: createId('setting'), userId, key: SEEDED_KEY, value: 1 }).onConflictDoNothing().run()
}

function insertSeeds(userId: string) {
  const now = Date.now()
  getDb().insert(aiPrompts).values(SEED_PROMPTS.map((seed, index) => ({
    id: createId('aiprompt'),
    userId,
    seedKey: seed.seedKey,
    name: seed.name,
    prompt: seed.prompt,
    scope: seed.scope,
    enabled: 1,
    sortOrder: seed.order,
    availability: 'user' as const,
    createdAt: now + index,
    updatedAt: now + index,
  }))).run()
}

/** Built-in presets are installed once per account; delete-all afterwards stays empty. */
export function ensureAiPromptSeeds(userId: string) {
  if (hasSeeded(userId)) return
  const existing = getDb().select({ id: aiPrompts.id }).from(aiPrompts).where(eq(aiPrompts.userId, userId)).get()
  if (!existing) insertSeeds(userId)
  markSeeded(userId)
}

function toRes(row: PromptRow, userId: string, preferences = readResourcePreferences(userId, AI_PROMPT_PREFERENCE_KEY), order = row.sortOrder): AiPromptTemplate {
  const mine = row.userId === userId
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    scope: row.scope,
    enabled: effectiveEnabled(preferences, row.id, mine, row.enabled === 1),
    order,
    builtIn: row.seedKey !== null,
    availability: row.availability,
    mine,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Own definitions plus instance-published ones. Another account's built-in
 * preset is that account's own copy of a preset the caller already has, so it
 * is never treated as a shared definition.
 */
function accessibleRows(userId: string): PromptRow[] {
  return getDb().select().from(aiPrompts).where(
    and(
      or(eq(aiPrompts.userId, userId), eq(aiPrompts.availability, 'instance')),
      or(eq(aiPrompts.userId, userId), isNull(aiPrompts.seedKey)),
    ),
  ).orderBy(aiPrompts.sortOrder, aiPrompts.createdAt).all()
}

/**
 * Every command the caller can see, in the caller's own order. `order` is the
 * effective position so a shared command inserted before the reorder never
 * displaces the layout the user saved.
 */
export function listAiPrompts(userId: string): AiPromptTemplate[] {
  ensureAiPromptSeeds(userId)
  const preferences = readResourcePreferences(userId, AI_PROMPT_PREFERENCE_KEY)
  const ordered = orderResourceItems(accessibleRows(userId), preferences, (row) => row.sortOrder)
  return ordered.map((row, index) => toRes(row, userId, preferences, (index + 1) * 10))
}

/** Executable list for the quick-command pickers: only the caller's enabled commands. */
export function effectiveAiPrompts(userId: string): AiPromptTemplate[] {
  return listAiPrompts(userId).filter((prompt) => prompt.enabled)
}

/**
 * Resolves the quick command a request names against the current definition and
 * the caller's own effective list. A command that was unshared, deleted or
 * switched off is an error: the request must not replay a cached copy of the
 * text the client last saw.
 */
export function resolveAiPromptForExecution(userId: string, promptId: string): PromptRow {
  const row = getDb().select().from(aiPrompts).where(eq(aiPrompts.id, promptId)).get()
  if (!row) throw new AppError('AI_PROMPT_UNAVAILABLE', 'This quick command is no longer available')
  const visible = effectiveAiPrompts(userId).some((prompt) => prompt.id === row.id)
  if (!visible) throw new AppError('AI_PROMPT_UNAVAILABLE', 'This quick command is no longer available')
  return row
}

function getOwnedPrompt(userId: string, promptId: string): PromptRow {
  const row = getDb().select().from(aiPrompts).where(eq(aiPrompts.id, promptId)).get()
  if (!row || row.userId !== userId) throw new AppError('AI_PROMPT_NOT_FOUND', 'Quick command not found')
  return row
}

function nextSortOrder(userId: string): number {
  const max = getDb().select({ max: sql<number | null>`max(${aiPrompts.sortOrder})` }).from(aiPrompts).where(eq(aiPrompts.userId, userId)).get()?.max ?? 0
  return max + 10
}

function insertOwnPrompt(userId: string, input: { name: string; prompt: string; scope?: AiPromptScope; enabled?: boolean; availability?: 'user' | 'instance' }, sortOrder: number): PromptRow {
  const now = Date.now()
  const row: PromptRow = {
    id: createId('aiprompt'),
    userId,
    seedKey: null,
    name: input.name.trim().slice(0, 80),
    prompt: input.prompt.trim().slice(0, 20_000),
    scope: input.scope ?? 'both',
    enabled: input.enabled === false ? 0 : 1,
    sortOrder,
    availability: input.availability ?? 'user',
    createdAt: now,
    updatedAt: now,
  }
  getDb().insert(aiPrompts).values(row).run()
  return row
}

export function createAiPrompt(userId: string, role: string, input: AiPromptCreateReq): AiPromptTemplate {
  assertCanPublish(role, input.availability)
  const row = insertOwnPrompt(userId, input, nextSortOrder(userId))
  return toRes(row, userId)
}

export function updateAiPrompt(userId: string, role: string, promptId: string, input: AiPromptUpdateReq): AiPromptTemplate {
  const existing = getDb().select().from(aiPrompts).where(eq(aiPrompts.id, promptId)).get()
  if (!existing) throw new AppError('AI_PROMPT_NOT_FOUND', 'Quick command not found')
  if (existing.userId !== userId) {
    // A consumer only flips their own switch; the definition and its
    // publication state stay with the publisher.
    if (existing.availability !== 'instance') throw new AppError('AI_PROMPT_NOT_FOUND', 'Quick command not found')
    if (Object.keys(input).some((key) => key !== 'enabled') || input.enabled === undefined) {
      throw new AppError('FORBIDDEN', 'Only the publisher can edit a shared quick command')
    }
    patchResourcePreference(userId, AI_PROMPT_PREFERENCE_KEY, { enabled: { [promptId]: input.enabled } })
    return toRes(existing, userId)
  }

  assertCanPublish(role, input.availability)
  const patch: Partial<PromptRow> = { updatedAt: Date.now() }
  if (input.name !== undefined) patch.name = input.name.trim().slice(0, 80)
  if (input.prompt !== undefined) patch.prompt = input.prompt.trim().slice(0, 2_000)
  if (input.scope !== undefined) patch.scope = input.scope
  if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0
  if (input.availability !== undefined) {
    // Every account already has its own copy of a built-in preset, so publishing
    // one only duplicates it — and a later restore-defaults would silently
    // rewrite a definition other accounts are running.
    if (input.availability === 'instance' && existing.seedKey !== null) {
      throw new AppError('VALIDATION_ERROR', 'Built-in quick commands cannot be published')
    }
    patch.availability = input.availability
  }
  // A built-in row published by an earlier build falls back to private on its
  // next save, because it no longer has a control to undo that.
  if (existing.seedKey !== null && existing.availability === 'instance') patch.availability = 'user'

  getDb().transaction((tx) => {
    tx.update(aiPrompts).set(patch).where(eq(aiPrompts.id, promptId)).run()
    if (input.enabled !== undefined) patchResourcePreference(userId, AI_PROMPT_PREFERENCE_KEY, { enabled: { [promptId]: input.enabled } })
  })
  return toRes(getDb().select().from(aiPrompts).where(eq(aiPrompts.id, promptId)).get()!, userId)
}

export function deleteAiPrompt(userId: string, promptId: string) {
  getOwnedPrompt(userId, promptId)
  getDb().delete(aiPrompts).where(eq(aiPrompts.id, promptId)).run()
}

/** Reorder the caller's whole visible list; only the personal order changes. */
export function reorderAiPrompts(userId: string, input: AiPromptReorderReq): AiPromptTemplate[] {
  const accessibleIds = accessibleRows(userId).map((row) => row.id)
  if (!isCompleteIdSet(input.ids, accessibleIds)) throw new AppError('AI_PROMPT_NOT_FOUND', 'Quick command not found')
  patchResourcePreference(userId, AI_PROMPT_PREFERENCE_KEY, { order: input.ids })
  return listAiPrompts(userId)
}

/**
 * Restores only the missing built-in presets, mirroring the TOC rule restore:
 * edits to seeded commands and the caller's custom commands are kept, so the
 * operation never destroys anything and needs no confirmation.
 */
export function restoreAiPrompts(userId: string): AiPromptTemplate[] {
  const db = getDb()
  const now = Date.now()
  db.transaction((tx) => {
    const existingSeedKeys = new Set(
      tx.select({ seedKey: aiPrompts.seedKey }).from(aiPrompts)
        .where(eq(aiPrompts.userId, userId)).all()
        .map((row) => row.seedKey)
        .filter((key) => key !== null),
    )
    const missing = SEED_PROMPTS.filter((seed) => !existingSeedKeys.has(seed.seedKey))
    if (missing.length === 0) return
    const maxOrder = tx.select({ max: sql<number>`max(${aiPrompts.sortOrder})` }).from(aiPrompts)
      .where(eq(aiPrompts.userId, userId)).get()?.max ?? 0
    tx.insert(aiPrompts).values(missing.map((seed, index) => ({
      id: createId('aiprompt'),
      userId,
      seedKey: seed.seedKey,
      name: seed.name,
      prompt: seed.prompt,
      scope: seed.scope,
      enabled: 1,
      sortOrder: maxOrder + 1 + index,
      availability: 'user' as const,
      createdAt: now,
      updatedAt: now,
    }))).run()
  })
  return listAiPrompts(userId)
}

/** True when at least one built-in preset is missing, so restore would add it. */
export function aiPromptsRestoreAvailable(userId: string): boolean {
  const seedKeys = getDb().select({ seedKey: aiPrompts.seedKey }).from(aiPrompts)
    .where(eq(aiPrompts.userId, userId)).all().map((row) => row.seedKey)
  const existing = new Set(seedKeys.filter((key) => key !== null))
  return SEED_PROMPTS.some((seed) => !existing.has(seed.seedKey))
}

/** True for the legacy ids of the built-in presets, used by the boot conversion. */
export function isBuiltInPromptSeed(id: string): boolean {
  return SEED_KEYS.has(id)
}