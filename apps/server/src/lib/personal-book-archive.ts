import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { BookFormat } from '@bookdock/shared'

import type { getDb } from '../db/client'
import { bookReviews, bookVersions, libraryBooks, libraryBookVersions, readingArchives } from '../db/schema'

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
  const now = Date.now()
  db.insert(readingArchives).values({
    userId, bookVersionId, title: book.title, author: book.author, format: book.format, coverKey: book.coverKey,
    createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({ target: [readingArchives.userId, readingArchives.bookVersionId], set: {
    title: book.title, author: book.author, format: book.format, coverKey: book.coverKey,
  } }).run()
}

export function capturePrivateArchiveSnapshots(db: Db, versionIds: string[]) {
  if (versionIds.length === 0 || !hasTable(db, 'reading_archives')) return
  const hasReviews = hasTable(db, 'book_reviews')
  const personalData = [
    sql`SELECT 1 FROM reading_archives WHERE user_id = ${libraryBooks.userId} AND book_version_id = ${bookVersions.id}`,
    sql`SELECT 1 FROM highlights WHERE user_id = ${libraryBooks.userId} AND book_version_id = ${bookVersions.id}`,
    sql`SELECT 1 FROM bookmarks WHERE user_id = ${libraryBooks.userId} AND book_version_id = ${bookVersions.id}`,
    sql`SELECT 1 FROM ideas WHERE user_id = ${libraryBooks.userId} AND book_version_id = ${bookVersions.id}`,
  ]
  if (hasReviews) {
    personalData.push(sql`SELECT 1 FROM book_reviews WHERE user_id = ${libraryBooks.userId} AND (read_book_version_id = ${bookVersions.id} OR private_library_book_id = ${libraryBooks.id})`)
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
