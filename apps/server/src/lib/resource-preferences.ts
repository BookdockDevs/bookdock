import { and, eq } from 'drizzle-orm'

import { getDb } from '../db/client'
import { settings } from '../db/schema'
import { createId } from './id'

/**
 * Personal consumption preferences for instance-published reading resources.
 * They live in the account's `settings` document so the publisher's definition
 * row is never rewritten by a consumer. Enabled: an explicit entry wins; a
 * missing entry falls back to the definition (own rows) or `false` (shared rows,
 * which are opt-in). Order: the saved order only permutes the ids it names, so
 * a list the user reordered never moves anything it does not show — other
 * users' rules, book-scoped rules and newly visible resources keep the
 * position their definition order gives them.
 */
export interface ResourcePreferences {
  enabled: Record<string, boolean>
  order: string[]
}

const EMPTY: ResourcePreferences = { enabled: {}, order: [] }

export function readResourcePreferences(userId: string | null, key: string): ResourcePreferences {
  if (!userId) return EMPTY
  const row = getDb().select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, key))).get()
  const value = row?.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY
  const raw = value as { enabled?: unknown; order?: unknown }
  const enabled: Record<string, boolean> = {}
  if (raw.enabled && typeof raw.enabled === 'object' && !Array.isArray(raw.enabled)) {
    for (const [id, flag] of Object.entries(raw.enabled)) {
      if (typeof flag === 'boolean') enabled[id] = flag
    }
  }
  const order = Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string') : []
  return { enabled, order }
}

export function writeResourcePreferences(userId: string, key: string, value: ResourcePreferences) {
  const next = { enabled: value.enabled, order: value.order }
  getDb().insert(settings).values({ id: createId('setting'), userId, key, value: next })
    .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value: next } }).run()
}

export function patchResourcePreference(
  userId: string,
  key: string,
  patch: { enabled?: Record<string, boolean>; order?: string[] },
) {
  const current = readResourcePreferences(userId, key)
  writeResourcePreferences(userId, key, {
    enabled: { ...current.enabled, ...patch.enabled },
    order: patch.order ?? current.order,
  })
}

/** Default for a shared definition is off; only the publisher keeps their own value. */
export function effectiveEnabled(preferences: ResourcePreferences, id: string, own: boolean, definitionEnabled: boolean) {
  const explicit = preferences.enabled[id]
  if (explicit !== undefined) return explicit
  return own ? definitionEnabled : false
}

/**
 * Definition order first, then the caller's saved order applied as a slot
 * permutation: a listed item takes the place it already occupied, in saved
 * order. Ids the list never showed — book-scoped rules, a publisher's rule
 * shared after the reorder, an id whose definition vanished — keep their own
 * position instead of being pushed to either end, which is what makes the same
 * personal order mean the same execution order on the Server and on a device
 * that only stores the rules it can see.
 */
export function orderResourceItems<T extends { id: string; createdAt: number }>(
  items: T[],
  preferences: ResourcePreferences,
  fallback: (item: T) => number,
): T[] {
  const base = [...items].sort((a, b) => fallback(a) - fallback(b) || a.createdAt - b.createdAt)
  if (preferences.order.length < 2) return base
  const rank = new Map(preferences.order.map((id, index) => [id, index]))
  const slots: number[] = []
  const listed: T[] = []
  base.forEach((item, index) => {
    if (!rank.has(item.id)) return
    slots.push(index)
    listed.push(item)
  })
  if (listed.length < 2) return base
  listed.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  const next = [...base]
  slots.forEach((slot, index) => { next[slot] = listed[index]! })
  return next
}

/**
 * A reorder payload must be exactly the caller's accessible set: a partial list
 * would silently drop ids the client did not render, and a foreign id would let
 * one account write another account's layout.
 */
export function isCompleteIdSet(ids: string[], accessibleIds: string[]) {
  const accessible = new Set(accessibleIds)
  return ids.length === accessible.size && new Set(ids).size === ids.length && ids.every((id) => accessible.has(id))
}
