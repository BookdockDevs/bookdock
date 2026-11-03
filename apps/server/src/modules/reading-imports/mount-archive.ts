import { and, eq, isNotNull, isNull, notInArray } from 'drizzle-orm'

import type { ReadingImportMountResult, ReadingImportSource } from '@bookdock/shared'

import { getDb } from '../../db/client'
import {
  bookReviews,
  highlights,
  ideas,
  libraryBooks,
  libraryBookVersions,
  readingArchives,
  readingDurationFacts,
  readingImportBindings,
} from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { findBinding, markMounted } from './import-bindings'
import { buildLocatorReport, resolvedRevisionId } from './locator-report'

type Db = ReturnType<typeof getDb>

/** Move one import archive onto a real book.
 *
 * The locator report is recomputed here instead of trusting the copy the user
 * looked at: it is the only way positions, conflicts and the target revision
 * are guaranteed to describe the same bytes the transaction writes against
 * (0.10: read the EPUB outside the transaction, mutate inside one).
 *
 * Everything moves, including records without a position: a note that cannot
 * jump back to the text is still the reader's note. Only a collision with an
 * existing highlight (or with another record in this same batch) costs the
 * position, never the row. */
export async function mountArchive(
  userId: string,
  archiveId: string,
  targetBookVersionId: string,
): Promise<ReadingImportMountResult> {
  if (!archiveId || archiveId === targetBookVersionId) {
    throw new AppError('VALIDATION_ERROR', 'Choose a different target book')
  }
  const db = getDb()
  const archive = db.select().from(readingArchives)
    .where(and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, archiveId))).get()
  if (!archive) throw new AppError('NOT_FOUND', 'Archive not found')
  // An archive can be mounted if it is an imported archive (importSource !== null)
  // or if its original book is no longer readable/accessible in the user's library.
  if (!archive.importSource) {
    const readableBook = db.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
      .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
      .where(and(
        eq(libraryBooks.userId, userId),
        eq(libraryBookVersions.bookVersionId, archiveId),
        isNull(libraryBooks.deletedAt),
      )).get()
    if (readableBook) {
      throw new AppError('VALIDATION_ERROR', 'Only an imported archive or an archive with no readable book can be mounted')
    }
  }
  const source = (archive.importSource as ReadingImportSource) ?? null
  const accountKey = archive.importAccountKey ?? ''
  const bookKey = archive.importBookKey ?? ''
  const binding = source && bookKey ? findBinding(userId, source, accountKey, bookKey, db) : null

  // Async part: read the target book's text and locate every record.
  const report = await buildLocatorReport(userId, archiveId, targetBookVersionId)

  const now = Date.now()
  let reviewsMoved = 0
  let factsMoved = 0
  let migrated = 0
  let positioned = 0
  let inferred = 0

  db.transaction((rawTx) => {
    const tx = rawTx as unknown as Db

    // The report is only as fresh as its revision. A pinned/unpinned change
    // between locating and writing would put every CFI on the wrong bytes, so
    // the mount is refused instead of silently producing bad positions.
    const revisionId = resolvedRevisionId(tx, userId, targetBookVersionId)
    if (revisionId === null) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
    if (revisionId !== report.targetRevisionId) {
      throw new AppError('VALIDATION_ERROR', 'The target book changed; run the locator report again')
    }

    // The archive and its binding must still be what the report described: a
    // concurrent mount would have deleted the archive and re-pointed the
    // binding, and replaying this transaction would then re-home records that
    // already moved.
    const liveArchive = tx.select({ id: readingArchives.bookVersionId }).from(readingArchives)
      .where(and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, archiveId))).get()
    if (!liveArchive) throw new AppError('UPDATE_IN_PROGRESS', 'The archive changed; run the locator report again')
    const liveBinding = source && bookKey ? findBinding(userId, source, accountKey, bookKey, tx) : null
    if (source && bookKey) {
      if ((binding === null) !== (liveBinding === null)
        || (binding !== null && liveBinding !== null
          && (binding.mode !== liveBinding.mode || binding.targetBookVersionId !== liveBinding.targetBookVersionId))) {
        throw new AppError('UPDATE_IN_PROGRESS', 'The archive changed; run the locator report again')
      }
    }

    // Everything in the archive moves, not just what the report saw: rows the
    // reader deleted (or created) while the report was being read would keep
    // pointing at an archive this transaction deletes. Re-home them all first;
    // only the report's still-valid items get positions applied below. The two
    // bulk changes ARE the migrated count — the report never saw every row.
    migrated += tx.update(highlights).set({ bookVersionId: targetBookVersionId })
      .where(and(eq(highlights.userId, userId), eq(highlights.bookVersionId, archiveId))).run().changes
    migrated += tx.update(ideas).set({ bookVersionId: targetBookVersionId })
      .where(and(eq(ideas.userId, userId), eq(ideas.bookVersionId, archiveId))).run().changes

    // Re-read occupancy inside the transaction: the report's snapshot may be
    // older than a highlight the reader created a second ago. The bulk move
    // above already re-homed the archive's rows onto the target, so the rows
    // this report is about to rewrite hold their OLD ranges here — counting
    // them would make a record collide with itself and silently drop every
    // position when an already-positioned archive is mounted (re-mounting a
    // deleted book's snapshot). Their ranges are either re-written below or
    // explicitly cleared, so only rows outside the report block a candidate:
    // pre-existing target rows and moved rows the report never saw, soft-deleted
    // ones included, mirroring the unique index.
    const reportIds = report.items.map((item) => item.recordId)
    const occupied = new Set(tx.select({ cfiRange: highlights.cfiRange }).from(highlights).where(and(
      eq(highlights.userId, userId),
      eq(highlights.bookVersionId, targetBookVersionId),
      isNotNull(highlights.cfiRange),
      reportIds.length > 0 ? notInArray(highlights.id, reportIds) : undefined,
    )).all().flatMap((row) => (row.cfiRange ? [row.cfiRange] : [])))
    // Two records of the same batch can resolve to one range; the unique index
    // would abort the whole transaction, so the second one loses its position.
    const used = new Set<string>()

    for (const item of report.items) {
      // The report is a snapshot: a record deleted or edited while it was being
      // read moves with the archive but must not inherit a position located for
      // wording (or an occupancy) that no longer holds.
      const row = item.kind === 'highlight'
        ? tx.select({ text: highlights.text, deletedAt: highlights.deletedAt }).from(highlights)
          .where(and(eq(highlights.id, item.recordId), eq(highlights.userId, userId))).get()
        : tx.select({ text: ideas.text, deletedAt: ideas.deletedAt }).from(ideas)
          .where(and(eq(ideas.id, item.recordId), eq(ideas.userId, userId))).get()
      if (!row) continue
      const stale = row.deletedAt !== null || row.text !== item.text
      const candidate = stale ? null : item.cfiRange ?? item.fallbackCfiRange
      const cfiRange = candidate !== null && !occupied.has(candidate) && !used.has(candidate) ? candidate : null
      if (cfiRange !== null) {
        used.add(cfiRange)
        positioned += 1
        if (item.cfiRange === null) inferred += 1
      }
      const set = {
        bookVersionId: targetBookVersionId,
        revisionId: cfiRange === null ? null : revisionId,
        cfiRange,
        cfiAnchor: null,
        relocation: cfiRange === null ? 'unresolved' as const : 'ok' as const,
        updatedAt: now,
        ...(item.chapter && !stale ? { chapter: item.chapter } : {}),
      }
      if (item.kind === 'highlight') {
        tx.update(highlights).set(set)
          .where(and(eq(highlights.id, item.recordId), eq(highlights.userId, userId))).run()
      } else {
        tx.update(ideas).set(set)
          .where(and(eq(ideas.id, item.recordId), eq(ideas.userId, userId))).run()
      }
    }

    reviewsMoved = tx.update(bookReviews).set({
      readBookVersionId: targetBookVersionId,
      readRevisionId: revisionId,
      updatedAt: now,
    }).where(and(
      eq(bookReviews.userId, userId),
      eq(bookReviews.readBookVersionId, archiveId),
    )).run().changes

    // Facts keep their granularity and overlap group: mounting changes which
    // book they belong to, not how they add up.
    factsMoved = tx.update(readingDurationFacts).set({ bookVersionId: targetBookVersionId })
      .where(and(
        eq(readingDurationFacts.userId, userId),
        eq(readingDurationFacts.bookVersionId, archiveId),
      )).run().changes

    // Order matters only in that both happen in this transaction: the archive
    // row goes, the binding stays (pointing at the book) so a re-import writes
    // straight into the mounted book instead of rebuilding an archive.
    tx.delete(readingArchives).where(and(
      eq(readingArchives.userId, userId),
      eq(readingArchives.bookVersionId, archiveId),
    )).run()

    if (source) {
      if (binding) {
        markMounted(tx, binding.id, targetBookVersionId, now)
      } else {
        tx.insert(readingImportBindings).values({
          id: createId('rib'),
          userId,
          source,
          accountKey,
          bookKey,
          targetBookVersionId,
          mode: 'mounted',
          autoSync: false,
          lastSyncedAt: null,
          mountedAt: now,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing().run()
      }
    }
  })

  return {
    archiveId,
    targetBookVersionId,
    notes: {
      migrated,
      positioned,
      unpositioned: migrated - positioned,
      inferred,
    },
    reviews: reviewsMoved,
    durationFacts: factsMoved,
  }
}
