import type { ImportNote, ImportProposal, ImportReview } from './reading-imports.service'
import { wereadGateway } from '../integrations/weread.service'

import type { ImportBook } from './reading-imports.service'
import { AppError } from '../../middleware/error'

// Request budget: shelf + notebooks + per-book notes/progress. The cap keeps a
// stuck loop from running away; the skipped counter reports what was left
// unfetched.
const MAX_REQUESTS = 3000
const MAX_REVIEW_PAGES = 50
const MAX_RECORDS_PER_BOOK = 20000

/** WeRead highlight colors are numbered; the mapping is by explicit table, not
 * by palette indexes, and unknown values (observed: 0) stay unmapped so the
 * default color applies instead of a guessed meaning. */
const WEREAD_COLORS: Record<number, string> = { 1: 'red', 2: 'purple', 3: 'blue', 4: 'green', 5: 'yellow' }

export type ImportScope = 'all' | 'time' | 'notes'

type Unprocessable = { reason: string; count: number }

interface WereadBookInfo {
  bookId: string
  title: string
  author: string
  cover: string | null
  format?: string
  lastReadAt?: number | null
  lastNoteAt?: number | null
}

interface WereadSnapshot {
  books: Array<{
    info: WereadBookInfo
    highlights: Array<{
      bookmarkId: string
      markText: string
      chapterUid: number | null
      chapterIdx: number | null
      createTime: number | null
      color: string | null
      locator: string | null
    }>
    thoughts: Array<{ reviewId: string; content: string; abstract: string | null; chapterUid: number | null; chapterIdx: number | null; chapterName: string | null; createTime: number | null; star: number | null; locator: string | null }>
    reviews: Array<{ reviewId: string; content: string; star: number | null; newRatingLevel: number | null; isFinish: boolean | null; createTime: number | null }>
    chapterTitles: Map<number, string>
    finished: boolean | null
    hasNotes: boolean
  }>
  albums: number
  skippedBooks: number
  skipped: number
  unprocessable: Unprocessable[]
}

function str(value: unknown, max = 2000): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function int(value: unknown): number | null {
  const parsed = num(value)
  return parsed === null || !Number.isInteger(parsed) ? null : parsed
}

/** WeRead whole-book review rating → bookdock 0–5 rating. Verified live
 * 2026-11-04 on both channels (agent gateway and /web/review/list): type=4
 * rows carry `star` on a 0–100 legacy star scale where 10 = half a star
 * (100/60/20 observed = 5/3/1 stars) plus `newRatingLevel`, the current
 * three-level mechanism (1=推荐, 2=一般, 3=不行). Star wins when both parse —
 * it is the finer scale; level maps through a fixed table when star is
 * absent. Anything else (unrated markers, unknown levels) stays unrated. */
function reviewRating(star: number | null, level: number | null): number | null {
  if (star !== null && star >= 10 && star <= 100 && star % 10 === 0) return star / 20
  if (level === 1) return 5
  if (level === 2) return 3
  if (level === 3) return 1
  return null
}

function colorName(value: unknown): string | null {
  const code = int(value)
  return code === null ? null : WEREAD_COLORS[code] ?? null
}

/** A source locator is a chapter-relative character range like "3627-3641".
 * Only its decimal start offset is kept: ordering inside a chapter is the sole
 * use, and it is not a CFI (it can never drive a content jump). */
function locatorOffset(value: unknown): string | null {
  const raw = str(value, 100).trim()
  const match = /^(\d{1,10})/.exec(raw)
  return match ? String(Number(match[1])) : null
}

class RequestBudget {
  used = 0
  constructor(readonly cap: number) {}
  take(): boolean {
    if (this.used >= this.cap) return false
    this.used++
    return true
  }
}

export type WereadRequester = (params: Record<string, unknown>) => Promise<Record<string, unknown> | null>

function hasMore(page: Record<string, unknown>): boolean {
  return page.hasMore === 1 || page.hasMore === true
}

async function call(budget: RequestBudget, request: WereadRequester, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!budget.take()) return null
  return request(params)
}

function readBookInfo(value: unknown): WereadBookInfo | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const nested = row.book ?? row.bookInfo
  const book = nested && typeof nested === 'object' ? nested as Record<string, unknown> : row
  const bookId = str(book.bookId, 128)
  const title = str(book.title, 500)
  if (!bookId || !title) return null
  return {
    bookId,
    title,
    author: str(book.author, 200),
    cover: str(book.cover, 2048) || null,
    format: str(book.format, 20) || undefined,
  }
}

/** Fetch the user's complete WeRead history snapshot for the requested scope.
 * Failure of an individual book or month is counted and skipped, never fatal
 * for the rest. This channel carries no duration at all: the gateway has no
 * per-book-per-day endpoint and the single-book cumulative total is not a
 * granularity this product stores (see docs/local/dev/reading-data-import.md
 * 0.10), so `time` returns an empty snapshot instead of a fake one. */
async function fetchSnapshot(scope: ImportScope, onlyIds: Set<string> | undefined, request: WereadRequester, includeEmptyShelfBooks = false): Promise<WereadSnapshot> {
  const budget = new RequestBudget(MAX_REQUESTS)
  const snapshot: WereadSnapshot = { books: [], albums: 0, skippedBooks: 0, skipped: 0, unprocessable: [] }
  const bump = (reason: string) => {
    const found = snapshot.unprocessable.find((entry) => entry.reason === reason)
    if (found) found.count++
    else snapshot.unprocessable.push({ reason, count: 1 })
  }

  if (scope === 'time') {
    snapshot.unprocessable.push({ reason: 'time-requires-web', count: 1 })
    return snapshot
  }

  // Shelf context supplies every book; notebooks supply the note counts.
  const shelf = scope === 'all' ? await call(budget, request, { api_name: '/shelf/sync' }) : null
  const shelfBooks: WereadBookInfo[] = []
  if (shelf) {
    snapshot.albums = Array.isArray(shelf.albums) ? shelf.albums.length : 0
    for (const row of Array.isArray(shelf.books) ? shelf.books : []) {
      if (!row || typeof row !== 'object') continue
      const info = readBookInfo(row)
      if (info) shelfBooks.push(info)
    }
  }

  const notebookBooks: WereadBookInfo[] = []
  const notebookIds = new Set<string>()
  let nbParams: Record<string, unknown> | null = { api_name: '/user/notebooks', count: 100 }
  while (nbParams) {
    const page = await call(budget, request, nbParams)
    if (!page) { bump('request-limit'); break }
    const entries = Array.isArray(page.books) ? page.books : []
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') { bump('notebook-entry-invalid'); continue }
      const info = readBookInfo(entry)
      if (!info) { bump('notebook-entry-invalid'); continue }
      notebookIds.add(info.bookId)
      notebookBooks.push(info)
    }
    const last = entries.at(-1) as Record<string, unknown> | undefined
    if (hasMore(page) && typeof last?.sort === 'number') nbParams = { api_name: '/user/notebooks', count: 100, lastSort: last.sort }
    else {
      if (hasMore(page)) bump('notebook-pagination-incomplete')
      nbParams = null
    }
  }

  // Candidates: notebooks (notes source) plus shelf books (metadata source).
  // Books that exist only on the shelf and carry no notes keep their own
  // title/author/cover from the shelf response.
  const infoById = new Map<string, WereadBookInfo>()
  for (const info of notebookBooks) infoById.set(info.bookId, info)
  for (const info of shelfBooks) {
    const existing = infoById.get(info.bookId)
    if (!existing) { infoById.set(info.bookId, info); continue }
    // Notebook rows omit the ebook format, and either response may omit the
    // cover: fill the gaps rather than discarding what one of them knows.
    existing.format = existing.format ?? info.format
    existing.cover = existing.cover ?? info.cover
  }

  for (const info of infoById.values()) {
    // A targeted fetch only pays for the books the user ticked.
    if (onlyIds && !onlyIds.has(info.bookId)) continue
    const book: WereadSnapshot['books'][number] = {
      info, highlights: [], thoughts: [], reviews: [], chapterTitles: new Map(),
      finished: null, hasNotes: notebookIds.has(info.bookId),
    }

    // wereadGateway throws on any gateway error instead of returning null; a
    // recoverable single-book failure is caught here so one bad book cannot
    // discard the data already fetched for the rest of the batch.
    try {
      if (book.hasNotes) {
        const listed = await call(budget, request, { api_name: '/book/bookmarklist', bookId: info.bookId })
        if (!listed && budget.used >= budget.cap) { bump('request-limit'); snapshot.skipped++; continue }
        if (listed && Array.isArray(listed.chapters)) {
          for (const chapter of listed.chapters) {
            if (!chapter || typeof chapter !== 'object') continue
            const uid = int((chapter as Record<string, unknown>).chapterUid)
            const title = str((chapter as Record<string, unknown>).title, 500)
            if (uid !== null && title) book.chapterTitles.set(uid, title)
          }
        }
        if (listed && Array.isArray(listed.updated)) {
          for (const row of listed.updated) {
            if (!row || typeof row !== 'object') { bump('highlight-invalid'); continue }
            const entry = row as Record<string, unknown>
            const id = str(entry.bookmarkId, 200)
            if (!id) { bump('highlight-invalid'); continue }
            if (book.highlights.length >= MAX_RECORDS_PER_BOOK) { bump('highlight-limit'); break }
            book.highlights.push({
              bookmarkId: id,
              markText: str(entry.markText, 10000),
              chapterUid: int(entry.chapterUid),
              chapterIdx: int(entry.chapterIdx),
              createTime: int(entry.createTime),
              color: colorName(entry.colorStyle),
              locator: locatorOffset(entry.range),
            })
          }
        } else if (!listed) bump('book-fetch-failed')

        let reviewParams: Record<string, unknown> | null = { api_name: '/review/list/mine', bookid: info.bookId, count: 50 }
        let pages = 0
        while (reviewParams) {
          if (pages++ >= MAX_REVIEW_PAGES) { bump('review-page-limit'); break }
          const page = await call(budget, request, reviewParams)
          if (!page) { bump(budget.used >= budget.cap ? 'request-limit' : 'book-fetch-failed'); break }
          for (const wrapper of Array.isArray(page.reviews) ? page.reviews : []) {
            if (!wrapper || typeof wrapper !== 'object') { bump('thought-invalid'); continue }
            const review = (wrapper as Record<string, unknown>).review
            if (!review || typeof review !== 'object') { bump('thought-invalid'); continue }
            const entry = review as Record<string, unknown>
            const id = str(entry.reviewId, 200)
            if (!id) { bump('thought-invalid'); continue }
            if (book.thoughts.length + book.reviews.length >= MAX_RECORDS_PER_BOOK) { bump('thought-limit'); break }
            const thought = {
              reviewId: id,
              content: str(entry.content, 20000),
              abstract: str(entry.abstract, 10000) || null,
              range: str(entry.range, 100) || null,
              chapterUid: int(entry.chapterUid),
              chapterIdx: int(entry.chapterIdx),
              chapterName: str(entry.chapterName, 500) || null,
              createTime: int(entry.createTime),
              star: int(entry.star),
              locator: locatorOffset(entry.range),
            }
            // Structural evidence, never text guessing: a row anchored to a
            // passage or chapter is a thought; a row with no anchor at all is a
            // whole-book review (per the WeRead notes skill: abstract/range only
            // exist for content locatable to source text, chapterName only for
            // chapter comments; whole-book reviews carry neither).
            if (thought.range || thought.abstract || thought.chapterUid !== null || thought.chapterIdx !== null || thought.chapterName) {
              book.thoughts.push(thought)
            } else {
              book.reviews.push({
                reviewId: id,
                content: thought.content,
                star: thought.star,
                newRatingLevel: int(entry.newRatingLevel),
                isFinish: entry.isFinish === 1 ? true : entry.isFinish === 0 ? false : null,
                createTime: thought.createTime,
              })
            }
          }
          reviewParams = page.hasMore === 1 && typeof page.synckey === 'number' ? { api_name: '/review/list/mine', bookid: info.bookId, synckey: page.synckey, count: 50 } : null
        }
      }

      let finished: boolean | null = null
      if (scope === 'all') {
        const progress = await call(budget, request, { api_name: '/book/getprogress', bookId: info.bookId })
        if (progress && typeof progress.book === 'object' && progress.book !== null) {
          const row = progress.book as Record<string, unknown>
          // Only the completion flag is kept. Its cumulative `readingTime` is
          // deliberately not stored: this channel cannot tell which days it came
          // from, and a lone book-level total would double-count once the web
          // channel supplies book x day facts.
          finished = typeof row.progress === 'number' ? row.progress === 100 : null
        }
      }
      book.finished = finished
    } catch (error) {
      // A dead web login fails every book and must surface as the dedicated
      // error, not as a batch of "skipped books" that looks partly successful.
      if (error instanceof AppError && error.code === 'WEREAD_WEB_AUTH_EXPIRED') throw error
      bump('book-fetch-failed')
      snapshot.skipped++
      continue
    }

    // Scope gates. A shelf book with no notes is only worth keeping when the
    // source says it was finished; this channel contributes no duration.
    if (scope === 'notes' && !book.hasNotes) { snapshot.skippedBooks++; continue }
    if (scope === 'all' && !includeEmptyShelfBooks && !book.hasNotes && book.finished !== true) { snapshot.skippedBooks++; continue }

    snapshot.books.push(book)
  }

  return snapshot
}

export function buildWereadProposal(snapshot: WereadSnapshot): ImportProposal {
  const books: ImportBook[] = []
  const notes: ImportNote[] = []
  const reviews: ImportReview[] = []
  for (const book of snapshot.books) {
    books.push({
      sourceBookId: book.info.bookId,
      title: book.info.title,
      author: book.info.author,
      coverUrl: book.info.cover,
      finished: book.finished,
      meta: {
        ...(book.info.format ? { format: book.info.format } : {}),
        ...(book.finished !== null ? { finished: book.finished } : {}),
      },
    })
    for (const highlight of book.highlights) {
      notes.push({
        sourceBookId: book.info.bookId,
        sourceRecordId: highlight.bookmarkId,
        kind: 'highlight',
        text: highlight.markText,
        note: null,
        chapter: highlight.chapterUid !== null ? book.chapterTitles.get(highlight.chapterUid) ?? null : null,
        color: highlight.color,
        locator: highlight.locator,
        chapterIndex: highlight.chapterUid,
        createdAt: highlight.createTime === null ? null : highlight.createTime * 1000,
      })
    }
    for (const thought of book.thoughts) {
      notes.push({
        sourceBookId: book.info.bookId,
        sourceRecordId: thought.reviewId,
        kind: 'idea',
        text: thought.abstract ?? '',
        note: thought.content || null,
        chapter: thought.chapterName ?? (thought.chapterUid !== null ? book.chapterTitles.get(thought.chapterUid) ?? null : null),
        // WeRead returns no color for thoughts; the idea default applies.
        color: null,
        locator: thought.locator,
        chapterIndex: thought.chapterUid ?? thought.chapterIdx,
        createdAt: thought.createTime === null ? null : thought.createTime * 1000,
      })
    }
    for (const review of book.reviews) {
      reviews.push({
        sourceBookId: book.info.bookId,
        sourceRecordId: review.reviewId,
        body: review.content,
        // 0.5–5 stars; 0 and -1 mean unrated on the source.
        rating: reviewRating(review.star, review.newRatingLevel),
        createdAt: review.createTime === null ? null : review.createTime * 1000,
      })
    }
  }
  const skipped = snapshot.albums + snapshot.skippedBooks
  // This channel produces notes and book metadata only; every duration fact
  // comes from the web channel (book x day), see 0.10.
  return { books, notes, reviews, durationFacts: [], skipped, unprocessable: snapshot.unprocessable }
}

export async function fetchWereadProposal(key: string, scope: ImportScope, bookKeys?: string[] | null): Promise<ImportProposal> {
  // Absent means "everything the scope lists"; an explicit empty array is a
  // real choice and fetches nothing.
  const onlyIds = bookKeys === undefined || bookKeys === null ? undefined : new Set(bookKeys)
  const snapshot = await fetchSnapshot(scope, onlyIds, (params) => wereadGateway(key, params))
  return buildWereadProposal(snapshot)
}

/** The book list without note records. Notebook pages carry WeRead's own
 * per-book tallies; the shelf adds books without notebooks. */
export async function fetchWereadBookListUsing(scope: ImportScope, request: WereadRequester): Promise<ImportProposal> {
  const budget = new RequestBudget(MAX_REQUESTS)
  const unprocessable: Unprocessable[] = []
  const bump = (reason: string) => {
    const found = unprocessable.find((entry) => entry.reason === reason)
    if (found) found.count++
    else unprocessable.push({ reason, count: 1 })
  }
  if (scope === 'time') {
    // Same reason as the snapshot path: this channel carries no duration.
    return { books: [], notes: [], reviews: [], durationFacts: [], skipped: 0, unprocessable: [{ reason: 'time-requires-web', count: 1 }], listCounts: {} }
  }

  const infoById = new Map<string, WereadBookInfo>()
  const counts = new Map<string, { notes: number; reviews: number }>()
  let reportedNotebookCount: number | null = null

  let nbParams: Record<string, unknown> | null = { api_name: '/user/notebooks', count: 100 }
  while (nbParams) {
    const page = await call(budget, request, nbParams)
    if (!page) { bump('request-limit'); break }
    if (typeof page.totalBookCount === 'number' && Number.isFinite(page.totalBookCount)) reportedNotebookCount = page.totalBookCount
    const entries = Array.isArray(page.books) ? page.books : []
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') { bump('notebook-entry-invalid'); continue }
      const row = entry as Record<string, unknown>
      const info = readBookInfo(row)
      if (!info) { bump('notebook-entry-invalid'); continue }
      // Highlights and ideas are the two kinds this product imports; a notebook
      // entry with neither is a shelf marker, not a note source.
      const notes = (int(row.noteCount) ?? 0) + (int(row.reviewCount) ?? 0)
      const noteTime = int(row.sort)
      info.lastNoteAt = notes > 0 && noteTime !== null && noteTime > 0 ? noteTime * 1000 : null
      infoById.set(info.bookId, info)
      counts.set(info.bookId, { notes, reviews: 0 })
    }
    const last = entries.at(-1) as Record<string, unknown> | undefined
    if (hasMore(page) && typeof last?.sort === 'number') nbParams = { api_name: '/user/notebooks', count: 100, lastSort: last.sort }
    else {
      if (hasMore(page)) bump('notebook-pagination-incomplete')
      nbParams = null
    }
  }

  if (reportedNotebookCount !== null && counts.size < reportedNotebookCount) bump('notebook-pagination-incomplete')

  // Shelf books are candidates even when they have no note notebook.
  {
    const shelf = await call(budget, request, { api_name: '/shelf/sync' })
    if (!shelf) bump('shelf-fetch-failed')
    else {
      for (const row of Array.isArray(shelf.books) ? shelf.books : []) {
        if (!row || typeof row !== 'object') continue
        const info = readBookInfo(row)
        if (!info) continue
        const readTime = int((row as Record<string, unknown>).readUpdateTime)
        info.lastReadAt = readTime !== null && readTime > 0 ? readTime * 1000 : null
        const existing = infoById.get(info.bookId)
        if (existing) { existing.format = existing.format ?? info.format; existing.cover = existing.cover ?? info.cover; existing.lastReadAt = info.lastReadAt; continue }
        if (scope !== 'all') continue
        infoById.set(info.bookId, info)
        counts.set(info.bookId, { notes: 0, reviews: 0 })
      }
    }
  }

  const books: ImportBook[] = []
  const listCounts: Record<string, { notes: number; reviews: number }> = {}
  for (const [bookId, info] of infoById) {
    const count = counts.get(bookId) ?? { notes: 0, reviews: 0 }
    books.push({
      sourceBookId: info.bookId,
      title: info.title,
      author: info.author,
      coverUrl: info.cover,
      finished: null,
      meta: info.format ? { format: info.format } : {},
      lastReadAt: info.lastReadAt ?? null,
      lastNoteAt: info.lastNoteAt ?? null,
    })
    listCounts[bookId] = count
  }

  // Nothing is skipped at this stage: a book is in the list precisely because
  // the scope can carry it. Whatever the detail fetch later drops is counted
  // then, against the records it actually saw.
  return { books, notes: [], reviews: [], durationFacts: [], skipped: 0, unprocessable, listCounts }
}

export async function fetchWereadBookList(key: string, scope: ImportScope): Promise<ImportProposal> {
  return fetchWereadBookListUsing(scope, (params) => wereadGateway(key, params))
}

export async function fetchWereadProposalUsing(scope: ImportScope, bookKeys: string[] | null | undefined, request: WereadRequester, includeEmptyShelfBooks = false): Promise<ImportProposal> {
  // Same empty-selection rule as fetchWereadProposal: absent = all, [] = none.
  const onlyIds = bookKeys === undefined || bookKeys === null ? undefined : new Set(bookKeys)
  return buildWereadProposal(await fetchSnapshot(scope, onlyIds, request, includeEmptyShelfBooks))
}
