import type { Readable } from 'node:stream'
import type { FormatParser, ParsedBook } from './registry'

import chardet from 'chardet'
import iconv from 'iconv-lite'

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

const chapterPatterns = [
  { re: /^第[一二三四五六七八九十百千万零\d]+章\s*[：:]?\s*(.+)?$/, level: 1 },
  { re: /^第[一二三四五六七八九十百千万零\d]+回\s*[：:]?\s*(.+)?$/, level: 1 },
  { re: /^第[一二三四五六七八九十百千万零\d]+节\s*[：:]?\s*(.+)?$/, level: 2 },
  { re: /^Chapter\s+\d+\s*[：:]?\s*(.+)?$/i, level: 1 },
  { re: /^Volume\s+\d+\s*[：:]?\s*(.+)?$/i, level: 0 },
  { re: /^第[一二三四五六七八九十百千万零\d]+卷\s*[：:]?\s*(.+)?$/, level: 0 },
  { re: /^#{1,2}\s+(.+)$/, level: 1 },
  { re: /^\d+\.\s+(.+)$/, level: 1 },
]

const continuationMarks = new Set(['，', '；', '：', '、', '—', '–', '~', '～'])

function isChapterTitle(line: string): boolean {
  const trimmed = line.trim()
  return chapterPatterns.some((pattern) => pattern.re.test(trimmed))
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
  let normalized = text.replace(/^\uFEFF/, '')
  normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

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
  const normalized = normalizeText(text)
  const titles: { offset: number; title: string; level: number }[] = []
  let lineStart = 0

  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '\n') {
      const line = normalized.slice(lineStart, i).trim()
      for (const pattern of chapterPatterns) {
        const m = line.match(pattern.re)
        if (m) {
          titles.push({ offset: lineStart, title: line.trim().slice(0, 120), level: pattern.level })
          break
        }
      }
      lineStart = i + 1
    }
  }

  if (lineStart < normalized.length) {
    const line = normalized.slice(lineStart).trim()
    for (const pattern of chapterPatterns) {
      const m = line.match(pattern.re)
      if (m) {
        titles.push({ offset: lineStart, title: line.trim().slice(0, 120), level: pattern.level })
      }
    }
  }

  if (titles.length === 0) {
    return [
      {
        title: '全文',
        level: 1,
        startOffset: 0,
        endOffset: normalized.length,
        contentStartOffset: 0,
      },
    ]
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
