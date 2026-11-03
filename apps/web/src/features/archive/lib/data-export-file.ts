import type {
  AnnotationRes,
  ArchiveDataExport,
  NotesExportBook,
  NotesExportReview,
  ReadingImportScope,
} from '@bookdock/shared'

import { COLOR_LABEL_KEYS, STYLE_LABEL_KEYS } from '@/features/reader/components/annotation-colors'
import type { useTranslation } from '@/hooks/useTranslation'
import { formatDateTime } from '@/lib/format-date'
import {
  buildAnnotationCsv,
  buildAnnotationMarkdown,
  buildAnnotationText,
  csvCell,
  type AnnotationExportBook,
  type AnnotationExportFormat,
  type AnnotationExportLabels,
  type AnnotationExportOptions,
} from '@/features/reader/lib/annotation-export'

export type Translator = ReturnType<typeof useTranslation>
export type ArchiveExportFormat = 'json' | AnnotationExportFormat

/** JSON is the lossless archive everywhere; the human-readable formats are
 * scope-gated: notes reuse the annotation exporters, time flattens the
 * additive duration facts, and "all" becomes a markdown reading report. */
export const ARCHIVE_EXPORT_FORMATS_BY_SCOPE = {
  all: ['json', 'markdown'],
  time: ['json', 'csv'],
  notes: ['json', 'markdown', 'text', 'csv'],
} as const satisfies Record<ReadingImportScope, readonly ArchiveExportFormat[]>

export function narrowArchiveExportFormat(scope: ReadingImportScope, format: ArchiveExportFormat): ArchiveExportFormat {
  return (ARCHIVE_EXPORT_FORMATS_BY_SCOPE[scope] as readonly ArchiveExportFormat[]).includes(format) ? format : 'json'
}

export function archiveExportExtension(format: ArchiveExportFormat): string {
  if (format === 'markdown') return 'md'
  if (format === 'text') return 'txt'
  return format
}

export function archiveExportMime(format: ArchiveExportFormat): string {
  if (format === 'json') return 'application/json'
  if (format === 'csv') return 'text/csv;charset=utf-8'
  return 'text/plain;charset=utf-8'
}

export function archiveExportFormatLabel(format: ArchiveExportFormat, t: Translator): string {
  if (format === 'text') return t('annotation.exportText')
  if (format === 'csv') return t('annotation.exportCsv')
  return format === 'json' ? 'JSON' : 'Markdown'
}

const SCOPE_LABEL_KEYS = {
  all: 'readingData.scopeAll',
  time: 'readingData.scopeTime',
  notes: 'readingData.scopeNotes',
} as const

/** Filename mirrors the annotation export convention: human subject (the
 * book title for single-book exports, otherwise the account username) +
 * scope + timestamp. The opaque bookVersionId is left out on purpose —
 * title plus timestamp keeps files recognizable without id noise. */
export function archiveExportFilename(
  opts: { scope: ReadingImportScope; bookTitle?: string | null; username?: string | null },
  t: Translator,
): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')
  const subject = opts.bookTitle || opts.username || 'bookdock'
  return t('readingData.exportFilename', { subject, scope: t(SCOPE_LABEL_KEYS[opts.scope]), timestamp })
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Archive exports use fixed options: the full detail set, chapter grouping,
 * no deep links (the detached/id-less books of a multi-book export make them
 * unreliable). */
const ARCHIVE_NOTE_OPTIONS: AnnotationExportOptions = {
  includeDetails: true,
  includeTime: true,
  includeDeepLink: false,
  groupByChapter: true,
}

function buildAnnotationLabels(t: Translator): AnnotationExportLabels {
  return {
    author: t('annotation.exportAuthor'),
    bookmark: t('annotation.bookmark'),
    highlight: t('annotation.drawHighlight'),
    idea: t('annotation.idea'),
    unnamedBookmark: t('annotation.exportUnnamedBookmark'),
    separator: t('annotation.exportLabelSeparator'),
    recordedAt: t('annotation.exportTime'),
    openInBook: t('annotation.exportOpenLink'),
    color: (color) => (COLOR_LABEL_KEYS[color] ? t(COLOR_LABEL_KEYS[color]) : color),
    style: (style) => (STYLE_LABEL_KEYS[style] ? t(STYLE_LABEL_KEYS[style]) : style),
  }
}

function toExportBook(book: NotesExportBook): AnnotationExportBook {
  return { id: book.bookId ?? '', title: book.title ?? '', author: book.author ?? '' }
}

function toAnnotations(book: NotesExportBook): AnnotationRes[] {
  const bookId = book.bookId ?? ''
  const items: AnnotationRes[] = []
  for (const item of book.highlights) {
    items.push({
      id: item.id, bookId, type: 'highlight', color: item.color, style: item.style, text: item.text,
      note: null, chapter: item.chapter, chapterHref: item.chapterHref,
      cfiRange: item.cfiRange, cfiAnchor: item.cfiAnchor, createdAt: item.createdAt, updatedAt: item.updatedAt,
    })
  }
  for (const item of book.ideas) {
    items.push({
      id: item.id, bookId, type: 'highlight', color: item.color, style: item.style, text: item.text,
      note: item.note, chapter: item.chapter, chapterHref: item.chapterHref,
      cfiRange: item.cfiRange, cfiAnchor: item.cfiAnchor, createdAt: item.createdAt, updatedAt: item.updatedAt,
    })
  }
  for (const item of book.bookmarks) {
    items.push({
      id: item.id, bookId, type: 'bookmark', color: 'yellow', style: 'highlight', text: item.title ?? '',
      note: null, contextText: item.contextText, chapter: item.chapter, chapterHref: item.chapterHref,
      cfiRange: item.cfi, cfiAnchor: null, createdAt: item.createdAt, updatedAt: item.updatedAt,
    })
  }
  return items.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

function ratingText(rating: number): string {
  const full = Math.floor(rating)
  return `${'★'.repeat(full)}${rating - full > 0 ? '½' : ''}`
}

function reviewHeading(review: NotesExportReview): string {
  return review.workTitle ?? review.title ?? '—'
}

function buildReviewsMarkdown(data: ArchiveDataExport, t: Translator): string {
  const reviews = data.reviews ?? []
  if (reviews.length === 0) return ''
  const lines: string[] = [`# ${t('archive.reviews')}`, '']
  for (const review of reviews) {
    lines.push(`## ${reviewHeading(review)}`, '')
    if (review.rating !== null) lines.push(`- ${ratingText(review.rating)}`)
    lines.push(`- ${t('annotation.exportTime')}${t('annotation.exportLabelSeparator')}${formatDateTime(review.createdAt)}`, '')
    if (review.body) lines.push(review.body, '')
  }
  return lines.join('\n')
}

function buildReviewsText(data: ArchiveDataExport, t: Translator): string {
  const reviews = data.reviews ?? []
  if (reviews.length === 0) return ''
  const lines: string[] = [t('archive.reviews'), '']
  for (const review of reviews) {
    lines.push(reviewHeading(review))
    if (review.rating !== null) lines.push(ratingText(review.rating))
    lines.push(`${t('annotation.exportTime')}${t('annotation.exportLabelSeparator')}${formatDateTime(review.createdAt)}`)
    if (review.body) lines.push(review.body)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

function buildNotesMarkdown(data: ArchiveDataExport, t: Translator, labels: AnnotationExportLabels): string {
  const sections = (data.books ?? []).map((book) =>
    buildAnnotationMarkdown(toAnnotations(book), toExportBook(book), ARCHIVE_NOTE_OPTIONS, labels))
  return [...sections, buildReviewsMarkdown(data, t)].filter(Boolean).join('\n\n').trimEnd()
}

function buildNotesText(data: ArchiveDataExport, t: Translator, labels: AnnotationExportLabels): string {
  const sections = (data.books ?? []).map((book) =>
    buildAnnotationText(toAnnotations(book), toExportBook(book), ARCHIVE_NOTE_OPTIONS, labels))
  const reviews = buildReviewsText(data, t)
  return [...sections, reviews].filter(Boolean).join('\n\n').trimEnd()
}

function buildNotesCsv(data: ArchiveDataExport): string {
  const exports = (data.books ?? []).map((book) => ({
    book: toExportBook(book),
    annotations: toAnnotations(book),
  }))
  if (exports.length === 0) return buildAnnotationCsv([], { id: '', title: '', author: '' }, ARCHIVE_NOTE_OPTIONS)
  // One table across books: the header column set is shared, later blocks
  // drop their repeated header line.
  const [first, ...rest] = exports.map(({ book, annotations }) => buildAnnotationCsv(annotations, book, ARCHIVE_NOTE_OPTIONS))
  return rest.reduce((all, block) => all + block.slice(block.indexOf('\n') + 1), first!)
}

function formatDuration(seconds: number, t: Translator): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('readingData.compactHoursMinutes', { h: hours, m: minutes })
  return t('readingData.compactMinutes', { n: seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0 })
}

function buildDurationSection(data: ArchiveDataExport, t: Translator): string {
  // Mirror the ledger's per-book additive total: sum every additive fact of
  // book granularity, exactly like aggregateDurationFacts' bookAdditive.
  const totals = new Map<string, { title: string; author: string; seconds: number }>()
  for (const fact of data.durationFacts ?? []) {
    if (fact.aggregationRole !== 'additive' || !fact.granularity.startsWith('book_')) continue
    const key = fact.archiveId ?? `title:${fact.title ?? ''}`
    const entry = totals.get(key) ?? { title: fact.title ?? '', author: fact.author ?? '', seconds: 0 }
    entry.seconds += fact.durationSeconds
    totals.set(key, entry)
  }
  if (totals.size === 0) return ''
  const lines = [`## ${t('readingData.duration')}`, '']
  for (const { title, author, seconds } of [...totals.values()].sort((a, b) => b.seconds - a.seconds)) {
    lines.push(`- ${title || '—'}${author ? ` (${author})` : ''}${t('annotation.exportLabelSeparator')}${formatDuration(seconds, t)}`)
  }
  return lines.join('\n')
}

function buildArchiveReport(data: ArchiveDataExport, t: Translator, labels: AnnotationExportLabels): string {
  const header = [
    `# ${t('readingData.exportReportTitle')}`,
    '',
    `${t('readingData.exportExportedAt')}${t('annotation.exportLabelSeparator')}${formatDateTime(data.exportedAt)}`,
    '',
  ]
  return [...header, buildDurationSection(data, t), buildNotesMarkdown(data, t, labels)]
    .filter(Boolean).join('\n\n').trimEnd()
}

function buildDurationFactsCsv(data: ArchiveDataExport): string {
  const header = ['Book', 'Author', 'Granularity', 'Date', 'DurationSeconds', 'OverlapGroup', 'Source']
  const rows = (data.durationFacts ?? []).map((fact) => [
    fact.title ?? '',
    fact.author ?? '',
    fact.granularity,
    fact.date ?? '',
    fact.durationSeconds,
    fact.overlapGroup ?? '',
    fact.source,
  ])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function buildArchiveExportFile(format: ArchiveExportFormat, data: ArchiveDataExport, t: Translator): string {
  if (format === 'json') return JSON.stringify(data, null, 2)
  const labels = buildAnnotationLabels(t)
  if (format === 'csv') return data.scope === 'time' ? buildDurationFactsCsv(data) : buildNotesCsv(data)
  if (format === 'text') return buildNotesText(data, t, labels)
  return data.scope === 'all' ? buildArchiveReport(data, t, labels) : buildNotesMarkdown(data, t, labels)
}
