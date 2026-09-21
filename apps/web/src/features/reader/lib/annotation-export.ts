import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

export type AnnotationExportFormat = 'markdown' | 'text' | 'csv'

export interface AnnotationExportBook {
  id: string
  title: string
  author: string
}

export interface AnnotationExportOptions {
  includeDetails: boolean
  includeTime: boolean
  includeDeepLink: boolean
  groupByChapter?: boolean
}

export interface AnnotationExportLabels {
  author: string
  bookmark: string
  highlight: string
  idea: string
  unnamedBookmark: string
  separator: string
  recordedAt: string
  openInBook: string
  color: (color: string) => string
  style: (style: AnnotationStyle) => string
}

function kindValue(annotation: AnnotationRes): 'bookmark' | 'idea' | 'highlight' {
  if (annotation.type === 'bookmark') return 'bookmark'
  return annotation.note?.trim() ? 'idea' : 'highlight'
}

function kindLabel(annotation: AnnotationRes, labels: AnnotationExportLabels): string {
  const kind = kindValue(annotation)
  if (kind === 'bookmark') return labels.bookmark
  if (kind === 'idea') return labels.idea
  return labels.highlight
}

function detailLabel(annotation: AnnotationRes, labels: AnnotationExportLabels): string {
  if (annotation.type === 'bookmark') return labels.bookmark
  return [kindLabel(annotation, labels), labels.color(annotation.color), labels.style(annotation.style)].join(' · ')
}

function annotationUrl(book: AnnotationExportBook, annotation: AnnotationRes): string {
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  const url = new URL(`/books/${encodeURIComponent(book.id)}`, base)
  url.searchParams.set('annotation', annotation.id)
  url.searchParams.set('cfi', annotation.cfiRange || annotation.cfiAnchor || '')
  return url.toString()
}

function annotationChapterKey(annotation: AnnotationRes): string | null {
  return annotation.chapterHref ?? annotation.chapter
}

function dateText(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

function csvDate(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

export function buildAnnotationMarkdown(
  annotations: AnnotationRes[],
  book: AnnotationExportBook,
  options: AnnotationExportOptions,
  labels: AnnotationExportLabels,
): string {
  const lines = [`# ${book.title}`, book.author ? `\n${labels.author}${labels.separator}${book.author}` : '', '']
  let chapterKey: string | null = null
  for (const annotation of annotations) {
    const nextChapterKey = annotationChapterKey(annotation)
    if (options.groupByChapter !== false && nextChapterKey !== chapterKey) {
      chapterKey = nextChapterKey
      if (annotation.chapter) lines.push(`## ${annotation.chapter}`, '')
    }
    if (annotation.type === 'bookmark') {
      const bookmarkText = annotation.text || labels.unnamedBookmark
      lines.push(options.includeDetails ? `- **${labels.bookmark}**${labels.separator}${bookmarkText}` : `- ${bookmarkText}`)
    } else {
      lines.push(`> ${annotation.text.replace(/\r?\n/g, '\n> ')}`)
      if (annotation.note?.trim()) {
        lines.push('', `**${labels.idea}**${labels.separator}${annotation.note.replace(/\r?\n/g, '\n')}`)
      }
    }
    if (options.includeDetails && annotation.type !== 'bookmark') lines.push('', `*${detailLabel(annotation, labels)}*`)
    if (options.includeTime) lines.push('', `${labels.recordedAt}${labels.separator}${dateText(annotation.createdAt)}`)
    if (options.includeDeepLink) lines.push(`[${labels.openInBook}](${annotationUrl(book, annotation)})`)
    lines.push('')
  }
  return lines.join('\n').trim() + '\n'
}

export function buildAnnotationText(
  annotations: AnnotationRes[],
  book: AnnotationExportBook,
  options: AnnotationExportOptions,
  labels: AnnotationExportLabels,
): string {
  const lines = [book.title, book.author ? `${labels.author}${labels.separator}${book.author}` : '', '']
  let chapterKey: string | null = null
  for (const annotation of annotations) {
    const nextChapterKey = annotationChapterKey(annotation)
    if (options.groupByChapter !== false && nextChapterKey !== chapterKey) {
      chapterKey = nextChapterKey
      if (annotation.chapter) lines.push(annotation.chapter, '')
    }
    const prefix = options.includeDetails ? `[${detailLabel(annotation, labels)}] ` : ''
    lines.push(`${prefix}${annotation.text}`)
    if (annotation.note?.trim()) lines.push(`${labels.idea}${labels.separator}${annotation.note}`)
    if (options.includeTime) lines.push(`${labels.recordedAt}${labels.separator}${dateText(annotation.createdAt)}`)
    if (options.includeDeepLink) lines.push(`${labels.openInBook}${labels.separator}${annotationUrl(book, annotation)}`)
    lines.push('')
  }
  return lines.join('\n').trim() + '\n'
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildAnnotationCsv(
  annotations: AnnotationRes[],
  book: AnnotationExportBook,
  options: AnnotationExportOptions,
): string {
  const header = ['Book', 'Author', 'Chapter', 'Text', 'Note']
  if (options.includeDetails) header.push('Type', 'Color', 'Style')
  header.push('Annotation ID', 'CFI')
  if (options.includeTime) header.push('Created At', 'Updated At')
  if (options.includeDeepLink) header.push('Deep Link')
  const rows = annotations.map((annotation) => {
    const row: (string | number)[] = [
      book.title,
      book.author,
      annotation.chapter ?? '',
      annotation.text,
      annotation.note ?? '',
    ]
    if (options.includeDetails) row.push(kindValue(annotation), annotation.color, annotation.style)
    row.push(annotation.id, annotation.cfiRange || annotation.cfiAnchor || '')
    if (options.includeTime) row.push(csvDate(annotation.createdAt), csvDate(annotation.updatedAt))
    if (options.includeDeepLink) row.push(annotationUrl(book, annotation))
    return row
  })
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function buildAnnotationExport(
  format: AnnotationExportFormat,
  annotations: AnnotationRes[],
  book: AnnotationExportBook,
  options: AnnotationExportOptions,
  labels: AnnotationExportLabels,
): string {
  if (format === 'markdown') return buildAnnotationMarkdown(annotations, book, options, labels)
  if (format === 'text') return buildAnnotationText(annotations, book, options, labels)
  return buildAnnotationCsv(annotations, book, options)
}
