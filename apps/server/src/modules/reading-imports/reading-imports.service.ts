import { createHash } from 'node:crypto'

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'

import type {
  ReadingImportBookItem,
  ReadingImportConflict,
  ReadingImportPreview,
  ReadingImportResult,
  ReadingImportScope,
  ReadingImportSource,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookReviews, highlights, ideas, readingArchives, readingDurationFacts } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { createArchiveBinding, listBindings, listSourceBindings, type ImportBinding } from './import-bindings'
import { locateNotesAgainstBook, resolvedRevisionId } from './locator-report'

type Db = ReturnType<typeof getDb>
type ArchiveRow = typeof readingArchives.$inferSelect
type HighlightRow = typeof highlights.$inferSelect
type IdeaRow = typeof ideas.$inferSelect
type ReviewRow = typeof bookReviews.$inferSelect

export interface ImportBook {
  sourceBookId: string
  title: string
  author: string
  coverUrl: string | null
  finished: boolean | null
  meta: Record<string, unknown>
  lastReadAt?: number | null
  lastNoteAt?: number | null
}

export interface ImportDurationFact {
  sourceBookId: string | null
  sourceRecordKey: string
  granularity: 'book_total' | 'book_day' | 'account_total' | 'account_day'
  date: string | null
  seconds: number
  aggregationRole: 'additive' | 'reference'
  overlapGroup?: string | null
}

export interface ImportNote {
  sourceBookId: string
  sourceRecordId: string
  kind: 'highlight' | 'idea'
  text: string
  note: string | null
  chapter: string | null
  /** Source-provided color name, already mapped to a Bookdock palette name.
   * Null = the source has no color for this record; the kind default applies. */
  color: string | null
  /** Source-native position inside the chapter (opaque). Ordering only; it is
   * not a CFI and never enables content jumps. */
  locator: string | null
  /** Source-native chapter ordinal (WeRead chapterUid / legado chapterIndex).
   * Ordering-only fallback for notes whose book has no usable TOC. */
  chapterIndex: number | null
  createdAt: number | null
}

export interface ImportReview {
  sourceBookId: string
  sourceRecordId: string
  body: string
  rating: number | null
  createdAt: number | null
}

export interface ImportProposal {
  books: ImportBook[]
  notes: ImportNote[]
  reviews: ImportReview[]
  durationFacts: ImportDurationFact[]
  skipped: number
  unprocessable: { reason: string; count: number }[]
  /** Present when the source can list books and their record counts without
   * fetching the records themselves (WeRead's notebook list). Such a proposal
   * carries no notes/reviews by definition: the arrays are empty because
   * nothing was fetched, not because the books are empty, so counts are read
   * from here instead. Keyed by sourceBookId. */
  listCounts?: Record<string, { notes: number; reviews: number }>
}

/** Stable per-dataset import identity for notes and reviews. Scoped by the
 * dataset key so two source accounts can never merge into one archive. */
function importKey(datasetKey: string, sourceBookId: string, sourceRecordId: string): string {
  return `sha256:${createHash('sha256').update(JSON.stringify([datasetKey, sourceBookId, sourceRecordId])).digest('hex')}`
}

/** WeRead dataset key: the configured gateway key is the only per-account
 * signal the import has, so one key maps to one dataset. Key rotation yields
 * a new visible dataset (never a silent merge or overwrite); no account
 * management exists by design. */
export function wereadDatasetKey(key: string): string {
  return `key:${createHash('sha256').update(key).digest('hex')}`
}

/** Narrow a parsed proposal to the selected scope while retaining source identity. */
/** Books with nothing to import are dropped by scope filtering. A book whose
 * only source fact is its own metadata (finished flag or ebook format) is not
 * empty: importing it is what makes "finished, no notes" visible in the archive
 * list, so it has to survive the filter. */
function hasImportMetadata(book: ImportBook): boolean {
  return book.finished !== null || book.meta.format !== undefined
}

export function scopeProposal(proposal: ImportProposal, scope: ReadingImportScope): ImportProposal {
  // A list-only proposal has already been narrowed by the source's own counts;
  // scope filtering here would empty it, because it holds no records to filter.
  if (proposal.listCounts !== undefined) return proposal
  if (scope === 'all') {
    const included = new Set([
      ...proposal.notes.map((note) => note.sourceBookId),
      ...proposal.reviews.map((review) => review.sourceBookId),
      ...proposal.durationFacts.flatMap((fact) => fact.sourceBookId === null ? [] : [fact.sourceBookId]),
    ])
    const books = proposal.books.filter((book) => included.has(book.sourceBookId) || hasImportMetadata(book))
    return { ...proposal, books, skipped: proposal.skipped + proposal.books.length - books.length }
  }
  if (scope === 'time') {
    return {
      ...proposal,
      notes: [],
      reviews: [],
      books: proposal.books.filter((book) => proposal.durationFacts.some((fact) => fact.sourceBookId === book.sourceBookId)),
    }
  }
  const notesBooks = new Set(proposal.notes.map((note) => note.sourceBookId))
  const reviewBooks = new Set(proposal.reviews.map((review) => review.sourceBookId))
  const books = proposal.books
    .filter((book) => notesBooks.has(book.sourceBookId) || reviewBooks.has(book.sourceBookId))
    .map((book) => book)
  return {
    ...proposal,
    durationFacts: [],
    books,
  }
}

interface NoteWrite {
  sourceBookId: string
  note: ImportNote
  kind: 'highlight' | 'idea'
  dropKind: 'highlight' | 'idea' | null
  /** No row carried this import identity before, so it needs a position. */
  isNew: boolean
  /** Restoring a row the reader had deleted: clear the tombstone, and only
   * touch the content when the row still matches what the source last gave. */
  restoreOnly: boolean
  /** The reader explicitly overwrote a both-sides-changed conflict; the write
   * proceeds even if the row moves again before the transaction opens. */
  overwrite: boolean
}
interface ReviewWrite { sourceBookId: string; review: ImportReview; overwrite: boolean }

interface ImportPlan {
  newBooks: ImportBook[]
  updatedBooks: Array<{ existing: ArchiveRow; incoming: ImportBook }>
  noteWrites: NoteWrite[]
  reviewWrites: ReviewWrite[]
  durationWrites: Array<{ incoming: ImportDurationFact; existingId: string | null }>
  newDurationFacts: number
  updatedDurationFacts: number
  unchangedDurationFacts: number
  newNotes: number
  updatedNotes: number
  unchangedNotes: number
  newReviews: number
  updatedReviews: number
  unchangedReviews: number
  unprocessable: { reason: string; count: number }[]
  /** Records both sides changed, kept local and reported for the reader. */
  conflicts: ReadingImportConflict[]
}

/** Defaults mirror the reader's own annotation defaults so imported and
 * self-made notes look the same: highlights are yellow underlines, ideas are
 * amber underlines. */
const DEFAULT_HIGHLIGHT_COLOR = 'yellow'
const DEFAULT_IDEA_COLOR = 'amber'
const DEFAULT_NOTE_STYLE = 'underline'

function noteColor(note: ImportNote): string {
  return note.color ?? (note.kind === 'highlight' ? DEFAULT_HIGHLIGHT_COLOR : DEFAULT_IDEA_COLOR)
}

/** Fingerprint of a note's delivered content: what the import last wrote into
 * the row, source color resolved to the palette value. `chapter` and
 * `chapterIndex` are excluded — both are derived metadata the import adapts to
 * the associated book (mount and locate rewrite the stored name to the book's
 * own heading), so including either would turn every corrected row into a
 * spurious both-sides-moved conflict on the first re-import. The stored
 * importHash uses this shape, so a row reads as user-edited exactly when its
 * content diverges from the last delivery. */
function deliveryFingerprint(text: string, note: string | null, color: string | null, locator: string | null): string {
  return createHash('sha256').update(JSON.stringify([text, note, color, locator])).digest('hex')
}

function noteFingerprint(note: ImportNote): string {
  return deliveryFingerprint(note.text, note.note, noteColor(note), note.locator)
}

function noteRowFingerprint(row: HighlightRow | IdeaRow): string {
  return deliveryFingerprint(row.text, 'note' in row ? row.note : null, row.color, row.importLocator)
}

/** Import hashes stored before chapter adaptation shipped fingerprinted the
 * source payload including its chapter name, so they can never match the
 * delivery shape and such rows would read as user-edited forever. Two legacy
 * shapes exist: the source-payload hash, and the row-content hash (either with
 * the row's own chapter or with the source chapter a mount replaced).
 * `rebaselineImportHash` matches both and re-baselines in memory; the next
 * write of the row persists the delivery shape. */
function legacySourceNoteFingerprint(note: ImportNote): string {
  return createHash('sha256').update(JSON.stringify([note.text, note.note, note.chapter, noteColor(note), note.locator])).digest('hex')
}

function legacyRowFingerprint(row: HighlightRow | IdeaRow, chapterOverride?: string | null): string {
  const chapter = chapterOverride === undefined ? row.chapter : chapterOverride
  return createHash('sha256').update(JSON.stringify('note' in row
    ? [row.text, row.note, chapter, row.color, row.importLocator]
    : [row.text, null, chapter, row.color, row.importLocator])).digest('hex')
}

/** Re-baseline a pre-adaptation import hash in place. The source-payload match
 * keeps the source-side baseline so a user edit stays detectable; the
 * row-content matches prove the row is unedited and take the row baseline. */
function rebaselineImportHash(row: HighlightRow | IdeaRow, note: ImportNote): void {
  if (row.importHash === legacySourceNoteFingerprint(note)) row.importHash = noteFingerprint(note)
  else if (row.importHash === legacyRowFingerprint(row) || row.importHash === legacyRowFingerprint(row, note.chapter)) {
    row.importHash = noteRowFingerprint(row)
  }
}

function reviewFingerprint(review: ImportReview): string {
  return createHash('sha256').update(JSON.stringify([review.body, review.rating])).digest('hex')
}

function reviewRowFingerprint(row: ReviewRow): string {
  return createHash('sha256').update(JSON.stringify([row.body, row.ratingHalves === null ? null : row.ratingHalves / 2])).digest('hex')
}

/** WeRead reports an ebook format ("epub", "txt", "pdf", ...). The archive
 * column only distinguishes the two formats this product can open, so anything
 * else stays unknown instead of being coerced into a wrong label. */
function archiveFormatOf(book: ImportBook): 'epub' | 'txt' | null {
  const raw = typeof book.meta.format === 'string' ? book.meta.format.trim().toLowerCase() : ''
  return raw === 'epub' || raw === 'txt' ? raw : null
}

/** Archive metadata keeps source facts the tables have no column for. `finished`
 * is stored here because imported archives have no book_states row to carry a
 * read status, and the list projection derives `readStatus` from it. */
function archiveMetaOf(book: ImportBook): Record<string, unknown> {
  return book.finished === null ? { ...book.meta } : { ...book.meta, finished: book.finished }
}

/** Diff a proposal against the caller's stored archives: preview counts and
 * the concrete write plan share this path, so preview and apply cannot
 * diverge. Notes/reviews must reference a proposal book (importers create
 * implicit books for records without a shelf entry); unresolved references
 * are reported, never guessed. */
function planChanges(
  userId: string,
  source: ReadingImportSource,
  datasetKey: string,
  proposal: ImportProposal,
  /** Import identities the reader explicitly asked to overwrite. Anything else
   * that looks content-conflicted keeps the local version. */
  overwriteKeys: ReadonlySet<string> = new Set(),
): ImportPlan {
  const db = getDb()
  const bindings = listBindings(userId, source, datasetKey, db)
  // Every binding target is a book version: an import archive before mounting,
  // the real book afterwards. Reading the archive rows is only needed to
  // refresh source facts on re-import; identity comes from the binding.
  const archiveIds = [...bindings.values()]
    .filter((binding) => binding.mode === 'archive')
    .map((binding) => binding.targetBookVersionId)
  const archiveByVersionId = new Map<string, ArchiveRow>(archiveIds.length
    ? db.select().from(readingArchives).where(and(
      eq(readingArchives.userId, userId),
      inArray(readingArchives.bookVersionId, archiveIds),
    )).all().map((row) => [row.bookVersionId, row])
    : [])
  const knownBookKeys = new Set<string>()
  const targetIds: string[] = []
  for (const [bookKey, binding] of bindings) {
    knownBookKeys.add(bookKey)
    targetIds.push(binding.targetBookVersionId)
  }

  const newBooks: ImportBook[] = []
  const updatedBooks: Array<{ existing: ArchiveRow; incoming: ImportBook }> = []
  const seenBookKeys = new Set<string>()
  for (const book of proposal.books) {
    if (seenBookKeys.has(book.sourceBookId)) continue
    seenBookKeys.add(book.sourceBookId)
    const binding = bindings.get(book.sourceBookId)
    const existing = binding?.mode === 'archive' ? archiveByVersionId.get(binding.targetBookVersionId) : undefined
    if (binding?.mode === 'mounted') {
      // The target is the user's own book: an import never rewrites its title,
      // cover or format, and there is no archive row left to refresh.
      knownBookKeys.add(book.sourceBookId)
      continue
    }
    if (existing) {
      // Source facts the archive row carries (cover, format, finished) are
      // refreshed on re-import; only fields that actually differ count as an
      // update so an unchanged source still reports "no changes".
      const format = archiveFormatOf(book)
      const finished = book.finished
      const formatChanged = format !== null && existing.format !== format
      const finishedChanged = finished !== null && existing.meta?.finished !== finished
      if ((!existing.coverUrl && book.coverUrl) || formatChanged || finishedChanged) {
        updatedBooks.push({ existing, incoming: book })
      }
    } else {
      newBooks.push(book)
    }
    knownBookKeys.add(book.sourceBookId)
  }

  const unprocessable = proposal.unprocessable.map((entry) => ({ ...entry }))
  const bump = (reason: string) => {
    const found = unprocessable.find((item) => item.reason === reason)
    if (found) found.count++
    else unprocessable.push({ reason, count: 1 })
  }

  // Existing imported notes keyed by import identity, narrowed to the
  // identities this proposal can touch: a one-book import should not scan
  // every imported note the user has. Chunked because SQLite binds one
  // variable per key. A kind change (e.g. a legado bookmark gained a note)
  // moves the row between the highlight and idea tables.
  const noteKeys = [...new Set(proposal.notes.map((note) => importKey(datasetKey, note.sourceBookId, note.sourceRecordId)))]
  const existingHighlights: HighlightRow[] = []
  const existingIdeas: IdeaRow[] = []
  for (let offset = 0; offset < noteKeys.length; offset += 500) {
    const batch = noteKeys.slice(offset, offset + 500)
    existingHighlights.push(...db.select().from(highlights).where(and(
      eq(highlights.userId, userId), isNotNull(highlights.importKey), inArray(highlights.importKey, batch),
    )).all())
    existingIdeas.push(...db.select().from(ideas).where(and(
      eq(ideas.userId, userId), isNotNull(ideas.importKey), inArray(ideas.importKey, batch),
    )).all())
  }
  const existingReviews = targetIds.length ? db.select().from(bookReviews).where(and(
    eq(bookReviews.userId, userId), isNotNull(bookReviews.importKey), inArray(bookReviews.readBookVersionId, targetIds),
  )).all() : []
  const highlightByKey = new Map(existingHighlights.map((row) => [row.importKey!, row]))
  const ideaByKey = new Map(existingIdeas.map((row) => [row.importKey!, row]))
  const reviewByKey = new Map(existingReviews.map((row) => [row.importKey!, row]))

  const noteWrites: NoteWrite[] = []
  const conflicts: ReadingImportConflict[] = []
  let newNotes = 0
  let updatedNotes = 0
  let unchangedNotes = 0
  const seenNoteIds = new Set<string>()
  for (const note of proposal.notes) {
    const identity = `${note.sourceBookId}|${note.sourceRecordId}`
    if (seenNoteIds.has(identity)) continue
    seenNoteIds.add(identity)
    if (!knownBookKeys.has(note.sourceBookId)) { bump('note-orphan'); continue }
    const key = importKey(datasetKey, note.sourceBookId, note.sourceRecordId)
    const sameKind = note.kind === 'highlight' ? highlightByKey.get(key) : ideaByKey.get(key)
    const movedFrom = note.kind === 'highlight' ? ideaByKey.get(key) : highlightByKey.get(key)
    const existing = sameKind ?? movedFrom
    // Re-baseline import hashes stored before chapter adaptation shipped, so
    // they cannot read as user edits. In-memory only; the next write of the
    // row persists the delivery shape, unchanged rows re-baseline each import.
    if (existing) rebaselineImportHash(existing, note)
    let isNew = false
    let restoreOnly = false
    if (!existing) {
      newNotes++
      isNew = true
    } else if (existing.deletedAt !== null) {
      // The reader deleted this row, and is now asking for the book again.
      // Importing is an explicit act: the record comes back. When the row no
      // longer matches what the source last delivered, the reader edited it
      // before deleting, so only the tombstone is lifted.
      restoreOnly = noteRowFingerprint(existing) !== existing.importHash
      updatedNotes++
    } else if (existing.importHash === noteFingerprint(note)) {
      // Pre-upgrade rows carry no stored source ordinal; a matching re-import
      // still backfills it once so chapter ordering works on TOC-less
      // archives. The chapter ordinal is source metadata, not user content.
      if (existing.importChapterIndex === null && note.chapterIndex !== null) {
        updatedNotes++
      } else {
        unchangedNotes++
        continue
      }
    } else if (noteRowFingerprint(existing) !== existing.importHash) {
      // Both sides moved: the source has a new version and the reader edited
      // the row after the last import. Keeping the local one silently used to
      // land in `unprocessable`, which told nobody which records were involved;
      // it is a real conflict and the reader gets to decide.
      if (!overwriteKeys.has(key)) {
        conflicts.push({
          key,
          kind: note.kind,
          incomingText: note.text,
          localText: existing.text,
          chapter: existing.chapter ?? note.chapter,
          bookKey: note.sourceBookId,
        })
        continue
      }
      updatedNotes++
    } else {
      updatedNotes++
    }
    noteWrites.push({
      sourceBookId: note.sourceBookId,
      note,
      kind: note.kind,
      dropKind: movedFrom ? (note.kind === 'highlight' ? 'idea' : 'highlight') : null,
      isNew,
      restoreOnly,
      overwrite: overwriteKeys.has(key),
    })
  }

  const reviewWrites: ReviewWrite[] = []
  let newReviews = 0
  let updatedReviews = 0
  let unchangedReviews = 0
  const seenReviewIds = new Set<string>()
  for (const review of proposal.reviews) {
    const identity = `${review.sourceBookId}|${review.sourceRecordId}`
    if (seenReviewIds.has(identity)) continue
    seenReviewIds.add(identity)
    if (!knownBookKeys.has(review.sourceBookId)) { bump('review-orphan'); continue }
    const reviewKey = importKey(datasetKey, review.sourceBookId, review.sourceRecordId)
    const existing = reviewByKey.get(reviewKey)
    if (!existing) newReviews++
    else if (reviewFingerprint(review) === reviewRowFingerprint(existing)) {
      unchangedReviews++
      continue
    } else if (existing.importHash === reviewFingerprint(review)) {
      unchangedReviews++
      continue
    } else if (reviewRowFingerprint(existing) !== existing.importHash) {
      if (!overwriteKeys.has(reviewKey)) {
        conflicts.push({
          key: reviewKey,
          kind: 'review',
          incomingText: review.body,
          localText: existing.body ?? '',
          chapter: null,
          bookKey: review.sourceBookId,
        })
        continue
      }
      updatedReviews++
    } else updatedReviews++
    reviewWrites.push({ sourceBookId: review.sourceBookId, review, overwrite: overwriteKeys.has(reviewKey) })
  }

  const existingFacts = db.select().from(readingDurationFacts).where(and(
    eq(readingDurationFacts.userId, userId), eq(readingDurationFacts.source, source), eq(readingDurationFacts.sourceNamespace, datasetKey),
  )).all()
  const factByKey = new Map(existingFacts.map((fact) => [fact.sourceRecordKey, fact]))
  const durationWrites: ImportPlan['durationWrites'] = []
  let newDurationFacts = 0
  let updatedDurationFacts = 0
  let unchangedDurationFacts = 0
  const seenFactKeys = new Set<string>()
  for (const incoming of proposal.durationFacts) {
    if (seenFactKeys.has(incoming.sourceRecordKey)) continue
    seenFactKeys.add(incoming.sourceRecordKey)
    // Account-scoped buckets are no longer a granularity this product stores:
    // they cannot be attributed to a book, and keeping them alongside per-book
    // facts would double-count the same reading (0.10). The enum stays for old
    // rows, but nothing may be produced from it again.
    if (incoming.granularity === 'account_day' || incoming.granularity === 'account_total') { bump('duration-unattributable'); continue }
    if (incoming.sourceBookId !== null && !knownBookKeys.has(incoming.sourceBookId)) { bump('duration-archive-missing'); continue }
    const existing = factByKey.get(incoming.sourceRecordKey)
    if (existing && existing.granularity === incoming.granularity && existing.date === incoming.date
      && existing.durationSeconds === incoming.seconds && existing.aggregationRole === incoming.aggregationRole
      && existing.overlapGroup === (incoming.overlapGroup ?? null)) { unchangedDurationFacts++; continue }
    if (existing) updatedDurationFacts++
    else newDurationFacts++
    durationWrites.push({ incoming, existingId: existing?.id ?? null })
  }

  return {
    newBooks,
    updatedBooks,
    noteWrites,
    reviewWrites,
    durationWrites,
    newDurationFacts,
    updatedDurationFacts,
    unchangedDurationFacts,
    newNotes,
    updatedNotes,
    unchangedNotes,
    newReviews,
    updatedReviews,
    unchangedReviews,
    unprocessable,
    conflicts,
  }
}

/** Book-level preview rows. Status comes from the dataset's stored identity
 * keys in one query; record fingerprints are compared only at apply time, so a
 * preview over hundreds of books never walks every note. Books the scope leaves
 * empty stay in the list, marked not selectable, instead of disappearing. */
export function buildBookItems(
  userId: string,
  source: ReadingImportSource,
  datasetKey: string,
  proposal: ImportProposal,
  scope: ReadingImportScope,
): ReadingImportBookItem[] {
  const db = getDb()
  const bindings = source === 'weread' ? listSourceBindings(userId, source, db) : listBindings(userId, source, datasetKey, db)

  const scoped = scopeProposal(proposal, scope)
  const listMode = proposal.listCounts !== undefined
  const selectable = new Set(scoped.books.map((book) => book.sourceBookId))
  const tally = (keys: string[]) => {
    const counts = new Map<string, number>()
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
    return counts
  }
  const notes = tally(scoped.notes.map((note) => note.sourceBookId))
  const reviews = tally(scoped.reviews.map((review) => review.sourceBookId))
  const facts = tally(scoped.durationFacts.flatMap((fact) => fact.sourceBookId === null ? [] : [fact.sourceBookId]))
  const allNotes = tally(proposal.notes.map((note) => note.sourceBookId))

  return proposal.books.map((book) => ({
    bookKey: book.sourceBookId,
    title: book.title,
    author: book.author || null,
    coverUrl: book.coverUrl,
    // A mounted book keeps its identity after the archive row is deleted, so
    // status comes from the binding rather than from the archive columns.
    status: bindings.get(book.sourceBookId)?.mode === 'mounted'
      ? 'mounted'
      : bindings.has(book.sourceBookId) ? 'imported' : 'new',
    notes: notes.get(book.sourceBookId) ?? proposal.listCounts?.[book.sourceBookId]?.notes ?? 0,
    reviews: reviews.get(book.sourceBookId) ?? proposal.listCounts?.[book.sourceBookId]?.reviews ?? 0,
    durationFacts: facts.get(book.sourceBookId) ?? 0,
    lastReadAt: book.lastReadAt ?? null,
    lastNoteAt: book.lastNoteAt ?? null,
    sortNoteCount: proposal.listCounts?.[book.sourceBookId]?.notes ?? allNotes.get(book.sourceBookId) ?? 0,
    // In list mode the source already dropped what the scope cannot carry, so
    // "listed" and "selectable" are the same thing.
    selectable: listMode || selectable.has(book.sourceBookId),
  }))
}

/** Apply only what the user ticked. `null` means "the whole preview", which is
 * how a caller that predates book-level selection keeps working. */
export function selectProposalBooks(proposal: ImportProposal, bookKeys: string[] | null): ImportProposal {
  if (bookKeys === null) return proposal
  const wanted = new Set(bookKeys)
  return {
    ...proposal,
    books: proposal.books.filter((book) => wanted.has(book.sourceBookId)),
    notes: proposal.notes.filter((note) => wanted.has(note.sourceBookId)),
    reviews: proposal.reviews.filter((review) => wanted.has(review.sourceBookId)),
    durationFacts: proposal.durationFacts.filter((fact) => fact.sourceBookId === null || wanted.has(fact.sourceBookId)),
  }
}

export function buildPreview(userId: string, source: ReadingImportSource, datasetKey: string, proposal: ImportProposal, scope: ReadingImportScope): Omit<ReadingImportPreview, 'previewId'> {
  const scoped = scopeProposal(proposal, scope)
  return {
    source,
    scope,
    items: buildBookItems(userId, source, datasetKey, proposal, scope),
    skipped: scoped.skipped,
    unprocessable: scoped.unprocessable,
  }
}

/** Everything an import decides before touching the database: the write plan,
 * the binding targets it resolves against, and the async locate results. Held
 * as a value so a multi-dataset import can prepare every dataset first and only
 * then start committing — a locate failure then leaves nothing half-applied. */
export interface PreparedImport {
  userId: string
  source: ReadingImportSource
  datasetKey: string
  scope: ReadingImportScope
  plan: ImportPlan
  bindings: Map<string, ImportBinding>
  archiveIdByBookKey: Map<string, string>
  locatedByBook: Map<string, { revisionId: string; positions: Map<string, string>; chapters: Map<string, string> }>
  overwriteKeys: ReadonlySet<string>
  /** Source-reported skips, echoed verbatim in the result. */
  skipped: number
  now: number
}

export async function prepareImport(
  userId: string,
  source: ReadingImportSource,
  datasetKey: string,
  proposal: ImportProposal,
  scope: ReadingImportScope,
  /** Import identities the reader decided to overwrite with the source. */
  overwriteKeys: ReadonlySet<string> = new Set(),
): Promise<PreparedImport> {
  const plan = planChanges(userId, source, datasetKey, proposal, overwriteKeys)
  const db = getDb()
  const now = Date.now()
  const archiveIdByBookKey = new Map<string, string>()
  const bindings = listBindings(userId, source, datasetKey, db)
  // Binding targets already cover both shapes: archive ids for un-mounted
  // books, real book versions for mounted ones. Records are written straight
  // to whatever the binding points at, so a mounted book never grows a second
  // archive.
  for (const [bookKey, binding] of bindings) {
    archiveIdByBookKey.set(bookKey, binding.targetBookVersionId)
  }

  // A mounted book has no archive to mount later, so a record that arrives
  // after the mount has to be placed right here — the same text match the
  // mount runs, against the same revision. Only records that are actually new
  // need it: an existing row keeps the position it already carries. Kept per
  // book so the transaction can re-verify revision and occupancy before use.
  const locatedByBook = new Map<string, { revisionId: string; positions: Map<string, string>; chapters: Map<string, string> }>()
  for (const [bookKey, binding] of bindings) {
    if (binding.mode !== 'mounted') continue
    const incoming = plan.noteWrites.filter((write) => write.isNew && write.sourceBookId === bookKey)
    if (incoming.length === 0) continue
    const located = await locateNotesAgainstBook(userId, binding.targetBookVersionId, incoming.map((write) => ({
      recordId: importKey(datasetKey, write.sourceBookId, write.note.sourceRecordId),
      kind: write.kind,
      text: write.note.text,
      chapter: write.note.chapter,
      locator: write.note.locator,
    })))
    // Two records of one batch can match the same range; the second keeps its
    // text without a position rather than failing the unique index.
    const positions = new Map<string, string>()
    const chapters = new Map<string, string>()
    const used = new Set<string>()
    for (const item of located.items) {
      const cfiRange = item.cfiRange ?? item.fallbackCfiRange
      if (cfiRange === null || used.has(cfiRange)) continue
      used.add(cfiRange)
      positions.set(item.recordId, cfiRange)
      if (item.chapter) chapters.set(item.recordId, item.chapter)
    }
    locatedByBook.set(bookKey, { revisionId: located.targetRevisionId, positions, chapters })
  }

  return { userId, source, datasetKey, scope, plan, bindings, archiveIdByBookKey, locatedByBook, overwriteKeys, skipped: proposal.skipped, now }
}

/** The write half of an import, inside the caller's transaction. Taking `tx`
 * lets a multi-dataset apply commit every group inside ONE transaction: a
 * stale binding or DB error in any group then rolls the whole request back
 * instead of returning an error over already-committed data. */
export function commitImportInTx(tx: Db, prepared: PreparedImport): ReadingImportResult {
  const { userId, source, datasetKey, scope, plan, bindings, archiveIdByBookKey, locatedByBook, skipped, now } = prepared

  {
    // The plan is only as fresh as the preview it came from. A mount between
    // preview and apply would route records to a target the plan never saw,
    // so the identity mapping is re-read here: any drift refuses the import
    // instead of writing through the stale plan.
    const txBindings = listBindings(userId, source, datasetKey, tx)
    for (const [bookKey, binding] of bindings) {
      const current = txBindings.get(bookKey)
      if (!current || current.targetBookVersionId !== binding.targetBookVersionId || current.mode !== binding.mode) {
        throw new AppError('UPDATE_IN_PROGRESS', 'The import plan is stale; run the preview again')
      }
    }

    for (const book of plan.newBooks) {
      const id = createId('ria')
      tx.insert(readingArchives).values({
        userId,
        bookVersionId: id,
        title: book.title,
        author: book.author,
        format: archiveFormatOf(book),
        coverKey: null,
        coverUrl: book.coverUrl,
        importSource: source,
        importAccountKey: datasetKey,
        importBookKey: book.sourceBookId,
        legacyIntervals: [],
        legacyDaily: [],
        legacyWordCount: null,
        legacyRevisionId: null,
        meta: archiveMetaOf(book),
        createdAt: now,
        updatedAt: now,
      }).run()
      createArchiveBinding(tx, {
        userId, source, accountKey: datasetKey, bookKey: book.sourceBookId, archiveId: id, now,
      })
      archiveIdByBookKey.set(book.sourceBookId, id)
    }
    for (const { existing, incoming } of plan.updatedBooks) {
      tx.update(readingArchives).set({
        coverUrl: existing.coverUrl ?? incoming.coverUrl,
        format: existing.format ?? archiveFormatOf(incoming),
        meta: { ...existing.meta, ...archiveMetaOf(incoming) },
        updatedAt: now,
      })
        .where(and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, existing.bookVersionId))).run()
    }
    // Re-verify what the pre-transaction locate saw: a revision change would
    // put every CFI on the wrong bytes, and a highlight created since would
    // trip the unique index and abort the whole import. Dropped positions
    // degrade to unresolved rows, never to a failed import.
    const validPositions = new Map<string, { cfiRange: string; revisionId: string }>()
    const validChapters = new Map<string, string>()
    for (const [bookKey, located] of locatedByBook) {
      const binding = bindings.get(bookKey)
      if (!binding) continue
      if (resolvedRevisionId(tx, userId, binding.targetBookVersionId) !== located.revisionId) continue
      const occupied = new Set(tx.select({ cfiRange: highlights.cfiRange }).from(highlights).where(and(
        eq(highlights.userId, userId),
        eq(highlights.bookVersionId, binding.targetBookVersionId),
      )).all().flatMap((row) => (row.cfiRange ? [row.cfiRange] : [])))
      const used = new Set<string>()
      for (const [recordId, cfiRange] of located.positions) {
        if (occupied.has(cfiRange) || used.has(cfiRange)) continue
        used.add(cfiRange)
        validPositions.set(recordId, { cfiRange, revisionId: located.revisionId })
      }
      for (const [recordId, chapter] of located.chapters) validChapters.set(recordId, chapter)
    }

    for (const { sourceBookId, note, kind, dropKind, isNew, restoreOnly, overwrite } of plan.noteWrites) {
      const archiveId = archiveIdByBookKey.get(sourceBookId)
      if (!archiveId) continue
      const key = importKey(datasetKey, sourceBookId, note.sourceRecordId)
      const deliveredHash = noteFingerprint(note)
      if (restoreOnly) {
        // The reader edited this record and then deleted it. Importing the book
        // again lifts the tombstone, and that is all: their wording wins. The
        // row is also re-homed — a restore after a mount would otherwise keep
        // pointing at the deleted archive.
        const lifted = (tx.update(highlights).set({ deletedAt: null, bookVersionId: archiveId, updatedAt: now })
          .where(and(eq(highlights.userId, userId), eq(highlights.importKey, key), isNotNull(highlights.deletedAt))).run().changes)
          + (tx.update(ideas).set({ deletedAt: null, bookVersionId: archiveId, updatedAt: now })
            .where(and(eq(ideas.userId, userId), eq(ideas.importKey, key), isNotNull(ideas.deletedAt))).run().changes)
        if (lifted > 0) continue
      }
      // The plan compared fingerprints before the possibly slow locate round
      // trips; a note edited in another tab in between keeps its local content
      // and is reported as a conflict, exactly like a both-sides-changed record.
      const staleLocal = [
        tx.select().from(highlights).where(and(eq(highlights.userId, userId), eq(highlights.importKey, key))).get(),
        tx.select().from(ideas).where(and(eq(ideas.userId, userId), eq(ideas.importKey, key))).get(),
      ].find((row) => {
        if (row === undefined) return false
        // The plan re-baselined its copy of the row; the tx re-read needs the
        // same treatment or a pre-adaptation hash reads as a concurrent edit.
        rebaselineImportHash(row, note)
        return noteRowFingerprint(row) !== row.importHash
      })
      if (staleLocal && !overwrite) {
        if (isNew) plan.newNotes--
        else plan.updatedNotes--
        plan.conflicts.push({
          key,
          kind,
          incomingText: note.text,
          localText: staleLocal.text,
          chapter: staleLocal.chapter ?? note.chapter,
          bookKey: sourceBookId,
        })
        continue
      }
      // New records landing in an already-mounted book were placed above; an
      // archive has no text to place them against yet.
      const position = isNew ? validPositions.get(key) ?? null : null
      // Chapter names adapt to the associated book: a located record takes the
      // book's own heading, and an existing row in a mounted book keeps the
      // name it already carries (mount or an earlier import corrected it) —
      // only unmounted archives stay on the raw source string.
      const locatedChapter = validChapters.get(key) ?? null
      const mounted = bindings.get(sourceBookId)?.mode === 'mounted'
      const chapterUpdate = locatedChapter ?? (mounted ? null : note.chapter)
      // Kind moves (a bookmark gaining a note) cross tables: retire the old
      // row before upserting the new kind under the same import identity.
      if (dropKind) {
        const otherTable = dropKind === 'highlight' ? highlights : ideas
        tx.delete(otherTable).where(and(eq(otherTable.userId, userId), eq(otherTable.importKey, key))).run()
      }
      if (kind === 'highlight') {
        tx.insert(highlights).values({
          id: createId('hl'), userId, bookVersionId: archiveId,
          revisionId: position?.revisionId ?? null,
          cfiRange: position?.cfiRange ?? null, cfiAnchor: null, color: noteColor(note), style: DEFAULT_NOTE_STYLE,
          text: note.text, chapter: locatedChapter ?? note.chapter, chapterHref: null,
          relocation: position ? 'ok' : 'unresolved', importKey: key, importHash: deliveredHash, importLocator: note.locator,
          importChapterIndex: note.chapterIndex,
          createdAt: note.createdAt ?? now, updatedAt: note.createdAt ?? now, deletedAt: null,
        }).onConflictDoUpdate({
          target: [highlights.userId, highlights.importKey],
          targetWhere: sql`highlights.import_key IS NOT NULL`,
          set: {
            bookVersionId: archiveId, text: note.text,
            ...(chapterUpdate !== null ? { chapter: chapterUpdate } : {}),
            color: noteColor(note), importLocator: note.locator, importChapterIndex: note.chapterIndex,
            createdAt: note.createdAt ?? now, updatedAt: note.createdAt ?? now, deletedAt: null, importHash: deliveredHash,
          },
        }).run()
      } else {
        tx.insert(ideas).values({
          id: createId('idea'), userId, bookVersionId: archiveId,
          cfiRange: position?.cfiRange ?? null, cfiAnchor: null,
          color: noteColor(note), style: DEFAULT_NOTE_STYLE, text: note.text, note: note.note,
          visibility: 'private', sharedLibraryId: null, sourceLibraryBookVersionId: null,
          revisionId: position?.revisionId ?? null, relocation: position ? 'ok' : 'unresolved',
          importKey: key, importHash: deliveredHash,
          chapter: locatedChapter ?? note.chapter, chapterHref: null, importLocator: note.locator, importChapterIndex: note.chapterIndex, editedAt: null,
          createdAt: note.createdAt ?? now, updatedAt: note.createdAt ?? now, deletedAt: null,
        }).onConflictDoUpdate({
          target: [ideas.userId, ideas.importKey],
          targetWhere: sql`ideas.import_key IS NOT NULL`,
          set: {
            bookVersionId: archiveId, text: note.text, note: note.note,
            ...(chapterUpdate !== null ? { chapter: chapterUpdate } : {}),
            color: noteColor(note), importLocator: note.locator, importChapterIndex: note.chapterIndex,
            createdAt: note.createdAt ?? now, updatedAt: note.createdAt ?? now, deletedAt: null, importHash: deliveredHash,
          },
        }).run()
      }
    }
    for (const { sourceBookId, review, overwrite } of plan.reviewWrites) {
      const archiveId = archiveIdByBookKey.get(sourceBookId)
      if (!archiveId) continue
      const reviewKey = importKey(datasetKey, sourceBookId, review.sourceRecordId)
      // Same transaction-time staleness rule as notes: an edit that landed
      // after the plan was built wins over the source unless explicitly
      // overwritten.
      const staleReview = tx.select().from(bookReviews).where(and(
        eq(bookReviews.userId, userId), eq(bookReviews.importKey, reviewKey),
      )).get()
      if (staleReview && reviewRowFingerprint(staleReview) !== staleReview.importHash && !overwrite) {
        plan.updatedReviews--
        plan.conflicts.push({
          key: reviewKey,
          kind: 'review',
          incomingText: review.body,
          localText: staleReview.body ?? '',
          chapter: null,
          bookKey: sourceBookId,
        })
        continue
      }
      tx.insert(bookReviews).values({
        id: createId('review'), userId,
        privateLibraryBookId: null, sourceLibraryId: null, sourceLibraryBookId: null,
        ratingHalves: review.rating === null ? null : Math.round(review.rating * 2),
        title: null, body: review.body, bodyFormat: 'plain', visibility: 'private',
        readListingId: null, readBookVersionId: archiveId, readRevisionId: null,
        importKey: reviewKey,
        importHash: reviewFingerprint(review),
        createdAt: review.createdAt ?? now, updatedAt: review.createdAt ?? now, editedAt: null,
      }).onConflictDoUpdate({
        target: [bookReviews.userId, bookReviews.importKey],
        targetWhere: sql`book_reviews.import_key IS NOT NULL`,
        set: {
          readBookVersionId: archiveId, body: review.body,
          ratingHalves: review.rating === null ? null : Math.round(review.rating * 2),
          createdAt: review.createdAt ?? now, updatedAt: review.createdAt ?? now,
          importHash: reviewFingerprint(review),
        },
      }).run()
    }
    for (const { incoming, existingId } of plan.durationWrites) {
      const overlapGroup = incoming.overlapGroup ? `${source}:${datasetKey}:${incoming.overlapGroup}` : null
      const values = {
        userId,
        // Facts without a source book are refused in planChanges, so this can
        // only be null for a book whose archive creation was skipped.
        bookVersionId: incoming.sourceBookId === null ? null : archiveIdByBookKey.get(incoming.sourceBookId) ?? null,
        granularity: incoming.granularity,
        date: incoming.date,
        durationSeconds: incoming.seconds,
        aggregationRole: incoming.aggregationRole,
        overlapGroup,
        source,
        sourceNamespace: datasetKey,
        sourceRecordKey: incoming.sourceRecordKey,
        observedAt: now,
      }
      if (existingId) {
        tx.update(readingDurationFacts).set(values).where(and(
          eq(readingDurationFacts.userId, userId), eq(readingDurationFacts.id, existingId),
        )).run()
      } else {
        tx.insert(readingDurationFacts).values({ id: createId('rdf'), ...values }).run()
      }
    }
  }

  return {
    source,
    scope,
    books: { new: plan.newBooks.length, updated: plan.updatedBooks.length },
    notes: { new: plan.newNotes, updated: plan.updatedNotes, unchanged: plan.unchangedNotes },
    reviews: { new: plan.newReviews, updated: plan.updatedReviews, unchanged: plan.unchangedReviews },
    durationFacts: {
      new: plan.newDurationFacts,
      updated: plan.updatedDurationFacts,
      unchanged: plan.unchangedDurationFacts,
    },
    skipped,
    unprocessable: plan.unprocessable,
    conflicts: plan.conflicts,
  }
}

export function commitImport(prepared: PreparedImport): ReadingImportResult {
  const db = getDb()
  return db.transaction((rawTx) => commitImportInTx(rawTx as unknown as Db, prepared))
}

export async function applyImport(
  userId: string,
  source: ReadingImportSource,
  datasetKey: string,
  proposal: ImportProposal,
  scope: ReadingImportScope,
  overwriteKeys: ReadonlySet<string> = new Set(),
): Promise<ReadingImportResult> {
  return commitImport(await prepareImport(userId, source, datasetKey, proposal, scope, overwriteKeys))
}

/** Reuse an existing per-book WeRead target across the Skill and Web channels.
 * A new book keeps the identity of the channel that first imported it. */
export async function applyWereadImport(
  userId: string,
  defaultDatasetKey: string,
  proposal: ImportProposal,
  scope: ReadingImportScope,
  overwriteKeys: ReadonlySet<string> = new Set(),
): Promise<ReadingImportResult> {
  const scoped = scopeProposal(proposal, scope)
  const bindings = listSourceBindings(userId, 'weread')
  const groups = new Map<string, string[]>()
  for (const book of scoped.books) {
    const datasetKey = bindings.get(book.sourceBookId)?.accountKey ?? defaultDatasetKey
    const bookKeys = groups.get(datasetKey) ?? []
    bookKeys.push(book.sourceBookId)
    groups.set(datasetKey, bookKeys)
  }
  // Prepare every dataset before touching the database: the async locate runs
  // here, so a failure while placing one account's records leaves nothing
  // applied.
  const prepared: PreparedImport[] = []
  for (const [datasetKey, bookKeys] of groups) {
    prepared.push(await prepareImport(
      userId,
      'weread',
      datasetKey,
      selectProposalBooks(scoped, bookKeys),
      scope,
      overwriteKeys,
    ))
  }
  // One transaction across every dataset: a stale binding or DB error in any
  // group rolls the whole request back, never an error over committed data.
  const db = getDb()
  return db.transaction((rawTx) => {
    const tx = rawTx as unknown as Db
    const results: ReadingImportResult[] = []
    for (const batch of prepared) results.push(commitImportInTx(tx, batch))
    return results
  }).reduce((result, current) => ({
    ...result,
    books: { new: result.books.new + current.books.new, updated: result.books.updated + current.books.updated },
    notes: { new: result.notes.new + current.notes.new, updated: result.notes.updated + current.notes.updated, unchanged: result.notes.unchanged + current.notes.unchanged },
    reviews: { new: result.reviews.new + current.reviews.new, updated: result.reviews.updated + current.reviews.updated, unchanged: result.reviews.unchanged + current.reviews.unchanged },
    durationFacts: { new: result.durationFacts.new + current.durationFacts.new, updated: result.durationFacts.updated + current.durationFacts.updated, unchanged: result.durationFacts.unchanged + current.durationFacts.unchanged },
    unprocessable: [...result.unprocessable, ...current.unprocessable],
    conflicts: [...result.conflicts, ...current.conflicts],
  }), {
    source: 'weread' as const,
    scope,
    books: { new: 0, updated: 0 },
    notes: { new: 0, updated: 0, unchanged: 0 },
    reviews: { new: 0, updated: 0, unchanged: 0 },
    durationFacts: { new: 0, updated: 0, unchanged: 0 },
    skipped: proposal.skipped,
    unprocessable: [] as ReadingImportResult['unprocessable'],
    conflicts: [] as ReadingImportResult['conflicts'],
  })
}

