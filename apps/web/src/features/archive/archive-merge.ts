import type {
  ArchiveBooksQuery,
  ArchiveCounts,
  ArchiveOverview,
  ArchivePage,
  ClientArchiveBookView,
} from '@bookdock/shared'

import { compareArchiveEntries } from '@/features/local-library/archive-projection'

/** Device + server counts add up; `total` is recounted so it never double-counts. */
export function mergeArchiveOverviews(
  remote: ArchiveOverview | undefined,
  device: ArchiveOverview | undefined,
): ArchiveOverview {
  const counts: ArchiveCounts = {
    highlights: (remote?.counts.highlights ?? 0) + (device?.counts.highlights ?? 0),
    bookmarks: (remote?.counts.bookmarks ?? 0) + (device?.counts.bookmarks ?? 0),
    ideas: (remote?.counts.ideas ?? 0) + (device?.counts.ideas ?? 0),
    reviews: (remote?.counts.reviews ?? 0) + (device?.counts.reviews ?? 0),
    total: (remote?.counts.total ?? 0) + (device?.counts.total ?? 0),
  }
  return { counts, totalBooks: (remote?.totalBooks ?? 0) + (device?.totalBooks ?? 0) }
}

function recordCount(entry: ClientArchiveBookView, types: string[]): number {
  if (!types.length) return entry.total
  return types.reduce(
    (total, type) => total + (type === 'highlight' ? entry.highlights : type === 'idea' ? entry.ideas : type === 'bookmark' ? entry.bookmarks : entry.reviews),
    0,
  )
}

/**
 * One ordered page across both halves. Server ids win on collision: a
 * device-downloaded copy of a server book is the same archive row.
 */
export function mergeArchivePage(
  remote: ClientArchiveBookView[],
  device: ClientArchiveBookView[],
  query: Pick<ArchiveBooksQuery, 'sort' | 'type' | 'page' | 'pageSize'>,
): ArchivePage<ClientArchiveBookView> {
  const types = query.type ? query.type.split(',').map((type) => type.trim()).filter(Boolean) : []
  const counts = (entry: ClientArchiveBookView) => recordCount(entry, types)
  const seen = new Set<string>()
  const merged: ClientArchiveBookView[] = []
  for (const entry of [...remote, ...device]) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    merged.push(entry)
  }
  merged.sort(compareArchiveEntries(query.sort, counts))
  const start = (query.page - 1) * query.pageSize
  return {
    entries: merged.slice(start, start + query.pageSize),
    page: query.page,
    hasMore: merged.length > start + query.pageSize,
  }
}
