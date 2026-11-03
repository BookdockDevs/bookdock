import { DOMParser, Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'
import { and, desc, eq, isNull } from 'drizzle-orm'

import type {
  ReadingImportLocatorItem,
  ReadingImportLocatorReason,
  ReadingImportLocatorReport,
  ReadingImportLocatorResolvedBy,
  ReadingImportLocatorState,
  ReadingImportLocatorWarning,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { contentRevisions, highlights, ideas, libraries, libraryBookVersions, readingArchives } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { getActiveBook } from '../books/books.service'
import { createEpubCfiTextRange } from '../books/epub-cfi-position'
import {
  getReaderManifest,
  readReaderSearchEntry,
  type ReaderContentBook,
} from '../books/reader-content.service'

type Db = ReturnType<typeof getDb>

/** How many matches are worth counting. The report only distinguishes one from
 * many; the cap keeps a one-character note from scanning a whole novel. */
const MAX_HITS = 40

/** Elements whose text is one readable paragraph. A match that needs more than
 * one of these is flagged `cross-paragraph` — it still gets a position (a CFI
 * range spans blocks), but the source joined paragraphs the book keeps apart. */
const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre',
  'td', 'th', 'dd', 'dt', 'figcaption', 'section', 'article', 'aside', 'header', 'footer',
])

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/** Punctuation, symbols and whitespace are exactly what differs between a
 * source's plain-text capture and the book's own markup, so the tolerant pass
 * drops them on both sides. Flags, digits and letters stay. */
const DROP_IN_NORMALIZE = /[\s\p{P}\p{S}]/u

interface Normalized {
  text: string
  /** Raw start index of every normalized character. */
  starts: number[]
  /** Raw end index (exclusive) of every normalized character. */
  ends: number[]
}

export interface LocatorChapter {
  spineIndex: number
  href: string
  text: string
  /** Length of everything but the chapter heading: an image plate with only a
   * title has no searchable body, which is a different failure than "the text
   * is not in this book". */
  bodyLength: number
  blocks: Array<[number, number]>
  heading: string | null
  norm: string
  starts: number[]
  ends: number[]
}

export interface LocatorIndex {
  chapters: LocatorChapter[]
  /** Every chapter concatenated in spine order; used to tell "the book has no
   * text at all" apart from "this text is not in it". */
  textLength: number
  headings: Array<string | null>
}

export interface LocatorNote {
  recordId: string
  kind: 'highlight' | 'idea'
  text: string
  color?: string | null
  style?: string | null
  chapter: string | null
  /** The source's own chapter-relative offset (WeRead `range` start). Ordering
   * evidence only: it shares no scale with our text offsets, so it can bracket
   * a record between neighbours but never be converted into a position.
   * Optional so locating a record stays a pure text question. */
  locator?: string | null
}

export interface RawHit {
  chapter: number
  start: number
  end: number
}

function isTextNode(node: XmlNode): boolean {
  return node.nodeType === 3 || node.nodeType === 4
}

function isElementNode(node: XmlNode): node is XmlElement {
  return node.nodeType === 1
}

/** Plain text and paragraph ranges in document order. The traversal mirrors
 * `epub-cfi-position.ts` (skip `cfi-inert` subtrees, descend everything else),
 * so offsets here are the offsets `createEpubCfiTextRange` expects. */
export function extractChapterText(markup: string): {
  text: string
  blocks: Array<[number, number]>
  heading: string | null
  headingRange: [number, number] | null
} | null {
  const document = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
  const body = document.getElementsByTagName('body')[0]
  if (!body) return null
  let text = ''
  let heading: string | null = null
  let headingRange: [number, number] | null = null
  const blocks: Array<[number, number]> = []

  const visit = (parent: XmlNode) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (isTextNode(child)) {
        text += child.nodeValue ?? ''
        continue
      }
      if (!isElementNode(child)) continue
      if (child.hasAttribute('cfi-inert')) continue
      const tag = (child.localName ?? child.tagName ?? '').toLowerCase()
      const start = text.length
      visit(child)
      if (BLOCK_TAGS.has(tag)) blocks.push([start, text.length])
      if (heading === null && HEADING_TAGS.has(tag)) {
        const candidate = (child.textContent ?? '').trim()
        if (candidate) {
          heading = candidate.slice(0, 200)
          headingRange = [start, text.length]
        }
      }
    }
  }

  visit(body)
  return { text, blocks, heading, headingRange }
}

export function normalizeWithMap(raw: string): Normalized {
  const chars: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!
    // NFKC folds full-width letters/digits and compatibility forms; a single
    // character may expand (e.g. ligatures), in which case every produced
    // character points back at the same raw position.
    for (const part of char.normalize('NFKC')) {
      if (DROP_IN_NORMALIZE.test(part)) continue
      chars.push(part.toLowerCase())
      starts.push(index)
      ends.push(index + 1)
    }
  }
  return { text: chars.join(''), starts, ends }
}

function buildIndex(entries: Array<{ spineIndex: number; href: string; markup: string }>): LocatorIndex {
  const chapters: LocatorChapter[] = []
  for (const entry of entries) {
    const extracted = extractChapterText(entry.markup)
    // A chapter that fails to parse still occupies its spine slot: dropping it
    // would shift every later chapter's CFI.
    const text = extracted?.text ?? ''
    const normalized = normalizeWithMap(text)
    const headingLength = extracted?.headingRange ? extracted.headingRange[1] - extracted.headingRange[0] : 0
    chapters.push({
      spineIndex: entry.spineIndex,
      href: entry.href,
      text,
      bodyLength: text.length - headingLength,
      blocks: extracted?.blocks ?? [],
      heading: extracted?.heading ?? null,
      norm: normalized.text,
      starts: normalized.starts,
      ends: normalized.ends,
    })
  }
  return {
    chapters,
    textLength: chapters.reduce((sum, chapter) => sum + chapter.bodyLength, 0),
    headings: chapters.map((chapter) => chapter.heading),
  }
}

function findRawHits(index: LocatorIndex, needle: string, limit = MAX_HITS): RawHit[] {
  if (!needle) return []
  const hits: RawHit[] = []
  for (const [chapterIndex, chapter] of index.chapters.entries()) {
    let from = 0
    while (hits.length <= limit) {
      const at = chapter.text.indexOf(needle, from)
      if (at < 0) break
      hits.push({ chapter: chapterIndex, start: at, end: at + needle.length })
      from = at + needle.length
    }
    if (hits.length > limit) break
  }
  return hits
}

function findNormalizedHits(index: LocatorIndex, normalizedNeedle: string, limit = MAX_HITS): RawHit[] {
  if (!normalizedNeedle) return []
  const hits: RawHit[] = []
  for (const [chapterIndex, chapter] of index.chapters.entries()) {
    let from = 0
    while (hits.length <= limit) {
      const at = chapter.norm.indexOf(normalizedNeedle, from)
      if (at < 0) break
      const last = at + normalizedNeedle.length - 1
      hits.push({ chapter: chapterIndex, start: chapter.starts[at]!, end: chapter.ends[last]! })
      from = at + normalizedNeedle.length
    }
    if (hits.length > limit) break
  }
  return hits
}

/** Chapter titles are compared loosely: source titles and the book's own
 * headings differ in spacing, punctuation and "第X章" wording, so the digits
 * and ordinals are stripped before comparing. */
function titleKey(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .replace(/^第?[0-9一二三四五六七八九十百千零〇两]+[章节卷回部篇]?/u, '')
    .toLowerCase()
}

const NUMERAL_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const NUMERAL_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

/** Parse the ordinal a chapter title starts with, in either notation. Chinese
 * numerals stop at 千 on purpose: a "万" would need honest scaling, and a wrong
 * number is worse than no hint at all. */
function chapterOrdinal(title: string): number | null {
  const normalized = title.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')
  const match = normalized.match(/^第?([0-9]+|[一二三四五六七八九十百千零〇两]+)[章节卷回部篇]?/u)
  if (!match) return null
  const raw = match[1]!
  if (/^[0-9]+$/.test(raw)) return Number(raw)
  let section = 0
  let number = 0
  for (const char of raw) {
    if (char in NUMERAL_DIGITS) { number = NUMERAL_DIGITS[char]!; continue }
    const unit = NUMERAL_UNITS[char]
    if (unit === undefined) return null
    // "十二" reads as 10 + 2: a bare unit stands for one of itself.
    section += (number === 0 ? 1 : number) * unit
    number = 0
  }
  const total = section + number
  return total > 0 ? total : null
}

export function matchChapterByTitle(index: LocatorIndex, title: string | null): number | null {
  if (!title) return null
  const key = titleKey(title)
  const ordinal = chapterOrdinal(title)
  if (!key && ordinal === null) return null
  let best: { chapter: number; score: number } | null = null
  for (const [chapterIndex, heading] of index.headings.entries()) {
    if (!heading) continue
    const headingKey = titleKey(heading)
    let score = 0
    if (key && headingKey) score = headingKey === key ? 3 : headingKey.includes(key) || key.includes(headingKey) ? 2 : 0
    // A bare "第一章" leaves no words to compare, and a subtitle-less heading
    // ("第29章") has nothing to match the source's "第29章 演员" against. The
    // ordinal is the remaining shared fact; it ranks below a real title match
    // so a similar-but-wrong heading never wins over the right one.
    if (score === 0 && ordinal !== null && chapterOrdinal(heading) === ordinal) score = 2
    if (score > 0 && (!best || score > best.score)) best = { chapter: chapterIndex, score }
  }
  return best?.chapter ?? null
}

function spansBlocks(chapter: LocatorChapter, start: number, end: number): boolean {
  if (end <= start) return false
  return !chapter.blocks.some(([blockStart, blockEnd]) => blockStart <= start && end <= blockEnd)
}

/** How many characters the tolerant pass dropped at each end of the source
 * text. Restoring exactly that many on the book side keeps the range honest:
 * a note ending in "." regains the book's "。", a note wrapped in quotes
 * regains both quotes, and neither grows past what the source actually had. */
function edgeDropCounts(noteText: string): { leading: number; trailing: number } {
  const trimmed = noteText.trim()
  let leading = 0
  while (leading < trimmed.length && DROP_IN_NORMALIZE.test(trimmed[leading]!)) leading += 1
  let trailing = 0
  while (trailing < trimmed.length - leading && DROP_IN_NORMALIZE.test(trimmed[trimmed.length - 1 - trailing]!)) trailing += 1
  return { leading, trailing }
}

/** A tolerant match stops at the last character both sides kept, which cuts
 * the sentence's closing punctuation (and its opening quote) out of the range.
 * Put back what the source's own text shows, and no more. */
function withSurroundingPunctuation(chapter: LocatorChapter, start: number, end: number, noteText: string): [number, number] {
  const { leading, trailing } = edgeDropCounts(noteText)
  let from = start
  let to = end
  for (let step = 0; step < leading && from > 0 && DROP_IN_NORMALIZE.test(chapter.text[from - 1]!); step += 1) from -= 1
  for (let step = 0; step < trailing && to < chapter.text.length && DROP_IN_NORMALIZE.test(chapter.text[to]!); step += 1) to += 1
  return [from, to]
}

export interface LocatedNote {
  state: ReadingImportLocatorState
  hits: number
  chapter: number | null
  warning: ReadingImportLocatorWarning | null
  reason: ReadingImportLocatorReason | null
  start: number | null
  end: number | null
  /** Unresolved candidates, kept so the report can bracket them between
   * neighbours before giving up. Empty unless the state is `ambiguous`. */
  candidates: RawHit[]
}

/** Decide whether one record can carry a position. Pure: it only reads the
 * index, so the three states are testable without a database or a file. */
export function locateNote(note: LocatorNote, index: LocatorIndex): LocatedNote {
  const text = note.text
  if (!text.trim()) return { state: 'missing', hits: 0, chapter: null, warning: null, reason: 'not-found', start: null, end: null, candidates: [] }
  const hint = matchChapterByTitle(index, note.chapter)

  const exact = findRawHits(index, text)
  const normalized = findNormalizedHits(index, normalizeWithMap(text).text)
  const resolved = exact.length > 0
    ? { hits: exact, warning: null as ReadingImportLocatorWarning | null }
    : { hits: normalized, warning: normalized.length === 1 ? 'punctuation' as const : null }

  if (resolved.hits.length === 0) {
    const hintedEmpty = hint !== null && index.chapters[hint]!.bodyLength === 0
    return {
      state: 'missing', hits: 0, chapter: null, warning: null, start: null, end: null,
      reason: index.textLength === 0 || hintedEmpty ? 'no-text' : 'not-found',
      candidates: [],
    }
  }

  let chosen: RawHit
  let warning = resolved.warning
  if (resolved.hits.length === 1) {
    chosen = resolved.hits[0]!
  } else {
    // More than one place holds the text. The source's chapter is the only
    // text-level disambiguator available; if it does not single one out, the
    // record is ambiguous and migrates without a position.
    const inHint = hint === null ? [] : resolved.hits.filter((hit) => hit.chapter === hint)
    if (inHint.length !== 1) {
      // Still no position, but the chapter itself is not in doubt when the
      // source named one and the text does live there. Saying "第29章 · 该章 2
      // 处" is what lets a reader recognise the record; saying "书里 8 处、位置
      // 未知" throws away a fact the engine already established.
      const knownChapter = inHint.length > 0 ? hint : null
      return {
        state: 'ambiguous',
        hits: inHint.length > 0 ? inHint.length : resolved.hits.length,
        chapter: knownChapter,
        // A punctuation-normalized match is still not a clean match, even when
        // it stays unresolved; dropping the warning here would hide why.
        warning: resolved.warning,
        reason: null, start: null, end: null,
        candidates: inHint.length > 0 ? inHint : resolved.hits,
      }
    }
    chosen = inHint[0]!
    warning = resolved.warning
  }

  if (resolved.warning === 'punctuation') {
    const chapter = index.chapters[chosen.chapter]!
    const [start, end] = withSurroundingPunctuation(chapter, chosen.start, chosen.end, text)
    chosen = { ...chosen, start, end }
  }

  const chapter = index.chapters[chosen.chapter]!
  if (hint !== null && hint !== chosen.chapter) warning = 'chapter-mismatch'
  else if (warning === null && spansBlocks(chapter, chosen.start, chosen.end)) warning = 'cross-paragraph'

  return { state: 'located', hits: 1, chapter: chosen.chapter, warning, reason: null, start: chosen.start, end: chosen.end, candidates: [] }
}

/** A record that already has a position, used as an ordering landmark. */
export interface OrderAnchor {
  chapter: number
  source: number
  start: number
  end: number
}

export interface OrderPending {
  chapter: number
  source: number
  candidates: RawHit[]
}

/** How far a candidate may sit outside a bracket and still be considered inside.
 * Punctuation restoration moves a resolved range by a character or two, so the
 * anchor's edge and the candidate's edge need not line up exactly. The slack only
 * ever admits more candidates; the one-left rule still has to hold. */
const ORDER_SLACK = 2

/** Order-only disambiguation, run after every record has been classified.
 *
 * Inside one chapter the source's offset grows monotonically with reading order,
 * and so does our text offset, so a record must sit after every anchor with a
 * smaller source offset and before every one with a larger. Only the nearest
 * neighbour on each side matters — the rest imply it.
 *
 * This never converts a source offset into a position: the two scales differ
 * (verified against 30 records, delta 619–1969 and not even constant within a
 * chapter), so the bracket says *order*, not *distance*. A record is promoted
 * only when exactly one candidate is left inside it; otherwise it stays
 * ambiguous, which is what "do not guess" means here. */
export function resolveByOrder(pending: OrderPending[], anchors: OrderAnchor[]): Array<RawHit | null> {
  const byChapter = new Map<number, OrderAnchor[]>()
  for (const anchor of anchors) {
    const list = byChapter.get(anchor.chapter)
    if (list) list.push(anchor)
    else byChapter.set(anchor.chapter, [anchor])
  }
  return pending.map((entry) => {
    const same = byChapter.get(entry.chapter)
    if (!same) return null
    let lower: OrderAnchor | null = null
    let upper: OrderAnchor | null = null
    for (const anchor of same) {
      if (anchor.source < entry.source && (lower === null || anchor.source > lower.source)) lower = anchor
      if (anchor.source > entry.source && (upper === null || anchor.source < upper.source)) upper = anchor
    }
    if (lower === null && upper === null) return null
    const inside = entry.candidates.filter((candidate) => candidate.chapter === entry.chapter
      && (lower === null || candidate.start >= lower.end - ORDER_SLACK)
      && (upper === null || candidate.end <= upper.start + ORDER_SLACK))
    return inside.length === 1 ? inside[0]! : null
  })
}

function loadSourceNotes(userId: string, archiveId: string): LocatorNote[] {
  const db = getDb()
  const highlightRows = db.select({
    id: highlights.id,
    text: highlights.text,
    color: highlights.color,
    style: highlights.style,
    chapter: highlights.chapter,
    importLocator: highlights.importLocator,
    importChapterIndex: highlights.importChapterIndex,
    createdAt: highlights.createdAt,
  }).from(highlights).where(and(
    eq(highlights.userId, userId),
    eq(highlights.bookVersionId, archiveId),
    isNull(highlights.deletedAt),
  )).all()
  const ideaRows = db.select({
    id: ideas.id,
    text: ideas.text,
    color: ideas.color,
    style: ideas.style,
    chapter: ideas.chapter,
    importLocator: ideas.importLocator,
    importChapterIndex: ideas.importChapterIndex,
    createdAt: ideas.createdAt,
  }).from(ideas).where(and(
    eq(ideas.userId, userId),
    eq(ideas.bookVersionId, archiveId),
    isNull(ideas.deletedAt),
  )).all()

  const allNotes = [
    ...highlightRows.map((row) => ({
      recordId: row.id,
      kind: 'highlight' as const,
      text: row.text,
      color: row.color,
      style: row.style,
      chapter: row.chapter,
      locator: row.importLocator,
      importChapterIndex: row.importChapterIndex,
      createdAt: row.createdAt,
    })),
    ...ideaRows.map((row) => ({
      recordId: row.id,
      kind: 'idea' as const,
      text: row.text,
      color: row.color,
      style: row.style,
      chapter: row.chapter,
      locator: row.importLocator,
      importChapterIndex: row.importChapterIndex,
      createdAt: row.createdAt,
    })),
  ]

  // 按阅读进度排序（先按来源章节序号，同章节内按正文偏移量，无偏移或相同时按记录创建时间）
  allNotes.sort((a, b) => {
    if (a.importChapterIndex != null && b.importChapterIndex != null && a.importChapterIndex !== b.importChapterIndex) {
      return a.importChapterIndex - b.importChapterIndex
    }
    const aLoc = Number(a.locator)
    const bLoc = Number(b.locator)
    if (Number.isFinite(aLoc) && Number.isFinite(bLoc) && aLoc !== bLoc) {
      return aLoc - bLoc
    }
    return a.createdAt - b.createdAt || a.recordId.localeCompare(b.recordId)
  })

  return allNotes.map(({ importChapterIndex: _, createdAt: __, ...note }) => note)
}

async function readSpineMarkup(book: ReaderContentBook): Promise<Array<{ spineIndex: number; href: string; markup: string }>> {
  const manifest = await getReaderManifest(book)
  const entries: Array<{ spineIndex: number; href: string; markup: string }> = []
  for (const [spineIndex, item] of manifest.spine.entries()) {
    if (!item.linear) continue
    if (!/html|xml/i.test(item.mediaType)) continue
    const entry = await readReaderSearchEntry(book, item.path)
    const markup = entry ? Buffer.from(entry.data).toString('utf8') : ''
    entries.push({ spineIndex, href: item.path, markup })
  }
  return entries
}

export async function buildLocatorReport(
  userId: string,
  archiveId: string,
  targetBookVersionId: string,
): Promise<ReadingImportLocatorReport> {
  if (!archiveId || archiveId === targetBookVersionId) {
    throw new AppError('VALIDATION_ERROR', 'Choose a different target book')
  }
  const archive = getDb().select().from(readingArchives)
    .where(and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, archiveId))).get()
  if (!archive) throw new AppError('NOT_FOUND', 'Archive not found')

  const result = await locateNotesAgainstBook(userId, targetBookVersionId, loadSourceNotes(userId, archiveId))
  // Only records that actually kept a position are counted as warnings; CFI
  // generation can still turn one into a missing record, and a warning that
  // promised a position it does not have would be misleading.
  const locatedOnly = result.items.filter((item) => item.state === 'located')
  const warningCount = (warning: ReadingImportLocatorWarning) => locatedOnly.filter((item) => item.warning === warning).length

  return {
    archiveId,
    targetBookVersionId,
    targetRevisionId: result.targetRevisionId,
    chapters: result.chapters,
    total: result.items.length,
    located: locatedOnly.length,
    ambiguous: result.items.filter((item) => item.state === 'ambiguous').length,
    missing: result.items.filter((item) => item.state === 'missing').length,
    conflict: result.items.filter((item) => item.state === 'conflict').length,
    warnings: {
      punctuation: warningCount('punctuation'),
      crossParagraph: warningCount('cross-paragraph'),
      chapterMismatch: warningCount('chapter-mismatch'),
    },
    items: result.items,
  }
}

/** The revision a read of this version resolves to, mirroring
 * `resolvePrivateBook`: a shared card reads its pinned revision, a personal one
 * the newest revision. Used inside the mount/import transactions to prove the
 * located positions still describe the bytes about to receive them. */
export function resolvedRevisionId(db: Db, userId: string, bookVersionId: string): string | null {
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) return null
  const pinned = db.select({ pinnedRevisionId: libraryBookVersions.pinnedRevisionId })
    .from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.libraryId, library.id),
      eq(libraryBookVersions.bookVersionId, bookVersionId),
    )).get()
  if (pinned?.pinnedRevisionId) {
    const pinnedRevision = db.select({ id: contentRevisions.id }).from(contentRevisions)
      .where(and(
        eq(contentRevisions.id, pinned.pinnedRevisionId),
        eq(contentRevisions.bookVersionId, bookVersionId),
      )).get()
    if (pinnedRevision) return pinnedRevision.id
  }
  return db.select({ id: contentRevisions.id }).from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)?.id ?? null
}

export interface LocateNotesResult {
  targetRevisionId: string
  chapters: number
  items: ReadingImportLocatorItem[]
}

/** Locate a batch of records against a book.
 *
 * Split out of the report so that writing can use it too: a record imported
 * into an already-mounted book needs the same text match the mount performed,
 * and it has to happen at import time because there is no archive left to
 * mount afterwards. `recordId` is only a handle the caller uses to map results
 * back; nothing here reads or writes the database beyond the occupancy check. */
export async function locateNotesAgainstBook(
  userId: string,
  targetBookVersionId: string,
  notes: LocatorNote[],
): Promise<LocateNotesResult> {
  const book = await getActiveBook(userId, targetBookVersionId)
  const index = buildIndex(await readSpineMarkup(book))

  const db = getDb()
  // Occupancy includes soft-deleted rows: the unique index behind the write
  // does, so a new note landing on a deleted highlight's range must lose its
  // position here instead of aborting the whole import transaction.
  const occupied = new Set(db.select({ cfiRange: highlights.cfiRange }).from(highlights).where(and(
    eq(highlights.userId, userId),
    eq(highlights.bookVersionId, targetBookVersionId),
  )).all().flatMap((row) => (row.cfiRange ? [row.cfiRange] : [])))

  // One parse per located chapter, cached: most records cluster in a few
  // chapters and re-reading the entry for every CFI would dominate the run.
  const markupByChapter = new Map<number, string>()
  const markupFor = async (chapterIndex: number): Promise<string | null> => {
    const cached = markupByChapter.get(chapterIndex)
    if (cached !== undefined) return cached
    const target = index.chapters[chapterIndex]
    if (!target) return null
    const entry = await readReaderSearchEntry(book, target.href)
    const value = entry ? Buffer.from(entry.data).toString('utf8') : ''
    markupByChapter.set(chapterIndex, value)
    return value
  }

  // Pass 1: classify on text alone. Pass 2 (below) brackets what is left
  // between records the text already pinned down.
  const classified = notes.map((note) => ({ note, located: locateNote(note, index) }))
  const sourceOffset = (note: LocatorNote): number | null => {
    if (!note.locator) return null
    const value = Number(note.locator)
    return Number.isFinite(value) ? value : null
  }

  const anchors: OrderAnchor[] = classified.flatMap(({ note, located }) => {
    const source = sourceOffset(note)
    if (source === null) return []
    if (located.state !== 'located' || located.start === null || located.end === null || located.chapter === null) return []
    return [{ chapter: located.chapter, source, start: located.start, end: located.end }]
  })

  const pendingAt: number[] = []
  const pending: OrderPending[] = []
  for (const [position, { note, located }] of classified.entries()) {
    const source = sourceOffset(note)
    if (source === null) continue
    if (located.state !== 'ambiguous' || located.chapter === null) continue
    pendingAt.push(position)
    pending.push({ chapter: located.chapter, source, candidates: located.candidates })
  }
  const promoted = new Map<number, RawHit>()
  for (const [slot, hit] of resolveByOrder(pending, anchors).entries()) {
    if (hit) promoted.set(pendingAt[slot]!, hit)
  }

  const items: ReadingImportLocatorItem[] = []
  for (const [position, entry] of classified.entries()) {
    const note = entry.note
    const orderHit = promoted.get(position)
    // A promoted record is a real match: the bracket only ever removed
    // candidates, it never moved one.
    const located = orderHit
      ? { ...entry.located, state: 'located' as const, hits: 1, start: orderHit.start, end: orderHit.end, chapter: orderHit.chapter }
      : entry.located
    let resolvedBy: ReadingImportLocatorResolvedBy | null = orderHit ? 'order' : located.state === 'located' ? 'text' : null
    let state = located.state
    let cfiRange: string | null = null
    let fallbackCfiRange: string | null = null
    const chapterHeading = located.chapter === null ? null : index.chapters[located.chapter]!.heading
    if (located.state === 'located' && located.start !== null && located.end !== null && located.chapter !== null) {
      // Promotion uses the raw candidate range, which punctuation restoration
      // never touched; restore it before turning the range into a CFI.
      const [start, end] = orderHit && located.warning === 'punctuation'
        ? withSurroundingPunctuation(index.chapters[located.chapter]!, located.start, located.end, note.text)
        : [located.start, located.end]
      const chapterMarkup = await markupFor(located.chapter)
      cfiRange = chapterMarkup === null || chapterMarkup === ''
        ? null
        : createEpubCfiTextRange(chapterMarkup, index.chapters[located.chapter]!.spineIndex, start, end)
      // A chapter without usable markup behaves like a missing position; it is
      // not "located" if no CFI came out of it.
      if (cfiRange === null) state = 'missing'
      else if (occupied.has(cfiRange)) {
        // 0.10: colliding records still migrate, without a position.
        state = 'conflict'
        cfiRange = null
      }
    } else if (located.state === 'ambiguous' && located.candidates.length > 0) {
      // First candidate in book order: chapter ascending, then text offset.
      // Book order (not source order, not "nearest neighbour") keeps the fallback
      // stable across runs: re-importing or resolving another record can never
      // move it. A collision with an existing highlight yields no fallback at
      // all, so migration leaves the note unpositioned instead of fighting the
      // unique index.
      const first = [...located.candidates].sort((a, b) => a.chapter - b.chapter || a.start - b.start)[0]!
      const chapter = index.chapters[first.chapter]
      if (chapter) {
        const [start, end] = located.warning === 'punctuation'
          ? withSurroundingPunctuation(chapter, first.start, first.end, note.text)
          : [first.start, first.end]
        const chapterMarkup = await markupFor(first.chapter)
        const candidate = chapterMarkup ? createEpubCfiTextRange(chapterMarkup, chapter.spineIndex, start, end) : null
        if (candidate !== null && !occupied.has(candidate)) fallbackCfiRange = candidate
      }
    }
    // A record with no position has no "how", whatever the first pass thought.
    if (cfiRange === null) resolvedBy = null
    items.push({
      recordId: note.recordId,
      kind: note.kind,
      text: note.text,
      color: note.color ?? null,
      style: note.style ?? null,
      state,
      hits: located.hits,
      chapter: chapterHeading,
      sourceChapter: note.chapter,
      warning: located.warning,
      reason: located.reason,
      resolvedBy,
      cfiRange,
      fallbackCfiRange,
    })
  }
  // Only records that actually kept a position are counted as warnings; CFI
  // generation can still turn one into a missing record, and a warning that
  // promised a position it does not have would be misleading.
  return { targetRevisionId: book.revisionId, chapters: index.chapters.length, items }
}

/** Exposed for tests: build an index straight from markup, no file involved. */
export function buildLocatorIndexFromMarkup(entries: Array<{ spineIndex: number; href: string; markup: string }>): LocatorIndex {
  return buildIndex(entries)
}
