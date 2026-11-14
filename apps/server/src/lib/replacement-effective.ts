import { and, asc, eq, isNull, ne, or } from 'drizzle-orm'

import { getDb } from '../db/client'
import { textReplacementOverrides, textReplacements } from '../db/schema'
import { orderResourceItems, readResourcePreferences } from './resource-preferences'

export const REPLACEMENT_PREFERENCE_KEY = 'replacements'

type ReplacementRow = typeof textReplacements.$inferSelect

/**
 * Every global pattern rule the caller may execute on this book: their own
 * rules plus instance-published rules from other accounts. Book-scoped patterns
 * and point patches never travel — those are personal by definition.
 *
 * The caller's own rows are returned unfiltered when no book is given, so the
 * settings manager can walk every rule it owns; the shared half is limited to
 * global patterns, because that is the only shape a publisher can share.
 */
export function loadReplacementRows(userId: string, bookId?: string): ReplacementRow[] {
  const db = getDb()
  const shared = and(
    ne(textReplacements.userId, userId),
    eq(textReplacements.availability, 'instance'),
    eq(textReplacements.matchType, 'pattern'),
    isNull(textReplacements.bookId),
  )
  const own = bookId
    ? and(
      eq(textReplacements.userId, userId),
      or(
        and(eq(textReplacements.matchType, 'pattern'), isNull(textReplacements.bookId)),
        eq(textReplacements.bookId, bookId),
      ),
    )
    : eq(textReplacements.userId, userId)
  // Shared rules are visible everywhere the caller can run them, including the
  // settings manager: a consumer has to be able to switch them on or off.
  return db.select().from(textReplacements).where(or(own, shared))
    .orderBy(asc(textReplacements.sortOrder), asc(textReplacements.createdAt)).all()
}

export function loadReplacementOverrides(userId: string, bookId: string) {
  const rows = getDb().select().from(textReplacementOverrides).where(
    and(eq(textReplacementOverrides.userId, userId), eq(textReplacementOverrides.bookId, bookId)),
  ).all()
  return new Map(rows.map((override) => [override.replacementId, override]))
}

/**
 * Account-global state first, then the per-book override. A shared rule is
 * opt-in: without an explicit personal choice it does not run for anyone but
 * its publisher.
 */
export function resolveReplacementEnabled(
  userId: string,
  row: Pick<ReplacementRow, 'id' | 'userId' | 'enabled'>,
  preferences = readResourcePreferences(userId, REPLACEMENT_PREFERENCE_KEY),
) {
  const explicit = preferences.enabled[row.id]
  if (explicit !== undefined) return explicit
  return row.userId === userId ? row.enabled === 1 : false
}

/** One deterministic execution order across personal and shared global rules. */
export function orderReplacementRows(userId: string, rows: ReplacementRow[]) {
  const preferences = readResourcePreferences(userId, REPLACEMENT_PREFERENCE_KEY)
  return orderResourceItems(rows, preferences, (row) => row.sortOrder)
}
