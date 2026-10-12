import type { ArchiveBookItem } from '@bookdock/shared'

export function formatCounts(book: Pick<ArchiveBookItem, 'highlights' | 'bookmarks' | 'ideas' | 'reviews'>, t: (key: string, options?: Record<string, string | number>) => string): string {
  const parts: string[] = []
  if (book.highlights > 0) parts.push(t('archive.highlightCount', { n: book.highlights }))
  if (book.bookmarks > 0) parts.push(t('archive.bookmarkCount', { n: book.bookmarks }))
  if (book.ideas > 0) parts.push(t('archive.ideaCount', { n: book.ideas }))
  if (book.reviews > 0) parts.push(t('archive.reviewCount', { n: book.reviews }))
  return parts.join(' · ')
}

const readableTextPattern = /[\p{L}\p{N}]/u

export function hasReadableText(value: string | null | undefined): value is string {
  const text = value?.trim() ?? ''
  return text.length > 0 && readableTextPattern.test(text)
}

export function readStatusLabel(readStatus: ArchiveBookItem['readStatus'], t: (key: string) => string): string {
  return t(`library.readStatus${readStatus[0].toUpperCase()}${readStatus.slice(1)}`)
}
