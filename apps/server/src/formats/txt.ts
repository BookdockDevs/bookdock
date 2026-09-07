import type { Readable } from 'node:stream'
import type { FormatParser, ParsedBook } from './registry'
import type { TocPatternLike } from './toc'

import chardet from 'chardet'
import iconv from 'iconv-lite'

import { applyTitleReplacement } from './toc'

export interface TxtChapter {
  title: string
  level: number
  startOffset: number
  endOffset: number
  contentStartOffset: number
}

/**
 * Detect text encoding from buffer and decode it to a JavaScript string.
 * Falls back to UTF-8 when detection fails or decoding throws.
 */
export function decodeTextBuffer(buffer: Buffer): string {
  const encoding = chardet.detect(buffer) ?? 'utf-8'
  try {
    return iconv.decode(buffer, encoding)
  } catch {
    return buffer.toString('utf-8')
  }
}

/** Built-in default patterns used when no TOC rule is pinned or scored. */
export const defaultTocPatterns: TocPatternLike[] = [
  { level: 1, regex: '^第[一二三四五六七八九十百千万零\\d]+章\\s*[：:]?\\s*(.+)?$' },
  { level: 1, regex: '^第[一二三四五六七八九十百千万零\\d]+回\\s*[：:]?\\s*(.+)?$' },
  { level: 2, regex: '^第[一二三四五六七八九十百千万零\\d]+节\\s*[：:]?\\s*(.+)?$' },
  { level: 1, regex: '^[Cc]hapter\\s+\\d+\\s*[：:]?\\s*(.+)?$' },
  { level: 0, regex: '^[Vv]olume\\s+\\d+\\s*[：:]?\\s*(.+)?$' },
  { level: 0, regex: '^第[一二三四五六七八九十百千万零\\d]+卷\\s*[：:]?\\s*(.+)?$' },
  { level: 1, regex: '^#{1,2}\\s+(.+)$' },
  { level: 1, regex: '^\\d+\\.\\s+(.+)$' },
]

const continuationMarks = new Set(['，', '；', '：', '、', '—', '–', '~', '～'])

function isChapterTitle(line: string): boolean {
  const trimmed = line.trim()
  return defaultTocPatterns.some((pattern) => new RegExp(pattern.regex, 'm').test(trimmed))
}

function isContinuationEnd(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0) return false
  const lastChar = trimmed[trimmed.length - 1]
  if (continuationMarks.has(lastChar)) return true
  return false
}

/**
 * Normalize raw txt into a clean paragraph format:
 * - Remove BOM and normalize CRLF/CR to LF.
 * - Trim whitespace on each line.
 * - Keep each line as its own paragraph by default.
 * - Merge a line into the previous paragraph when the previous line ends with a
 *   continuation punctuation and the current line is not indented (common soft
 *   line-break in web novels).
 * - Separate paragraphs with a blank line (\n\n).
 */
export function normalizeText(text: string): string {
  // single regex pass (B5): the previous three .replace() chains each copied
  // the whole book — one pass keeps a single transient copy
  const normalized = text.replace(/^\uFEFF|\r\n|\r/g, (m) => (m === '\uFEFF' ? '' : '\n'))

  const lines = normalized.split('\n')
  const paragraphs: string[] = []
  let current = ''

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '') {
      if (current !== '') {
        paragraphs.push(current)
        current = ''
      }
      continue
    }

    const startsWithIndent = /^[\s\u3000]/.test(rawLine)
    const isTitle = isChapterTitle(line)

    if (current === '') {
      current = line
    } else if (isTitle || startsWithIndent) {
      paragraphs.push(current)
      current = line
    } else if (isContinuationEnd(current)) {
      current = `${current}${line}`
    } else {
      paragraphs.push(current)
      current = line
    }
  }

  if (current !== '') {
    paragraphs.push(current)
  }

  return paragraphs.join('\n\n')
}

export function detectTxtChapters(text: string): TxtChapter[] {
  return scanTxtChapters(normalizeText(text))
}

/**
 * Chapter detection on already-normalized text (B5): the upload pipeline
 * normalizes once and reuses it here — the public detectTxtChapters keeps
 * normalizing internally for callers with raw input (tests, TxtParser).
 *
 * `patterns` is an optional TOC-rule preset (TocPatternLike[]); when omitted
 * the built-in default patterns are used. Matching runs against the WHOLE text
 * with 'g' + 'm' flags (not per trimmed line): this keeps lookbehinds such as
 * `(?<=[　\s])` functional. Patterns are applied in
 * order and each line is claimed by the first pattern that hits it; every
 * matched line is pinned to that pattern's level. Titles go through the
 * pattern's $1-style replacement when present. With no matches at all the book
 * falls back to ~10KB chunks aligned on newlines (never a single "全文"
 * chapter).
 */
export function scanTxtChapters(normalized: string, patterns?: TocPatternLike[]): TxtChapter[] {
  const active = patterns && patterns.length > 0 ? patterns.filter((p) => p.enabled !== false) : defaultTocPatterns

  const claimed = new Set<number>()
  const titles: { offset: number; title: string; level: number }[] = []

  for (const pattern of active) {
    let re: RegExp
    let lineRe: RegExp
    try {
      re = new RegExp(pattern.regex, 'gm')
      lineRe = new RegExp(pattern.regex, 'm')
    } catch {
      continue
    }
    for (let m = re.exec(normalized); m !== null; m = re.exec(normalized)) {
      const matchLen = m[0].length
      if (matchLen === 0) {
        re.lastIndex++
        continue
      }
      const lineStart = normalized.lastIndexOf('\n', m.index - 1) + 1
      if (claimed.has(lineStart)) continue
      claimed.add(lineStart)
      // Detection runs on the whole text (lookbehinds need the preceding char),
      // but a title is a single line: `\s*` / `\s{n,m}` in a rule can span the
      // \n\n separator, so m[0] may run past the line end. Re-match against the
      // isolated line for the per-line match array the replacement expects.
      const lineEnd = normalized.indexOf('\n', lineStart)
      const line = lineEnd === -1 ? normalized.slice(lineStart) : normalized.slice(lineStart, lineEnd)
      const lineMatch = lineRe.exec(line)
      const title = (lineMatch ? applyTitleReplacement(lineMatch, pattern.replacement) : line.trim()).trim().slice(0, 120)
      if (title) titles.push({ offset: lineStart, title, level: pattern.level })
    }
  }

  titles.sort((a, b) => a.offset - b.offset)

  if (titles.length === 0) {
    return fallbackChapters(normalized)
  }

  const chapters: TxtChapter[] = []

  if (titles[0].offset > 0) {
    chapters.push({
      title: '序章',
      level: 1,
      startOffset: 0,
      endOffset: titles[0].offset,
      contentStartOffset: 0,
    })
  }

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i]
    const start = title.offset
    const end = i < titles.length - 1 ? titles[i + 1].offset : normalized.length

    let contentStart = start
    for (let j = start; j < end - 1; j++) {
      if (normalized[j] === '\n' && normalized[j + 1] === '\n') {
        contentStart = j + 2
        break
      }
    }

    chapters.push({
      title: title.title,
      level: title.level,
      startOffset: start,
      endOffset: end,
      contentStartOffset: contentStart,
    })
  }

  return chapters
}

/** Split long text into ~10KB blocks aligned to the previous newline. */
export function fallbackChapters(normalized: string): TxtChapter[] {
  const blockSize = 10 * 1024
  const chapters: TxtChapter[] = []
  let block = 0
  let start = 0

  while (start < normalized.length) {
    let end = Math.min(start + blockSize, normalized.length)
    if (end < normalized.length) {
      const nl = normalized.lastIndexOf('\n', end)
      if (nl >= start) end = nl
    }

    chapters.push({
      title: `第${block + 1}章(1)`,
      level: 1,
      startOffset: start,
      endOffset: end,
      contentStartOffset: start,
    })
    block++
    start = end
  }

  return chapters.length > 0 ? chapters : [{ title: '全文', level: 1, startOffset: 0, endOffset: 0, contentStartOffset: 0 }]
}

export class TxtParser implements FormatParser {
  match(fileName: string, mime: string): boolean {
    return fileName.endsWith('.txt') || mime === 'text/plain'
  }

  async parse(data: Buffer | Readable): Promise<ParsedBook> {
    const buf = Buffer.isBuffer(data) ? data : await bufferFromReadable(data)
    const text = decodeTextBuffer(buf)
    const normalized = normalizeText(text)
    const chapters = detectTxtChapters(normalized)

    return {
      meta: {
        title: '',
        author: undefined,
      },
      chapters: chapters.map((c) => ({
        title: c.title,
        content: normalized.slice(c.contentStartOffset, c.endOffset),
      })),
    }
  }
}

async function bufferFromReadable(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
