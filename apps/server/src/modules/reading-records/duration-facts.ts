import { and, eq } from 'drizzle-orm'

import type { ReadingRange } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { readingDurationFacts } from '../../db/schema'

export function getDurationFacts(userId: string, bookVersionId?: string) {
  return getDb().select().from(readingDurationFacts).where(and(
    eq(readingDurationFacts.userId, userId),
    bookVersionId ? eq(readingDurationFacts.bookVersionId, bookVersionId) : undefined,
  )).all()
}

export function aggregateDurationFacts(facts: ReturnType<typeof getDurationFacts>, range: ReadingRange = {}) {
  const daily = new Map<string, number>()
  const bookAdditive = new Map<string, number>()
  const bookReference = new Map<string, number>()
  const bookDaily = new Map<string, Map<string, number>>()
  const archiveAdditive = new Map<string, number>()
  const archiveReference = new Map<string, number>()
  const archiveDaily = new Map<string, Map<string, number>>()
  let additiveSeconds = 0
  let undatedAdditiveSeconds = 0
  let referenceSeconds = 0

  for (const fact of facts) {
    const isDay = fact.granularity === 'book_day' || fact.granularity === 'account_day'
    if (isDay && (!fact.date || range.from && fact.date < range.from || range.to && fact.date > range.to)) continue
    if (!isDay && (range.from || range.to)) continue

    if (fact.aggregationRole === 'reference') {
      referenceSeconds += fact.durationSeconds
      if (fact.bookVersionId) {
        archiveReference.set(fact.bookVersionId, (archiveReference.get(fact.bookVersionId) ?? 0) + fact.durationSeconds)
        if (fact.granularity === 'book_total') bookReference.set(fact.bookVersionId, (bookReference.get(fact.bookVersionId) ?? 0) + fact.durationSeconds)
      }
      continue
    }

    additiveSeconds += fact.durationSeconds
    if (!isDay) undatedAdditiveSeconds += fact.durationSeconds
    if (isDay && fact.date) daily.set(fact.date, (daily.get(fact.date) ?? 0) + fact.durationSeconds)
    if (fact.bookVersionId) {
      archiveAdditive.set(fact.bookVersionId, (archiveAdditive.get(fact.bookVersionId) ?? 0) + fact.durationSeconds)
      if (fact.granularity.startsWith('book_')) bookAdditive.set(fact.bookVersionId, (bookAdditive.get(fact.bookVersionId) ?? 0) + fact.durationSeconds)
      if (isDay && fact.date) {
        const archiveDates = archiveDaily.get(fact.bookVersionId) ?? new Map<string, number>()
        archiveDates.set(fact.date, (archiveDates.get(fact.date) ?? 0) + fact.durationSeconds)
        archiveDaily.set(fact.bookVersionId, archiveDates)
        if (!fact.granularity.startsWith('book_')) continue
        const dates = bookDaily.get(fact.bookVersionId) ?? new Map<string, number>()
        dates.set(fact.date, (dates.get(fact.date) ?? 0) + fact.durationSeconds)
        bookDaily.set(fact.bookVersionId, dates)
      }
    }
  }
  return { additiveSeconds, undatedAdditiveSeconds, referenceSeconds, daily, bookAdditive, bookReference, bookDaily, archiveAdditive, archiveReference, archiveDaily }
}

/** The one reading-day rule every stats surface shares: merge native and
 * imported seconds per date, then count the dates that reach 60 seconds.
 * Merging before the threshold keeps a day that only crosses it across
 * sources counted exactly once, the same on every page. */
export function countReadingDays(...dailies: Array<Map<string, number> | undefined>): number {
  const merged = new Map<string, number>()
  for (const daily of dailies) {
    if (!daily) continue
    for (const [date, seconds] of daily) merged.set(date, (merged.get(date) ?? 0) + seconds)
  }
  let days = 0
  for (const seconds of merged.values()) if (seconds >= 60) days++
  return days
}
