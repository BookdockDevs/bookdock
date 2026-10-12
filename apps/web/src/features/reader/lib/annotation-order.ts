import type { AnnotationRes } from '@bookdock/shared'

import { compareCfiPosition } from './cfi-overlap'

/**
 * Shared ordering for annotation lists (reader notes panel and reading
 * archive): CFI document position first, then creation time, then id.
 * The text of an annotation never decides its order.
 */
export function compareAnnotations(a: AnnotationRes, b: AnnotationRes): number {
  return compareCfiPosition(a.cfiRange, b.cfiRange)
    || compareCfiPosition(a.cfiRange, b.cfiRange, true)
    || a.createdAt - b.createdAt
    || a.id.localeCompare(b.id)
}

export interface AnnotationChapterGroup {
  key: string
  chapter: string
  chapterHref: string | null
  list: AnnotationRes[]
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
