import type { TocRulePattern } from './domain'

export interface TxtChapterBoundary {
  title: string
  level: number
  startOffset: number
  endOffset: number
  contentStartOffset: number
  synthetic?: boolean
}

export interface TxtTocPattern {
  level: number
  regex: string
  replacement?: string | null
  enabled?: boolean
}

export const DEFAULT_TXT_TOC_PATTERNS: TocRulePattern[] = [
  { level: 0, regex: '^[Vv]olume\\s+\\d+\\s*[：:]?\\s*(.+)?$', replacement: null, enabled: true },
  { level: 0, regex: '^[ \\t　]{0,4}(?:【|\\[|〖)?(?:第[一二三四五六七八九十百千万零\\d]+(?:卷|部(?![分是门落赛游]))|(?<!（)卷[一二三四五六七八九十百千万零\\d]+|[上中下][部卷]|终卷|最终卷)(?:】|\\]|〗)?(?:[\\s:：、_—\\-].{0,30}|[^\\n。，；]{0,30})$', replacement: null, enabled: true },
  { level: 1, regex: '^[ \\t　]{0,4}(?:【|\\[|〖)?第[一二三四五六七八九十百千万零\\d]+(?:章|回(?![合来事去])|篇(?!张)|话|集)(?:】|\\]|〗)?(?:[\\s:：、_—\\-].{0,35}|[^\\n。，；]{0,35})$', replacement: null, enabled: true },
  { level: 1, regex: '^[ \\t　]{0,4}(?:【|\\[|〖)?(?:序章|楔子|[末终]章|大结局|后记|尾声|番外)(?:】|\\]|〗)?(?:[\\s:：、_—\\-].{0,35}|[^\\n。，；]{0,35})$', replacement: null, enabled: true },
  { level: 1, regex: '^[Cc]hapter\\s+\\d+\\s*[：:]?\\s*(.+)?$', replacement: null, enabled: true },
  { level: 1, regex: '^#{1,2}\\s+(.+)$', replacement: null, enabled: true },
  { level: 1, regex: '^\\d+\\.\\s+(.+)$', replacement: null, enabled: true },
]

export function normalizeTxtText(text: string): string {
  const normalized = text.replace(/^\uFEFF|\r\n|\r/g, (match) => match === '\uFEFF' ? '' : '\n')
  const paragraphs: string[] = []
  let current = ''
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      if (current) { paragraphs.push(current); current = '' }
    } else if (!current) current = line
    else if (DEFAULT_TXT_TOC_PATTERNS.some((pattern) => new RegExp(pattern.regex, 'm').test(line)) || /^[\s\u3000]/.test(rawLine)) {
      paragraphs.push(current)
      current = line
    } else if (/[，；：、—–~～]$/.test(current.trim())) current += line
    else { paragraphs.push(current); current = line }
  }
  if (current) paragraphs.push(current)
  return paragraphs.join('\n\n')
}

function replacementTitle(match: RegExpExecArray, replacement?: string | null): string {
  return replacement ? replacement.replace(/\$(\d)/g, (_all, group: string) => match[Number(group)] ?? '') : match[0]
}

export function fallbackTxtChapters(text: string): TxtChapterBoundary[] {
  const chapters: TxtChapterBoundary[] = []
  let start = 0
  let block = 0
  while (start < text.length) {
    let end = Math.min(start + 10 * 1024, text.length)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end)
      if (newline > start) end = newline
    }
    if (end <= start) end = Math.min(start + 10 * 1024, text.length)
    chapters.push({ title: `第${++block}章(1)`, level: 1, startOffset: start, endOffset: end, contentStartOffset: start })
    start = end
  }
  return chapters.length ? chapters : [{ title: '全文', level: 1, startOffset: 0, endOffset: 0, contentStartOffset: 0 }]
}

export function scanTxtChapterBoundaries(
  normalized: string,
  patterns?: readonly TxtTocPattern[] | null,
  onFallback?: (fallback: boolean) => void,
): TxtChapterBoundary[] {
  const active = patterns?.length ? patterns.filter((pattern) => pattern.enabled !== false) : DEFAULT_TXT_TOC_PATTERNS
  const claimed = new Set<number>()
  const titles: Array<{ offset: number; title: string; level: number }> = []
  for (const pattern of active) {
    let matcher: RegExp
    let lineMatcher: RegExp
    try { matcher = new RegExp(pattern.regex, 'gm'); lineMatcher = new RegExp(pattern.regex, 'm') } catch { continue }
    for (let match = matcher.exec(normalized); match; match = matcher.exec(normalized)) {
      if (!match[0].length) { matcher.lastIndex += 1; continue }
      const offset = normalized.lastIndexOf('\n', match.index - 1) + 1
      if (claimed.has(offset)) continue
      claimed.add(offset)
      const lineEnd = normalized.indexOf('\n', offset)
      const line = normalized.slice(offset, lineEnd < 0 ? normalized.length : lineEnd)
      const lineMatch = lineMatcher.exec(line)
      const title = (lineMatch ? replacementTitle(lineMatch, pattern.replacement) : line.trim()).trim().slice(0, 120)
      if (title) titles.push({ offset, title, level: pattern.level })
    }
  }
  titles.sort((a, b) => a.offset - b.offset)
  if (!titles.length) { onFallback?.(true); return fallbackTxtChapters(normalized) }
  onFallback?.(false)
  const observedLevels = [...new Set(titles.map((item) => item.level))].sort((a, b) => a - b)
  const outputLevel = new Map(observedLevels.map((level, index) => [level, index + 1]))
  const chapters: TxtChapterBoundary[] = []
  if (titles[0]!.offset > 0) chapters.push({ title: '序章', level: 1, startOffset: 0, endOffset: titles[0]!.offset, contentStartOffset: 0, synthetic: true })
  for (let index = 0; index < titles.length; index += 1) {
    const current = titles[index]!
    const end = titles[index + 1]?.offset ?? normalized.length
    let contentStartOffset = current.offset
    for (let cursor = current.offset; cursor < end - 1; cursor += 1) {
      if (normalized[cursor] === '\n' && normalized[cursor + 1] === '\n') { contentStartOffset = cursor + 2; break }
    }
    chapters.push({ title: current.title, level: outputLevel.get(current.level) ?? 1, startOffset: current.offset, endOffset: end, contentStartOffset })
  }
  return chapters
}

export function pickTxtTocRule<T extends { id: string; patterns: readonly TxtTocPattern[] }>(rules: readonly T[], sample: string): T | null {
  let best: T | null = null
  let max = 0
  let bestLevels = 0
  for (const rule of rules) {
    let count = 0
    let falseHits = 0
    const levels = new Set<number>()
    for (const pattern of rule.patterns) {
      if (pattern.enabled === false) continue
      let matcher: RegExp
      try { matcher = new RegExp(pattern.regex, 'gm') } catch { continue }
      let last = 0
      for (let match = matcher.exec(sample); match; match = matcher.exec(sample)) {
        if (!match[0].length) { matcher.lastIndex += 1; continue }
        const gap = match.index - last
        if (last === 0 || gap > 1000) {
          if (replacementTitle(match, pattern.replacement).trim()) { count += 1; levels.add(pattern.level) }
        } else if (gap < 100) falseHits += 1
        last = match.index + match[0].length
      }
    }
    if (count < falseHits * 3) continue
    if (count > max + 2 || (best !== null && levels.size > bestLevels && count >= max - 2)) {
      best = rule
      max = count
      bestLevels = levels.size
    }
  }
  return best
}

function chapterNumber(title: string): number | null {
  const raw = title.match(/第\s*([\d零〇一二两三四五六七八九十百千万亿]+)\s*(?:章|回|节)/i)?.[1] ?? title.match(/\bchapter\s+(\d+)\b/i)?.[1]
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Number(raw)
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1_000, 万: 10_000, 亿: 100_000_000 }
  let total = 0; let section = 0
  for (const char of raw) {
    if (digits[char] !== undefined) { section = digits[char]!; continue }
    const unit = units[char]
    if (!unit) return null
    if (unit >= 10_000) { total += section; total *= unit; section = 0 }
    else { total += (section || 1) * unit; section = 0 }
  }
  return total + section
}

export function predictTxtContinuationStart(
  existing: readonly { title: string; level?: number; content: string; wordCount?: number }[],
  candidates: readonly { title: string; level?: number; content: string; wordCount?: number }[],
  originalWordCount?: number,
): number {
  if (!existing.length || !candidates.length) return 0
  const key = (unit: { title: string; level?: number }) => `${unit.level ?? 0}:${unit.title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`
  const suffixUnits = existing.slice(-3)
  for (let length = suffixUnits.length; length > 0; length -= 1) {
    const suffix = suffixUnits.slice(-length).map(key)
    const matches: number[] = []
    for (let index = 0; index <= candidates.length - length; index += 1) {
      if (candidates.slice(index, index + length).map(key).every((value, offset) => value === suffix[offset])) matches.push(index + length)
    }
    if (matches.length) {
      const words = (text: string) => (text.match(/[\u2e80-\u2fdf\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff01-\uff60\uffe0-\uffe6]/g)?.length ?? 0) + (text.match(/[A-Za-z0-9]+/g)?.length ?? 0)
      const existingWords = originalWordCount ?? existing.reduce((sum, unit) => sum + (unit.wordCount ?? words(unit.content)), 0)
      const candidatesWords = (end: number) => candidates.slice(0, end).reduce((sum, unit) => sum + (unit.wordCount ?? words(unit.content)), 0)
      return matches.sort((a, b) => Math.abs(candidatesWords(a) - existingWords) - Math.abs(candidatesWords(b) - existingWords))[0]!
    }
  }
  const nextNumber = chapterNumber(existing.at(-1)!.title)
  if (nextNumber !== null) {
    const index = candidates.findIndex((unit) => chapterNumber(unit.title) === nextNumber + 1)
    if (index >= 0) return index
  }
  if (candidates.length > existing.length) {
    const words = (text: string) => (text.match(/[\u2e80-\u2fdf\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff01-\uff60\uffe0-\uffe6]/g)?.length ?? 0) + (text.match(/[A-Za-z0-9]+/g)?.length ?? 0)
    const originalWords = originalWordCount ?? existing.reduce((sum, unit) => sum + (unit.wordCount ?? words(unit.content)), 0)
    const prefixWords = candidates.slice(0, existing.length).reduce((sum, unit) => sum + (unit.wordCount ?? words(unit.content)), 0)
    if (Math.abs(prefixWords - originalWords) <= Math.max(100, originalWords * 0.15)) return existing.length
  }
  return 0
}
