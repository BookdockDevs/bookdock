// The unified bookshelf merges device-vault rows with personal-server rows in
// one client-side ordering. The server keeps its own collation for the
// server-only filter; the merged view defines one order of its own, with a
// stable id tiebreak so paging stays consistent across fetches. V1 trade-off
// (recorded in the architecture doc): deep merged pages fetch server pages
// 1..N and sort what loaded, so collation differences between the server and
// this comparator can only shift ordering near the loaded boundary.

import type { BookRow } from '../library/book-row'


type SortableRow = Pick<BookRow, 'id' | 'title' | 'author' | 'progress' | 'pinnedAt' | 'lastReadAt' | 'createdAt' | 'updatedAt' | 'size' | 'format'>

function compareNullable(asc: boolean, a: number | null | undefined, b: number | null | undefined): number {
  // Unknown facts sort after known ones in both directions, exactly like the
  // local catalog's null-tail ordering.
  const aKnown = a !== null && a !== undefined
  const bKnown = b !== null && b !== undefined
  if (!aKnown && !bKnown) return 0
  if (!aKnown) return 1
  if (!bKnown) return -1
  return asc ? a - b : b - a
}

function compareText(asc: boolean, a: string, b: string): number {
  const byText = a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base', numeric: true })
  return asc ? byText : -byText
}

export function compareUnifiedRows(a: SortableRow, b: SortableRow, sortBy: string, sortOrder: 'asc' | 'desc'): number {
  const asc = sortOrder === 'asc'
  // Pinned rows surface first regardless of direction, mirroring both
  // sources' catalog ordering; recency of the pin breaks ties.
  const pinned = compareNullable(false, a.pinnedAt, b.pinnedAt)
  if (pinned !== 0) return pinned
  let byField = 0
  switch (sortBy) {
    case 'author':
      byField = compareText(asc, a.author ?? '', b.author ?? '')
      break
    case 'createdAt':
      byField = compareNullable(asc, a.createdAt, b.createdAt)
      break
    case 'updatedAt':
      byField = compareNullable(asc, a.updatedAt, b.updatedAt)
      break
    case 'lastReadAt':
      byField = compareNullable(asc, a.lastReadAt, b.lastReadAt)
      break
    case 'progress':
      byField = compareNullable(asc, a.progress, b.progress)
      break
    case 'size':
      byField = compareNullable(asc, a.size, b.size)
      break
    case 'format':
      byField = compareText(asc, a.format, b.format)
      break
    case 'title':
    default:
      byField = compareText(asc, a.title, b.title)
      break
  }
  if (byField !== 0) return byField
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function mergeUnifiedRows(rows: BookRow[], sortBy: string, sortOrder: 'asc' | 'desc'): BookRow[] {
  return [...rows].sort((a, b) => compareUnifiedRows(a, b, sortBy, sortOrder))
}
