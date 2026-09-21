import type { BookFormat, ReadStatus } from './constants'

export interface User {
  id: string
  username: string
  passwordHash: string | null
  role: 'owner' | 'member' | 'guest'
  /** Content-hash addressed avatar blob key (`<hh>/<sha256>.<ext>`), null when unset */
  avatarKey: string | null
  createdAt: number
}

export interface Book {
  id: string
  userId: string
  title: string
  author: string
  format: BookFormat
  filePath: string
  coverKey: string | null
  size: number
  meta: Record<string, unknown>
  createdAt: number
  updatedAt: number
  readStatus: ReadStatus
  lastReadAt?: number | null
  deletedAt: number | null
  /** Single-shelf membership; null = uncategorized */
  shelfId: string | null
}

export interface Shelf {
  id: string
  userId: string
  name: string
  sortOrder: number
  createdAt: number
}

export interface Tag {
  id: string
  userId: string
  name: string
}

export interface BookTag {
  bookId: string
  tagId: string
}

export interface ReadingProgress {
  id: string
  userId: string
  bookId: string
  cfi: string | null
  chapter: string | null
  percent: number
  updatedAt: number
}

export interface Settings {
  id: string
  userId: string
  key: string
  value: unknown
}

export interface ReadingRecord {
  id: string
  userId: string
  bookId: string
  /** Local calendar day of the session start, 'YYYY-MM-DD' */
  date: string
  durationSeconds: number
}

/**
 * Per-book reading-setting overrides (F1 layering). Stored as
 * `books.meta.viewSettings`; only the first-batch core typography keys are
 * supported so far. Dual-backing keys (pageWidth/horizontalPadding/
 * verticalPadding) carry both the flat value and the mode-specific backing,
 * mirroring the global ui.store model.
 */
export interface ViewSettings {
  fontSize?: number
  lineHeight?: number
  pageWidth?: number
  horizontalPadding?: number
  verticalPadding?: number
  pageColumns?: number
  columnGap?: number
  scrollPageWidth?: number
  scrollHorizontalPadding?: number
  scrollVerticalPadding?: number
  pagePageWidth?: number
  pageHorizontalPadding?: number
  pageVerticalPadding?: number
}

export type ReplacementMatchType = 'pattern' | 'point'

export type ReplacementScope = 'book' | 'global'
export type ReplacementApplyTo = 'content' | 'title' | 'both'

export interface TextReplacement {
  id: string
  userId: string
  /** Null = user-global pattern rule; set = book-scoped (point patches always carry their book) */
  bookId: string | null
  matchType: ReplacementMatchType
  /** Required for matchType 'pattern'; null for point patches */
  pattern: string | null
  /** Null/empty = delete (hide) the matched content */
  replacement: string | null
  isRegex: boolean
  applyTo: ReplacementApplyTo
  enabled: boolean
  name: string | null
  /** Lightweight grouping label, list display only */
  group: string | null
  /** Point-patch anchors (matchType 'point' only) */
  spineHref: string | null
  textOffset: number | null
  originalText: string | null
  createdAt: number
  updatedAt: number
}

/**
 * One level of a TOC rule (Sigil-style). Each pattern is scanned against the
 * whole normalized text independently; a hit pins that line to this level.
 * Patterns are stored in ascending level order, with exactly one pattern per
 * level (a single level is a flat rule).
 */
export interface TocRulePattern {
  /** Nesting order and pattern position (1 = top-level chapter). */
  level: number
  /** Regex (JS flavour), matched with 'g' + 'm' flags against the whole text. */
  regex: string
  /** Optional `$1`-style replacement to clean the matched line into a title. */
  replacement: string | null
  enabled: boolean
}

/** A named, reusable preset of TOC patterns, owned per user. */
export interface TocRule {
  id: string
  userId: string
  name: string
  /** Show in the picker / allowed to participate in auto-scoring. */
  enabled: boolean
  /** Display + auto-scoring priority (ascending; ties prefer lower value). */
  sortOrder: number
  patterns: TocRulePattern[]
  createdAt: number
  updatedAt: number
}

export type AnnotationType = 'highlight' | 'note' | 'bookmark'

export type AnnotationStyle = 'underline' | 'squiggly' | 'highlight'

export interface Annotation {
  id: string
  userId: string
  bookId: string
  cfiRange: string
  cfiAnchor: string | null
  type: AnnotationType
  color: string
  style: AnnotationStyle
  text: string
  note: string | null
  chapter: string | null
  chapterHref?: string | null
  createdAt: number
  updatedAt: number
}
