import type { BookListItem, BookMetadata, CoverPaletteId } from '@bookdock/shared'

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
  /** Pinned placeholder-cover palette; null = none picked (id-hash palette applies) */
  coverPaletteId: CoverPaletteId | null
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
    coverPaletteId: book.coverPaletteId ?? null,
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

// CJK/fullwidth glyphs render at roughly twice the width of ASCII, so truncating
// by code-point count under-truncates Chinese file names (a 22-char title still
// wraps to 3 lines). Count display width instead.
const WIDE_CHAR = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/

function charWidth(ch: string): number {
  return WIDE_CHAR.test(ch) ? 2 : 1
}

export function middleTruncate(value: string, max = 28): string {
  const chars = Array.from(value)
  const total = chars.reduce((sum, ch) => sum + charWidth(ch), 0)
  if (total <= max) return value
  const headTarget = Math.ceil((max - 1) / 2)
  const tailTarget = Math.floor((max - 1) / 2)
  const head: string[] = []
  const tail: string[] = []
  let headW = 0
  for (const ch of chars) {
    if (headW + charWidth(ch) > headTarget) break
    head.push(ch)
    headW += charWidth(ch)
  }
  let tailW = 0
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i]
    if (tailW + charWidth(ch) > tailTarget) break
    tail.unshift(ch)
    tailW += charWidth(ch)
  }
  return `${head.join('')}…${tail.join('')}`
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
