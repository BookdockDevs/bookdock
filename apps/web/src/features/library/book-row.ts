import type { BookFormat, BookListItem, CatalogBook, CoverPaletteId } from '@bookdock/shared'

import type { CoverSource } from './components/BookCover'

/**
 * One row shape for every library's book list.
 *
 * A private library's row is a book; a shared library's row is a work with the
 * versions it manages. The two arrive as different types, but a card only needs
 * a title, an author, some artwork and - when the row belongs to someone - a
 * progress figure. Normalising here is what lets one card component decide what
 * to draw, instead of each row component hard-coding its own idea of which
 * fields exist.
 *
 * A missing field is not rendered; it is never faked. That is the whole point:
 * a catalog work has no progress because it belongs to nobody, and the card
 * shows no progress for the same reason it would show none for a book at 0%.
 */
export interface BookRow {
  id: string
  title: string
  author: string | null
  /** Full author list for display; `author` stays the first-author mirror. */
  authors: string[]
  format: BookFormat
  /**
   * Explicit artwork URL. Undefined means "ask the cover endpoint for this
   * row's own id", which is what a private book does; null means "there is
   * nothing to fetch", which is what a work with no version has.
   */
  coverSrc?: string | null
  coverKey: string | null
  coverPaletteKey?: string
  coverPaletteId?: CoverPaletteId | null
  /** Reading progress, 0-100. Null on a row nobody owns. */
  progress: number | null
  createdAt: number
  updatedAt: number
  size: number
}

/** What the card component needs to draw artwork, in either row's terms. */
export function rowCover(row: BookRow): CoverSource {
  return {
    id: row.id,
    title: row.title,
    format: row.format,
    coverKey: row.coverKey,
    coverPaletteKey: row.coverPaletteKey,
    coverPaletteId: row.coverPaletteId,
  }
}

/**
 * Display name of one version inside its work: the manager-set label, or an
 * ordinal fallback (第N版) when it was never named. The fallback text stays
 * with the caller for i18n; naming lives in the version editor, never here.
 */
export function versionTabLabel(name: string, fallback: string): string {
  return name.trim() ? name : fallback
}

/**
 * Stable 1-based number of one version inside its work, by creation order
 * (oldest = 1). Display order puts the default version first, so numbering by
 * position would rename every unnamed version the moment a default is set;
 * creation order never moves, which is what "版本1/版本2" always meant.
 */
export function versionOrdinal(versions: { id: string; createdAt: number }[], versionId: string): number {
  const ranked = [...versions].sort((a, b) =>
    a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const at = ranked.findIndex((v) => v.id === versionId)
  if (at >= 0) return at + 1
  return versions.findIndex((v) => v.id === versionId) + 1
}

export function privateBookRow(book: BookListItem): BookRow {
  return {
    id: book.id,
    title: book.title,
    author: book.author ?? null,
    authors: book.authors ?? [],
    format: book.format,
    coverSrc: undefined,
    coverKey: book.coverKey ?? null,
    coverPaletteKey: book.coverPaletteKey ?? book.id,
    coverPaletteId: book.coverPaletteId,
    progress: book.progress ?? null,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    size: book.size,
  }
}

/**
 * A work's artwork comes from its first version, and the cover endpoint
 * authorizes through the shared read verdict - so the URL a private card builds
 * is the URL this builds. A work with several versions is represented by the
 * first one, which is the same order the catalog lists versions in.
 *
 * The fetch happens only when artwork may exist (a stored cover or an EPUB
 * that can carry an embedded one), the same rule a private row uses: a
 * coverless TXT otherwise pays a doomed request per card and shows its title
 * placeholder only after the 404 lands.
 */
export function catalogWorkRow(work: CatalogBook): BookRow {
  const first = work.versions[0]
  const mayHaveArtwork = Boolean(work.coverKey) || first?.format === 'epub'
  return {
    id: work.id,
    title: work.title,
    author: work.author ?? null,
    authors: work.authors ?? [],
    format: first?.format ?? 'epub',
    coverSrc: first && mayHaveArtwork ? `/api/v1/books/${first.bookVersionId}/cover?size=thumb` : null,
    coverKey: work.coverKey ?? null,
    coverPaletteKey: first?.effective.coverPaletteKey ?? first?.bookVersionId ?? work.id,
    // A work belongs to nobody, so there is no progress to show - and none is
    // invented, exactly as a private book at 0% shows none.
    progress: null,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    size: first?.size ?? 0,
  }
}
