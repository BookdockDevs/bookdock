import type { EditorUnit } from './editor-draft'

export function createUnits(source: string, chapters: Array<{ id: string; title: string; level: number; startOffset: number; endOffset: number; contentStartOffset?: number }>): EditorUnit[] {
  if (chapters.length === 0) return [{ id: 'body', title: '正文', content: source, level: 0 }]
  const units: EditorUnit[] = []
  let cursor = 0
  for (const chapter of chapters) {
    const start = Math.max(cursor, Math.min(chapter.startOffset, source.length))
    const contentStart = Math.max(start, Math.min(chapter.contentStartOffset ?? start, source.length))
    const end = Math.max(contentStart, Math.min(chapter.endOffset, source.length))
    const preamble = source.slice(cursor, start)
    if (preamble.trim()) units.push({ id: `preamble-${chapter.id}`, title: '', content: preamble, level: 0 })
    units.push({ id: chapter.id, title: chapter.title, content: source.slice(contentStart, end), level: chapter.level })
    cursor = end
  }
  const trailing = source.slice(cursor)
  if (trailing.trim()) units.push({ id: 'trailing-content', title: '', content: trailing, level: 0 })
  return units
}
