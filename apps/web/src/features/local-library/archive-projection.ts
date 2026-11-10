import { archiveBooksQuerySchema, parseArchiveRecordTypes, parseArchiveReadStatuses, readingRangeSchema } from '@bookdock/shared'
import type { ArchiveBooksQuery, ArchiveRecordType, ArchiveCounts, ArchiveOverview, ArchivePage, ClientArchiveBookView, ClientVaultReadingSnapshot, ReadingRange } from '@bookdock/shared'

import { projectLocalReadingBook } from './reading-projection'

export function projectLocalArchive(snapshot: ClientVaultReadingSnapshot, input: ReadingRange = {}, selectedTypes: ArchiveRecordType[] = []) {
  const range = readingRangeSchema.parse(input)
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: range.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const inRange = (clock: number) => {
    const date = formatter.format(clock)
    return (!range.from || date >= range.from) && (!range.to || date <= range.to)
  }
  const entries: ClientArchiveBookView[] = []
  const counts: ArchiveCounts = { highlights: 0, ideas: 0, bookmarks: 0, reviews: 0, total: 0 }
  for (const source of snapshot.books) {
    const notes = snapshot.notes.filter((note) => note.book.bookId === source.book.ref.bookId && inRange(note.createdAt))
    const reviews = (snapshot.reviews ?? []).filter((review) => review.book.bookId === source.book.ref.bookId && inRange(review.createdAt))
    const projected = projectLocalReadingBook(source, range)
    if (!notes.length && !reviews.length && projected.stats.totalSeconds === 0) continue
    const orderedNotes = selectedTypes.length ? notes.filter((note) => selectedTypes.includes(note.kind)) : notes
    const visibleReviews = selectedTypes.length && !selectedTypes.includes('review') ? [] : reviews
    const clocks = [...orderedNotes.map((note) => note.createdAt), ...visibleReviews.map((review) => review.createdAt)]
    const firstRecordAt = clocks.reduce<number | null>((first, clock) => first === null ? clock : Math.min(first, clock), null)
    const lastRecordAt = clocks.reduce<number | null>((last, clock) => last === null ? clock : Math.max(last, clock), null)
    const entry: ClientArchiveBookView = {
      id: source.book.ref.bookId, ref: source.book.ref, title: source.book.title, author: source.book.authors.join(', '),
      format: source.book.format, coverKey: null, readStatus: source.state?.readStatus ?? null,
      highlights: notes.filter((note) => note.kind === 'highlight').length,
      bookmarks: notes.filter((note) => note.kind === 'bookmark').length,
      ideas: notes.filter((note) => note.kind === 'idea').length, reviews: visibleReviews.length, total: notes.length + visibleReviews.length,
      durationSeconds: projected.stats.totalSeconds, referenceDurationSeconds: 0,
      readingDays: projected.stats.readingDays, progress: source.state?.fraction === null || !source.state ? null : source.state.fraction * 100,
      firstRecordAt, lastRecordAt,
    }
    counts.highlights += entry.highlights; counts.ideas += entry.ideas; counts.bookmarks += entry.bookmarks; counts.reviews += entry.reviews; counts.total += entry.total
    entries.push(entry)
  }
  const overview: ArchiveOverview = { counts, totalBooks: entries.length }
  return { overview, entries }
}

/** Shared ordering so merged rows (device + server) sort like device-only rows. */
export function compareArchiveEntries(sort: ArchiveBooksQuery['sort'], counts: (entry: ClientArchiveBookView) => number) {
  const title = (a: ClientArchiveBookView, b: ClientArchiveBookView) => (a.title ?? '').localeCompare(b.title ?? '', 'zh') || a.id.localeCompare(b.id)
  return (a: ClientArchiveBookView, b: ClientArchiveBookView) => {
    if (sort === 'title-asc') return title(a, b)
    if (sort === 'title-desc') return title(b, a)
    if (sort === 'most') return counts(b) - counts(a) || title(a, b)
    if (sort === 'fewest') return counts(a) - counts(b) || title(a, b)
    if (sort === 'reading-time') return (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0) || counts(b) - counts(a) || title(a, b)
    if (sort === 'reading-time-asc') return (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0) || counts(a) - counts(b) || title(a, b)
    if (sort === 'earliest') return (a.firstRecordAt ?? Infinity) - (b.firstRecordAt ?? Infinity) || title(a, b)
    return (b.lastRecordAt ?? 0) - (a.lastRecordAt ?? 0) || title(a, b)
  }
}

/**
 * Filtered and ordered device rows without pagination. The unified archive
 * merges these with the server page, so slicing has to happen after merging.
 */
export function projectLocalArchiveEntries(snapshot: ClientVaultReadingSnapshot, input: ArchiveBooksQuery): ClientArchiveBookView[] {
  const query = archiveBooksQuerySchema.parse(input)
  const selectedTypes = parseArchiveRecordTypes(query.type)
  const statuses = parseArchiveReadStatuses(query.readStatus)
  const counts = (entry: ClientArchiveBookView) => selectedTypes.length ? selectedTypes.reduce((sum, type) => sum + (type === 'highlight' ? entry.highlights : type === 'idea' ? entry.ideas : type === 'bookmark' ? entry.bookmarks : entry.reviews), 0) : entry.total
  const entries = projectLocalArchive(snapshot, query, selectedTypes).entries.filter((entry) => {
    if (selectedTypes.length && counts(entry) === 0) return false
    if (statuses.length && (!entry.readStatus || !statuses.includes(entry.readStatus))) return false
    if (query.search && !entry.title?.toLowerCase().includes(query.search.toLowerCase())) return false
    if (query.tag) {
      const book = snapshot.books.find((book) => book.book.ref.bookId === entry.id)?.book
      if (!snapshot.organization.items.some((tag) => tag.kind === 'tag' && tag.name === query.tag && book?.catalog?.tagIds?.includes(tag.id))) return false
    }
    return true
  })
  entries.sort(compareArchiveEntries(query.sort, counts))
  return entries
}

export function projectLocalArchivePage(snapshot: ClientVaultReadingSnapshot, input: ArchiveBooksQuery): ArchivePage<ClientArchiveBookView> {
  const query = archiveBooksQuerySchema.parse(input)
  const entries = projectLocalArchiveEntries(snapshot, input)
  return { entries: entries.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), page: query.page, hasMore: query.page * query.pageSize < entries.length }
}
