import type { AnnotationRes } from '@bookdock/shared'

import { compareCfiPosition } from './cfi-overlap'

/**
 * Shared ordering for annotation lists (reader notes panel and reading
 * archive): CFI document position first, then the source-native offset for
 * imported rows that have no CFI, then creation time, then id.
 * The text of an annotation never decides its order.
 */
export function compareAnnotations(a: AnnotationRes, b: AnnotationRes): number {
  return compareCfiPosition(a.cfiRange ?? '', b.cfiRange ?? '')
    || compareCfiPosition(a.cfiRange ?? '', b.cfiRange ?? '', true)
    || compareImportLocator(a, b)
    || a.createdAt - b.createdAt
    || a.id.localeCompare(b.id)
}

/** Imported annotations carry an opaque source offset instead of a CFI. It
 * restores document order inside a chapter and never implies jumpability. */
function compareImportLocator(a: AnnotationRes, b: AnnotationRes): number {
  const left = Number(a.importLocator)
  const right = Number(b.importLocator)
  if (a.importLocator == null || b.importLocator == null || !Number.isFinite(left) || !Number.isFinite(right)) return 0
  return left - right
}

export interface AnnotationChapterGroup {
  key: string
  chapter: string
  chapterHref: string | null
  list: AnnotationRes[]
}

/** Source-native chapter ordinal of a group's notes: the smallest stored
 * importChapterIndex, else the smallest spine ordinal parsed from a real CFI
 * (`epubcfi(/6/244!…)` → 122). Null = the group has no usable ordinal and
 * chapter-order sorts must treat it as "unknown position". */
export function chapterGroupOrdinal(group: AnnotationChapterGroup): number | null {
  const indices = group.list.map((a) => a.importChapterIndex).filter((v): v is number => typeof v === 'number')
  if (indices.length > 0) return Math.min(...indices)
  const spines = group.list
    .map((a) => spineOrdinalOfCfi(a.cfiRange))
    .filter((v): v is number => v !== null)
  return spines.length > 0 ? Math.min(...spines) : null
}

/** Reading-order section index of an EPUB CFI: the first even step after the
 * `/6` package root, divided by two (`/6/244!` = spine item 122). Null when
 * the string is not a standard spine-anchored CFI. */
function spineOrdinalOfCfi(cfi: string | null | undefined): number | null {
  if (!cfi || !cfi.startsWith('epubcfi(')) return null
  const match = /^epubcfi\(\/6\/(\d+)!/.exec(cfi)
  if (!match) return null
  const step = Number(match[1])
  if (!Number.isInteger(step) || step < 2) return null
  return step / 2
}

/**
 * Group annotations by chapter in first-seen order. Callers sort the groups
 * themselves (book order via buildChapterOrderLookup, or time order).
 */
export function groupAnnotationsByChapter(items: AnnotationRes[], uncategorized: string): AnnotationChapterGroup[] {
  const byChapter = new Map<string, AnnotationChapterGroup>()
  for (const item of items) {
    const chapter = item.chapter || uncategorized
    const chapterHref = item.chapterHref ?? null
    const key = chapterHref ? `href:${chapterHref}` : `label:${chapter}`
    const group = byChapter.get(key)
    if (group) group.list.push(item)
    else byChapter.set(key, { key, chapter, chapterHref, list: [item] })
  }
  return [...byChapter.values()]
}
