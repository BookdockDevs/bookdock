import type {
  AiIndexReq,
  AiIndexRes,
  AiProvider,
  AiRetrievalDiagnostics,
  AiSearchReq,
  AiSearchRes,
  AiSearchResultRes,
} from '@bookdock/shared'

import { extractEpubChapterText } from '../../formats/epub'
import { getTxtChapterContent } from '../../formats/txt'
import { getActiveBook, getBookChapterContent, getBookChapters, getBookContent, getBookEpubBuffer } from '../books/books.service'

const MAX_QUERY_CHARS = 500
const MAX_SEARCH_RESULTS = 10
const EXCERPT_CHARS = 240

export type AiEmbeddingKind = 'document' | 'query'

export interface AiEmbeddingBatch {
  provider: AiProvider
  model: string
  vectors: number[][]
}

export type AiEmbedder = (texts: string[], signal: AbortSignal, kind: AiEmbeddingKind) => Promise<AiEmbeddingBatch>

export interface AiRetrievalOptions {
  signal?: AbortSignal
  embedder?: AiEmbedder
  visibleTextVersion?: string
}

function makeExcerpt(text: string, matchIndex: number, _matchLength: number): string {
  const start = Math.max(0, matchIndex - Math.floor(EXCERPT_CHARS / 3))
  const end = Math.min(text.length, start + EXCERPT_CHARS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export async function getAiIndexStatus(userId: string, bookId: string): Promise<AiIndexRes> {
  await getActiveBook(userId, bookId)
  return {
    bookId,
    status: 'ready',
    embeddingStatus: 'unavailable',
    progress: 100,
    chunkCount: 0,
    updatedAt: null,
  }
}

export async function indexAiBook(userId: string, input: AiIndexReq, options: AiRetrievalOptions = {}): Promise<AiIndexRes> {
  if (options.signal?.aborted) {
    throw new DOMException('The AI index request was aborted', 'AbortError')
  }
  await getActiveBook(userId, input.bookId)
  return {
    bookId: input.bookId,
    status: 'ready',
    embeddingStatus: 'unavailable',
    progress: 100,
    chunkCount: 0,
    updatedAt: null,
  }
}

export async function cancelAiBookIndex(_userId: string, _bookId: string): Promise<boolean> {
  return false
}

export async function clearAiBookIndex(_userId: string, _bookId: string): Promise<void> {
  // On-demand search stores zero index state; clearing is a safe no-op.
}

export async function searchAiBook(
  userId: string,
  input: AiSearchReq,
  options: AiRetrievalOptions = {},
): Promise<AiSearchRes> {
  const query = input.query.trim().slice(0, MAX_QUERY_CHARS)
  if (!query) return { status: 'empty', results: [] }

  const book = await getActiveBook(userId, input.bookId)
  const chapters = await getBookChapters(userId, input.bookId)
  if (!chapters || chapters.length === 0) return { status: 'empty', results: [] }

  const minChapter = Math.max(0, input.minChapterIndex ?? 0)
  const maxChapter = input.maxChapterIndex !== undefined && input.maxChapterIndex >= 0
    ? Math.min(input.maxChapterIndex, chapters.length - 1)
    : chapters.length - 1

  if (minChapter > maxChapter || minChapter >= chapters.length) {
    return { status: 'empty', results: [] }
  }

  let txtContent: string | null = null
  let epubBuffer: Buffer | null = null
  if (book.format === 'txt') {
    txtContent = await getBookContent(userId, input.bookId)
  } else {
    epubBuffer = await getBookEpubBuffer(userId, input.bookId)
  }

  const limit = Math.min(input.limit ?? 5, MAX_SEARCH_RESULTS)
  const lowerQuery = query.toLowerCase()
  const terms = query.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase())
  const results: AiSearchResultRes[] = []

  for (let chapterIndex = minChapter; chapterIndex <= maxChapter; chapterIndex++) {
    if (options.signal?.aborted) {
      throw new DOMException('The AI retrieval request was aborted', 'AbortError')
    }

    const chapter = chapters[chapterIndex]
    if (!chapter) continue

    const content = book.format === 'txt'
      ? getTxtChapterContent(txtContent ?? '', chapter).trim()
      : await extractEpubChapterText(epubBuffer!, chapterIndex)

    if (!content) continue

    const lowerContent = content.toLowerCase()

    let exactMatchIndex = lowerContent.indexOf(lowerQuery)
    let lastMatchEnd = -1
    let chapterMatches = 0

    while (exactMatchIndex >= 0) {
      chapterMatches++
      if (exactMatchIndex >= lastMatchEnd) {
        const startOffset = exactMatchIndex
        const endOffset = exactMatchIndex + query.length
        results.push({
          id: `hit:${chapterIndex}:${startOffset}:${endOffset}`,
          chapterIndex,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          startOffset,
          endOffset,
          excerpt: makeExcerpt(content, startOffset, query.length),
          score: 100 + chapterMatches,
        })
        lastMatchEnd = exactMatchIndex + EXCERPT_CHARS
      }
      exactMatchIndex = lowerContent.indexOf(lowerQuery, exactMatchIndex + 1)
    }

    if (chapterMatches === 0 && terms.length > 1) {
      for (const term of terms) {
        const termIndex = lowerContent.indexOf(term)
        if (termIndex >= 0) {
          const startOffset = termIndex
          const endOffset = termIndex + term.length
          results.push({
            id: `hit:${chapterIndex}:${startOffset}:${endOffset}`,
            chapterIndex,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            startOffset,
            endOffset,
            excerpt: makeExcerpt(content, startOffset, term.length),
            score: 10,
          })
          break
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.chapterIndex - b.chapterIndex || a.startOffset - b.startOffset)
  const selected = results.slice(0, limit)

  const diagnostics: AiRetrievalDiagnostics = {
    source: selected.length > 0 ? 'like' : 'none',
    lexicalCandidateCount: results.length,
    semanticCandidateCount: 0,
    fusedCandidateCount: results.length,
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
    diagnostics,
  }
}

export async function getVisibleAiChapterContent(
  userId: string,
  bookId: string,
  chapterIndex: number,
  _visibleTextVersion: string,
  maxChars: number,
): Promise<{ index: number; id: string; title: string; content: string } | null> {
  const chapter = await getBookChapterContent(userId, bookId, chapterIndex)
  if (!chapter) return null
  return {
    index: chapterIndex,
    id: chapter.id,
    title: chapter.title,
    content: chapter.content.slice(0, maxChars),
  }
}
