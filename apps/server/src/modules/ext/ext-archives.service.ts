import { and, eq } from 'drizzle-orm'

import type { ArchiveBooksQuery, ExternalArchiveRes, ReadingRange } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { readingArchives } from '../../db/schema'
import { formatTimestamp } from '../../lib/format-timestamp'
import { AppError } from '../../middleware/error'
import { getArchiveOverviewPage, getBookDetail } from '../archive/archive.service'
import { getReadingBookOverview } from '../reading-records/reading-ledger.service'
import { getReadingOverview } from '../reading-records/reading-records.service'

export async function getExternalArchiveOverview(userId: string, query: ArchiveBooksQuery): Promise<ExternalArchiveRes> {
  const range = { from: query.from, to: query.to, timezone: query.timezone }
  const today = formatTimestamp(Date.now(), range.timezone).slice(0, 10)
  const reading = await getReadingOverview(userId, today, range)
  const { overview, entries, page, hasMore } = await getArchiveOverviewPage(userId, query)
  return {
    view: 'overview',
    overview: { ...overview, reading },
    entries: entries.map(({ bookVersionId, coverKey: _cover, coverPaletteKey: _palette, coverPaletteId: _paletteId, ...row }) =>
      ({ ...row, archiveId: bookVersionId })),
    page,
    hasMore,
  }
}

export async function getExternalArchive(
  userId: string,
  { archiveId, view, ...range }: ReadingRange & { archiveId: string; view: 'data' | 'notes' },
): Promise<ExternalArchiveRes> {
  const hasArchive = getDb().select({ id: readingArchives.bookVersionId }).from(readingArchives)
    .where(and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, archiveId))).get() !== undefined
  if (view === 'data' && hasArchive) {
    const { ledger: { coverKey: _cover, ...ledger }, ...readingData } =
      await getReadingBookOverview(userId, archiveId, { ...range, existingArchiveOnly: true })
    return { view, archiveId, data: { ...readingData, ledger } }
  }

  const notes = await getBookDetail(userId, archiveId, range)
  if (!hasArchive && notes.annotations.length === 0 && notes.reviews.length === 0) {
    // A date filter can legitimately leave a notes-only archive empty.
    const allNotes = range.from || range.to ? await getBookDetail(userId, archiveId) : notes
    if (allNotes.annotations.length === 0 && allNotes.reviews.length === 0) throw new AppError('BOOK_NOT_FOUND')
  }
  return view === 'notes' ? { view, archiveId, ...notes } : { view, archiveId, data: null }
}
