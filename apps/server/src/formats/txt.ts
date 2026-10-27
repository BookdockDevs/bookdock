import type { Readable } from 'node:stream'
import type { FormatParser, ParsedBook } from './registry'
import { DEFAULT_TXT_TOC_PATTERNS, fallbackTxtChapters, normalizeTxtText, scanTxtChapterBoundaries, type TxtChapterBoundary } from '@bookdock/shared'
import type { TocPatternLike } from './toc'

import chardet from 'chardet'
import iconv from 'iconv-lite'


export interface TxtChapter extends TxtChapterBoundary {
  contentRanges?: Array<{ startOffset: number; endOffset: number }>
}

export function txtChapterId(chapter: Pick<TxtChapter, 'startOffset'>): string {
  return `ch-${chapter.startOffset}`
}

export function canExcludeTxtChapter(chapter: Pick<TxtChapter, 'synthetic'>, index: number): boolean {
  return chapter.synthetic === true || index > 0
}

export function getTxtChapterContent(
  normalized: string,
  chapter: Pick<TxtChapter, 'startOffset' | 'endOffset' | 'contentRanges'> & { contentStartOffset?: number },
): string {
  if (chapter.contentRanges) {
    return chapter.contentRanges
      .map((range) => normalized.slice(range.startOffset, range.endOffset))
      .filter(Boolean)
      .join('\n\n')
  }
  return normalized.slice(chapter.contentStartOffset ?? chapter.startOffset, chapter.endOffset)
}

export function applyTxtChapterExclusions(
  chapters: TxtChapter[],
  requestedIds: string[] = [],
): { chapters: TxtChapter[]; excludedChapterIds: string[] } {
  const requested = new Set(requestedIds)
  const excluded = new Set(
    chapters
      .map((chapter, index) => ({ chapter, index }))
      .filter(({ chapter, index }) => requested.has(txtChapterId(chapter)) && canExcludeTxtChapter(chapter, index))
      .map(({ chapter }) => txtChapterId(chapter)),
  )
  const actualChapters = chapters.filter((chapter) => chapter.synthetic !== true)
  if (actualChapters.length > 0 && actualChapters.every((chapter) => excluded.has(txtChapterId(chapter)))) {
    excluded.delete(txtChapterId(actualChapters[actualChapters.length - 1]!))
  }

  const result: TxtChapter[] = []
  let leadingExcluded = false
  for (const chapter of chapters) {
    if (excluded.has(txtChapterId(chapter))) {
      if (result.length === 0) leadingExcluded = true
      else extendTxtChapterEnd(result[result.length - 1]!, chapter.endOffset)
      continue
    }

    if (result.length > 0) extendTxtChapterEnd(result[result.length - 1]!, chapter.startOffset)
    if (leadingExcluded) {
      result.push({
        ...chapter,
        startOffset: 0,
        contentRanges: [
          { startOffset: 0, endOffset: chapter.startOffset },
          { startOffset: chapter.contentStartOffset, endOffset: chapter.endOffset },
        ].filter((range) => range.endOffset > range.startOffset),
      })
      leadingExcluded = false
    } else {
      result.push({ ...chapter })
    }
  }

  return { chapters: result, excludedChapterIds: [...excluded] }
}

function extendTxtChapterEnd(chapter: TxtChapter, endOffset: number) {
  chapter.endOffset = endOffset
  if (chapter.contentRanges && chapter.contentRanges.length > 0) {
    chapter.contentRanges[chapter.contentRanges.length - 1]!.endOffset = endOffset
  }
}

/**
 * Detect text encoding from buffer and decode it to a JavaScript string.
 * Falls back to UTF-8 when detection fails or decoding throws.
 */
export function decodeTextBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8')
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer.subarray(2), 'utf16le')
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const littleEndian = Buffer.allocUnsafe(buffer.length - 2)
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      littleEndian[i - 2] = buffer[i + 1]
      littleEndian[i - 1] = buffer[i]
    }
    return littleEndian.toString('utf16le')
  }

  const encoding = chardet.detect(buffer) ?? 'utf-8'
  try {
    return iconv.decode(buffer, encoding)
  } catch {
    return buffer.toString('utf-8')
  }
}

export const defaultTocPatterns: TocPatternLike[] = DEFAULT_TXT_TOC_PATTERNS

export function normalizeText(text: string): string {
  return normalizeTxtText(text)
}

export function detectTxtChapters(text: string): TxtChapter[] {
  return scanTxtChapters(normalizeText(text))
}

export function scanTxtChapters(
  normalized: string,
  patterns?: TocPatternLike[],
  outMeta?: { fallback?: boolean },
): TxtChapter[] {
  return scanTxtChapterBoundaries(normalized, patterns, (fallback) => { if (outMeta) outMeta.fallback = fallback })
}

export function fallbackChapters(normalized: string): TxtChapter[] {
  return fallbackTxtChapters(normalized)
}

export class TxtParser implements FormatParser {
  match(fileName: string, mime: string): boolean {
    const normalizedMime = mime.trim().toLowerCase().split(';', 1)[0]
    return fileName.toLowerCase().endsWith('.txt') || normalizedMime === 'text/plain'
  }

  async parse(data: Buffer | Readable): Promise<ParsedBook> {
    const buf = Buffer.isBuffer(data) ? data : await bufferFromReadable(data)
    const text = decodeTextBuffer(buf)
    const normalized = normalizeText(text)
    const chapters = scanTxtChapters(normalized)

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
