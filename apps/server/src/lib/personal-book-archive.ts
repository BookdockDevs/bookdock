import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { BookFormat } from '@bookdock/shared'

import type { getDb } from '../db/client'
import {
  bookReviews,
  bookVersions,
  contentFiles,
  ideas,
  libraryBooks,
  libraryBookVersions,
  readingArchives,
  readingImportBindings,
} from '../db/schema'
import { recordActivityEvent } from './activity-events'

type Db = ReturnType<typeof getDb>

interface PersonalBookSnapshot {
  title: string
  author: string
  format: BookFormat
  coverKey: string | null
}

/**
 * Databases older than the personal tables hold no personal data to retain, so
 * the snapshot is skipped instead of failing the surrounding deletion.
 */
function hasTable(db: Db, table: string): boolean {
  return (db.all<{ n: number }>(sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ${table}`)[0]?.n ?? 0) > 0
}

function hasColumn(db: Db, table: string, column: string): boolean {
  return db.all<{ name: string }>(sql.raw(`PRAGMA table_info("${table}")`)).some((row) => row.name === column)
}

export function savePersonalBookSnapshot(db: Db, userId: string, bookVersionId: string, book: PersonalBookSnapshot) {
  if (!hasTable(db, 'reading_archives')) return
  // A mounted import whose book is deleted keeps its records on the snapshot
  // (same bookVersionId). Stamping the import identity here lets a later mount
  // of the snapshot re-point the binding at the next target — without it,
  // mountArchive sees a native archive and silently strands the binding on the
  // deleted book. Guarded: pre-0060 databases have no bindings table.
  const identity = hasTable(db, 'reading_import_bindings')
    ? db.select({
      source: readingImportBindings.source,
      accountKey: readingImportBindings.accountKey,
      bookKey: readingImportBindings.bookKey,
    }).from(readingImportBindings).where(and(
      eq(readingImportBindings.userId, userId),
      eq(readingImportBindings.mode, 'mounted'),
      eq(readingImportBindings.targetBookVersionId, bookVersionId),
    )).get()
    : undefined
  const importIdentity = identity
    ? { importSource: identity.source, importAccountKey: identity.accountKey, importBookKey: identity.bookKey }
    : {}
  const now = Date.now()
  db.insert(readingArchives).values({
    userId, bookVersionId, title: book.title, author: book.author, format: book.format, coverKey: book.coverKey,
    ...importIdentity,
    createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({ target: [readingArchives.userId, readingArchives.bookVersionId], set: {
    title: book.title, author: book.author, format: book.format, coverKey: book.coverKey,
    ...importIdentity,
  } }).run()
}

export function capturePrivateArchiveSnapshots(db: Db, versionIds: string[]) {
  if (versionIds.length === 0 || !hasTable(db, 'reading_archives')) return
  const hasReviews = hasTable(db, 'book_reviews')
  // Duration facts have no book FK (0060): mounting an import moves them onto
  // the real book, so they alone must keep the title snapshot alive.
  const hasDurationFacts = hasTable(db, 'reading_duration_facts')
  const personalData = [
    sql`SELECT 1 FROM reading_archives WHERE user_id = ${libraryBooks.userId} AND book_version_id = ${bookVersions.id}`,
    sql`SELECT 1 FROM highlights WHERE user_id = ${libraryBooks.userId} AND book_version_id = ${bookVersions.id}`,
    sql`SELECT 1 FROM bookmarks WHERE user_id = ${libraryBooks.userId} AND book_version_id = ${bookVersions.id}`,
    sql`SELECT 1 FROM ideas WHERE user_id = ${libraryBooks.userId} AND book_version_id = ${bookVersions.id}`,
  ]
  if (hasReviews) {
    personalData.push(sql`SELECT 1 FROM book_reviews WHERE user_id = ${libraryBooks.userId} AND (read_book_version_id = ${bookVersions.id} OR private_library_book_id = ${libraryBooks.id})`)
  }
  if (hasDurationFacts) {
    personalData.push(sql`SELECT 1 FROM reading_duration_facts WHERE user_id = ${libraryBooks.userId} AND book_version_id = ${bookVersions.id}`)
  }
  const cards = db.select({ userId: libraryBooks.userId, workId: libraryBooks.id, versionId: libraryBookVersions.bookVersionId,
    title: sql<string>`coalesce(${libraryBookVersions.title}, ${libraryBooks.title})`,
    author: sql<string>`coalesce(${libraryBookVersions.author}, ${libraryBooks.author})`,
    coverKey: sql<string | null>`coalesce(${libraryBookVersions.coverKey}, ${libraryBooks.coverKey})`, format: bookVersions.format,
  }).from(libraryBookVersions)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .innerJoin(bookVersions, eq(bookVersions.id, libraryBookVersions.bookVersionId))
    .where(and(inArray(bookVersions.id, versionIds), sql`EXISTS (
      SELECT 1 FROM libraries WHERE libraries.id = ${libraryBooks.libraryId} AND libraries.type = 'private'
    )`, sql`EXISTS (${sql.join(personalData, sql` UNION ALL `)})`)).all()
  for (const card of cards) {
    if (hasReviews) {
      db.update(bookReviews).set({ readBookVersionId: card.versionId }).where(and(
        eq(bookReviews.userId, card.userId), eq(bookReviews.privateLibraryBookId, card.workId), isNull(bookReviews.readBookVersionId),
      )).run()
    }
    savePersonalBookSnapshot(db, card.userId, card.versionId, card)
  }
}

export interface OwnedReviewDeleteRow {
  id: string
  userId: string
  visibility: 'private' | 'shared'
  sourceLibraryId: string | null
  sourceLibraryBookId: string | null
  readBookVersionId: string | null
  title?: string | null
}

export function deleteOwnedIdeasInTx(
  rawTx: unknown,
  userId: string,
  versionIds: string[],
  now = Date.now(),
): string[] {
  if (versionIds.length === 0) return []
  const tx = rawTx as Db
  const ownedIdeas = tx.select({
    id: ideas.id,
    userId: ideas.userId,
    bookVersionId: ideas.bookVersionId,
    visibility: ideas.visibility,
    sharedLibraryId: ideas.sharedLibraryId,
    sourceLibraryBookVersionId: ideas.sourceLibraryBookVersionId,
    deletedAt: ideas.deletedAt,
  }).from(ideas).where(and(
    eq(ideas.userId, userId),
    inArray(ideas.bookVersionId, versionIds),
  )).all()
  if (ownedIdeas.length === 0) return []

  const ideaIds = ownedIdeas.map((row) => row.id)
  const blobKeys = hasTable(tx, 'content_files')
    ? tx.select({ blobKey: contentFiles.blobKey }).from(contentFiles)
      .where(inArray(contentFiles.ideaId, ideaIds)).all().map((row) => row.blobKey)
    : []

  if (hasTable(tx, 'activity_events')) {
    for (const row of ownedIdeas) {
      if (row.deletedAt === null && row.visibility === 'shared' && row.sharedLibraryId && row.sourceLibraryBookVersionId) {
        const listing = tx.select({ libraryBookId: libraryBookVersions.libraryBookId }).from(libraryBookVersions).where(and(
          eq(libraryBookVersions.id, row.sourceLibraryBookVersionId),
          eq(libraryBookVersions.libraryId, row.sharedLibraryId),
        )).get()
        const work = listing ? tx.select({ title: libraryBooks.title }).from(libraryBooks).where(and(
          eq(libraryBooks.id, listing.libraryBookId),
          eq(libraryBooks.libraryId, row.sharedLibraryId),
        )).get() : null
        if (listing && work) {
          recordActivityEvent(rawTx as Parameters<typeof recordActivityEvent>[0], {
            idempotencyKey: `idea.deleted:${row.id}`,
            eventType: 'idea.deleted',
            audience: 'manager',
            libraryId: row.sharedLibraryId,
            actorUserId: userId,
            targetKind: 'idea',
            targetId: row.id,
            workId: listing.libraryBookId,
            versionId: row.bookVersionId,
            occurredAt: now,
            snapshotWorkTitle: work.title,
            snapshotAuthorId: row.userId,
          })
        }
      }
    }
  }

  tx.delete(ideas).where(and(eq(ideas.userId, userId), inArray(ideas.id, ideaIds))).run()
  return blobKeys
}

export function deleteOwnedReviewsInTx(
  rawTx: unknown,
  userId: string,
  reviewRows: OwnedReviewDeleteRow[],
  now = Date.now(),
): string[] {
  if (reviewRows.length === 0) return []
  const tx = rawTx as Db
  const reviewIds = reviewRows.map((row) => row.id)
  const blobKeys = hasTable(tx, 'content_files')
    ? tx.select({ blobKey: contentFiles.blobKey }).from(contentFiles)
      .where(inArray(contentFiles.reviewId, reviewIds)).all().map((row) => row.blobKey)
    : []

  if (hasTable(tx, 'activity_events')) {
    const canReadReviewTitle = hasColumn(tx, 'book_reviews', 'title')
    for (const row of reviewRows) {
      if (row.visibility === 'shared' && row.sourceLibraryId && row.sourceLibraryBookId) {
        const workRow = tx.select({ title: libraryBooks.title }).from(libraryBooks).where(and(
          eq(libraryBooks.id, row.sourceLibraryBookId),
          eq(libraryBooks.libraryId, row.sourceLibraryId),
        )).get()
        if (workRow) {
          const objectLabel = row.title !== undefined
            ? row.title
            : (canReadReviewTitle
                ? tx.select({ title: bookReviews.title }).from(bookReviews).where(eq(bookReviews.id, row.id)).get()?.title ?? null
                : null)
          recordActivityEvent(rawTx as Parameters<typeof recordActivityEvent>[0], {
            idempotencyKey: `review.deleted:${row.id}`,
            eventType: 'review.deleted',
            audience: 'manager',
            libraryId: row.sourceLibraryId,
            actorUserId: userId,
            targetKind: 'review',
            targetId: row.id,
            workId: row.sourceLibraryBookId,
            versionId: row.readBookVersionId,
            occurredAt: now,
            snapshotWorkTitle: workRow.title,
            snapshotObjectLabel: objectLabel,
            snapshotAuthorId: row.userId,
          })
        }
      }
    }
  }

  tx.delete(bookReviews).where(and(
    eq(bookReviews.userId, userId),
    inArray(bookReviews.id, reviewIds),
  )).run()
  return blobKeys
}
