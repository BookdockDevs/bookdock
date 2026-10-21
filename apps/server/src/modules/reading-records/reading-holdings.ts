import { or, sql } from 'drizzle-orm'

import type { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookVersions, libraryMemberships } from '../../db/schema'
import { sharedLibraryManagerCondition, sharedVersionAccessConditions } from '../libraries/library-access'
import { loadLibraryHiddenTaxonomy, workHiddenExclusion } from '../libraries/library-query'

export interface ReadingHolding {
  bookVersionId: string
  libraryBookId: string
  libraryId: string
  categoryId: string | null
  excluded: number
}

/** Private cards win even when hidden or empty; visible shared alternatives rank first. */
export function readingHoldings(db: ReturnType<typeof getDb>, userId: string, showHidden = false): ReadingHolding[] {
  const libraryRows = db.select({ id: libraries.id }).from(libraries).all()
  if (libraryRows.length === 0) return []
  const visible = or(...libraryRows.map(({ id }) => sql`(
    ${libraryBooks.libraryId} = ${id} AND ${workHiddenExclusion(loadLibraryHiddenTaxonomy(db, id))}
  )`))!
  const manager = sharedLibraryManagerCondition(userId)
  // Reveal never makes a hidden member listing or an unlisted version readable.
  const eligible = showHidden
    ? sql`(${libraries.type} = 'private' OR ${manager} OR ${visible})`
    : visible
  return db.all<ReadingHolding>(sql`
    WITH holding_candidates AS (
      SELECT ${libraryBookVersions.bookVersionId} AS bookVersionId,
        ${libraryBooks.id} AS libraryBookId, ${libraries.id} AS libraryId,
        ${libraryBooks.categoryId} AS categoryId,
        CASE WHEN ${libraries.type} = 'private' THEN 0 ELSE 1 END AS priority,
        CASE WHEN ${eligible} THEN 0 ELSE 1 END AS excluded,
        CASE WHEN ${libraries.userId} = ${userId} THEN ${libraries.createdAt}
          ELSE coalesce((SELECT min(joined.created_at) FROM ${libraryMemberships} joined
            WHERE joined.library_id = ${libraries.id} AND joined.user_id = ${userId}), ${libraries.createdAt})
        END AS joinedAt,
        ${libraries.createdAt} AS libraryCreatedAt, ${libraryBookVersions.id} AS linkId
      FROM ${libraryBookVersions}
      INNER JOIN ${libraryBooks} ON ${libraryBooks.id} = ${libraryBookVersions.libraryBookId}
        AND ${libraryBooks.libraryId} = ${libraryBookVersions.libraryId}
      INNER JOIN ${libraries} ON ${libraries.id} = ${libraryBooks.libraryId}
      WHERE ${libraryBooks.deletedAt} IS NULL AND (
        (${libraries.type} = 'private' AND ${libraries.userId} = ${userId} AND ${libraryBooks.userId} = ${userId})
        OR (${sharedVersionAccessConditions(userId)})
      )
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY bookVersionId ORDER BY
        priority, excluded, joinedAt, libraryCreatedAt, libraryId, libraryBookId, linkId) AS position
      FROM holding_candidates
    )
    SELECT bookVersionId, libraryBookId, libraryId, categoryId, excluded FROM ranked WHERE position = 1
  `)
}
