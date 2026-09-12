import type { BookListItem, BookMetadata } from '@bookdock/shared'

import { notify } from '@/lib/notifications'

export interface MetaDraft {
  title: string
  author: string
  publisher: string
  published: string
  isbn: string
  language: string
  subjects: string
  series: string
  seriesIndex: string
  description: string
}

export function draftFrom(book: BookListItem, bookmeta?: BookMetadata): MetaDraft {
  return {
    title: book.title,
    author: book.author,
    publisher: bookmeta?.publisher ?? '',
    published: bookmeta?.published ?? '',
    isbn: bookmeta?.isbn ?? '',
    language: bookmeta?.language ?? '',
    subjects: (bookmeta?.subjects ?? []).join(', '),
    series: bookmeta?.series ?? '',
    seriesIndex: bookmeta?.seriesIndex != null ? String(bookmeta.seriesIndex) : '',
    description: bookmeta?.description ?? '',
  }
}

// identifier is intentionally not part of the draft: it stays read-only and
// is never written back on save.
export function draftToBookmeta(draft: MetaDraft): BookMetadata {
  const bookmeta: BookMetadata = {}
  if (draft.publisher.trim()) bookmeta.publisher = draft.publisher.trim()
  if (draft.published.trim()) bookmeta.published = draft.published.trim()
  if (draft.isbn.trim()) bookmeta.isbn = draft.isbn.trim()
  if (draft.language.trim()) bookmeta.language = draft.language.trim()
  const subjects = draft.subjects.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  if (subjects.length > 0) bookmeta.subjects = subjects
  if (draft.description.trim()) bookmeta.description = draft.description
  if (draft.series.trim()) bookmeta.series = draft.series.trim()
  const seriesIndex = parseFloat(draft.seriesIndex)
  if (!Number.isNaN(seriesIndex)) bookmeta.seriesIndex = seriesIndex
  return bookmeta
}

export function middleTruncate(value: string, max = 28): string {
  if (value.length <= max) return value
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    notify.success({ key: 'library.copied' })
  } catch {
    notify.error({ key: 'library.copyFailed' })
  }
}

export function toggleSetItem(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}
