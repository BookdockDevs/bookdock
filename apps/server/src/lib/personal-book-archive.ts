import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { BookFormat } from '@bookdock/shared'

import type { getDb } from '../db/client'
import { bookReviews, bookVersions, libraryBooks, libraryBookVersions, readingArchives, readingImportBindings } from '../db/schema'

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
