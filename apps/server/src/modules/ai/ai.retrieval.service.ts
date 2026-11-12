import type {
  AiRetrievalDiagnostics,
  AiSearchReq,
  AiSearchRes,
  AiSearchResultRes,
} from '@bookdock/shared'

import { createEpubChapterTextReader } from '../../formats/epub'
import { getTxtChapterContent } from '../../formats/txt'
import { getActiveBook, getBookChapters, getBookContent, getBookEpubBuffer } from '../books/books.service'

const MAX_QUERY_CHARS = 500
const MAX_SEARCH_RESULTS = 10
const EXCERPT_CHARS = 240

export interface AiRetrievalOptions {
  signal?: AbortSignal
}

function makeExcerpt(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - Math.floor(EXCERPT_CHARS / 3))
  const end = Math.min(text.length, start + Math.max(EXCERPT_CHARS, matchLength + 80))
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export async function searchAiBook(
  userId: string,
  input: AiSearchReq,
  options: AiRetrievalOptions = {},
): Promise<AiSearchRes> {
  const query = input.query?.trim().slice(0, MAX_QUERY_CHARS) ?? ''
  const required = [...new Set((input.requiredTerms ?? []).map((term) => term.trim()).filter(Boolean))]
  const alternatives = [...new Set((input.anyTerms ?? []).map((term) => term.trim()).filter(Boolean))]
  const terms = [...new Set([query, ...query.split(/\s+/).slice(0, 8), ...required, ...alternatives].filter(Boolean))]
  if (terms.length === 0) return { status: 'empty', results: [] }

  if (options.signal?.aborted) throw new DOMException('The AI retrieval request was aborted', 'AbortError')
  const book = await getActiveBook(userId, input.bookId)
  const chapters = await getBookChapters(userId, input.bookId)
  if (!chapters || chapters.length === 0) return { status: 'empty', results: [] }
  const minChapter = Math.max(0, input.minChapterIndex ?? 0)
  const maxChapter = input.maxChapterIndex !== undefined && input.maxChapterIndex >= 0
    ? Math.min(input.maxChapterIndex, chapters.length - 1)
    : chapters.length - 1
  if (minChapter > maxChapter || minChapter >= chapters.length) return { status: 'empty', results: [] }

  const txtContent = book.format === 'txt' ? await getBookContent(userId, input.bookId) : null
  const epubBuffer = book.format === 'txt' ? null : await getBookEpubBuffer(userId, input.bookId)
  const epubReader = epubBuffer ? await createEpubChapterTextReader(epubBuffer) : null
  const epubChapters = epubReader?.chapters
  const limit = Math.min(input.limit ?? 5, MAX_SEARCH_RESULTS)
  const candidates: AiSearchResultRes[] = []
  const compare = (left: AiSearchResultRes, right: AiSearchResultRes) =>
    right.score - left.score || left.chapterIndex - right.chapterIndex || left.startOffset - right.startOffset
  let candidateCount = 0

  for (let chapterIndex = minChapter; chapterIndex <= maxChapter; chapterIndex++) {
    await new Promise<void>((resolve) => setImmediate(resolve))
    if (options.signal?.aborted) throw new DOMException('The AI retrieval request was aborted', 'AbortError')
    const chapter = chapters[chapterIndex]
    if (!chapter) continue
    const content = book.format === 'txt'
      ? getTxtChapterContent(txtContent ?? '', chapter).trim()
      : await epubReader!.readChapterText(chapterIndex)
    if (options.signal?.aborted) throw new DOMException('The AI retrieval request was aborted', 'AbortError')
    if (!content) continue

    // Separate match iterators preserve original offsets even when case folding changes string length.
    const iterators = terms.map((term) => content.matchAll(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')))
    const next = iterators.map((iterator) => iterator.next())
    const recent = new Map<string, { start: number; end: number }>()
    let matches = 0
    while (true) {
      let earliest = -1
      for (let index = 0; index < next.length; index++) {
        if (!next[index]!.done && (earliest < 0 || next[index]!.value!.index < next[earliest]!.value!.index)) earliest = index
      }
      if (earliest < 0) break
      const match = next[earliest]!.value!
      next[earliest] = iterators[earliest]!.next()
      recent.set(terms[earliest]!, { start: match.index, end: match.index + match[0].length })
      for (const [term, hit] of recent) {
        if (match.index + match[0].length - hit.start > 600) recent.delete(term)
      }
      if (++matches % 256 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        if (options.signal?.aborted) throw new DOMException('The AI retrieval request was aborted', 'AbortError')
      }
      if (!required.every((term) => recent.has(term)) || (alternatives.length > 0 && !alternatives.some((term) => recent.has(term)))) continue
      const hits = [...recent.values()]
      const startOffset = Math.min(...hits.map((hit) => hit.start))
      const endOffset = Math.max(...hits.map((hit) => hit.end))
      const score = (query && recent.has(query) ? 100_000 : 0) + recent.size * 1_000 + 600 - (endOffset - startOffset)
      const candidate: AiSearchResultRes = {
        id: `hit:${book.revisionId ? `${book.revisionId}:` : ''}${chapterIndex}:${startOffset}:${endOffset}`,
        chapterIndex, chapterId: chapter.id, chapterTitle: chapter.title,
        ...(book.revisionId ? { revisionId: book.revisionId } : {}),
        ...(epubChapters?.[chapterIndex]?.content ? { chapterHref: epubChapters[chapterIndex]!.content } : {}),
        startOffset, endOffset, quote: content.slice(startOffset, endOffset), textBasis: 'source', excerpt: makeExcerpt(content, startOffset, endOffset - startOffset), score,
      }
      candidateCount++
      let best = candidate
      for (let index = candidates.length - 1; index >= 0; index--) {
        const item = candidates[index]!
        if (item.chapterIndex !== chapterIndex || item.startOffset >= endOffset + 80 || startOffset >= item.endOffset + 80) continue
        if (compare(item, best) < 0) best = item
        candidates.splice(index, 1)
      }
      candidates.push(best)
      candidates.sort(compare)
      if (candidates.length > 30) candidates.length = 30
    }
  }
  const selected = candidates.slice(0, limit)

  const diagnostics: AiRetrievalDiagnostics = {
    source: selected.length > 0 ? 'like' : 'none',
    lexicalCandidateCount: candidateCount,
    semanticCandidateCount: 0,
    fusedCandidateCount: candidates.length,
    selectedCount: selected.length,
    embeddingAttempted: false,
    embeddingUsed: false,
    topResults: selected.slice(0, 5).map((r) => ({
      id: r.id,
      source: 'lexical',
      score: r.score,
    })),
  }

  return {
    status: selected.length > 0 ? 'ready' : 'empty',
    results: selected,
    truncated: candidates.length > limit,
    diagnostics,
  }
}
