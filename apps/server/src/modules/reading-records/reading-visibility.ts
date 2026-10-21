import type { getDb } from '../../db/client'
import { pendingBookDataDeletionVersionIds } from '../libraries/library-query'
import { readingHoldings } from './reading-holdings'

export function excludedReadingBookVersionIds(db: ReturnType<typeof getDb>, userId: string, showHidden = false): string[] {
  return [...new Set([
    ...pendingBookDataDeletionVersionIds(db, userId),
    ...readingHoldings(db, userId, showHidden).filter((row) => row.excluded).map((row) => row.bookVersionId),
  ])]
}

export function hiddenBookVersionIds(db: ReturnType<typeof getDb>, userId: string): string[] {
  return readingHoldings(db, userId).filter((row) => row.excluded).map((row) => row.bookVersionId)
}
