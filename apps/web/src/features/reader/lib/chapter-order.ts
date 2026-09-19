// Annotation `chapter` labels are captured at creation time while the TOC can
// drift afterwards (whitespace variants, title normalization), so exact
// indexOf fails and groups fall back to arrival order. Match on
// whitespace-stripped labels with a containment fallback, mirroring the
// tolerance NavigationPanel's currentIndex already uses.

export function buildChapterOrderLookup(chapterOrder: string[]): (chapter: string | null | undefined) => number {
  const entries = chapterOrder
    .map((label, index) => ({ key: label.replace(/\s+/g, ''), index }))
    .filter((e) => e.key.length > 0)
  return (chapter) => {
    const key = chapter?.replace(/\s+/g, '') ?? ''
    if (!key) return -1
    const exact = entries.find((e) => e.key === key)
    if (exact) return exact.index
    return entries.find((e) => e.key.includes(key) || key.includes(e.key))?.index ?? -1
  }
}
