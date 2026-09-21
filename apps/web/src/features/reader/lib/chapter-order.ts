// Annotation labels are captured at creation time while the TOC can drift
// afterwards (whitespace variants, title normalization), so href is the
// preferred identity and labels remain a tolerant legacy fallback.

export interface ChapterOrderItem {
  label: string
  href: string
}

export function buildChapterOrderLookup(chapterOrder: ChapterOrderItem[]): (chapter: string | null | undefined, chapterHref?: string | null) => number {
  const entries = chapterOrder
    .map(({ label, href }, index) => ({ key: label.replace(/\s+/g, ''), href, index }))
    .filter((e) => e.key.length > 0)
  return (chapter, chapterHref) => {
    if (chapterHref) {
      const hrefMatch = entries.find((e) => e.href === chapterHref)
      if (hrefMatch) return hrefMatch.index
    }
    const key = chapter?.replace(/\s+/g, '') ?? ''
    if (!key) return -1
    const exact = entries.find((e) => e.key === key)
    if (exact) return exact.index
    return entries.find((e) => e.key.includes(key) || key.includes(e.key))?.index ?? -1
  }
}
