import type { AiCitation } from '@bookdock/shared'

import { searchAnnotations } from '../annotations/annotations.service'
import { getActiveBook, getBookChapterContent, getBookChapters } from '../books/books.service'
import { getVisibleAiChapterContent, searchAiBook, type AiEmbedder } from './ai.retrieval.service'

export const AI_TOOL_MAX_STEPS = 4
export const AI_TOOL_MAX_CALLS = 8
export const AI_TOOL_MAX_RESULT_CHARS = 12_000
export const AI_TOOL_MAX_TOTAL_RESULT_CHARS = 12_000
export const AI_TOOL_MAX_CHAPTER_CHARS = 10_000
export const AI_TOOL_MAX_NOTE_TEXT_CHARS = 500
export const AI_TOOL_MAX_NOTE_CONTENT_CHARS = 800

export interface AiToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AiToolCall {
  id: string
  name: string
  arguments: string
}

export interface AiToolExecution {
  call: AiToolCall
  content: string
  chapterIndex?: number
  resultChars: number
  sourceChars: number
  citations?: AiCitation[]
}

export function createAiToolBudgetExecution(call: AiToolCall, maxChars: number): AiToolExecution {
  const content = 'Tool result budget exhausted; answer using the sources already provided.'
  const bounded = content.slice(0, Math.max(0, maxChars))
  return { call, content: bounded, resultChars: bounded.length, sourceChars: 0 }
}

export const AI_TOOLS: readonly AiToolDefinition[] = [
  {
    name: 'get_book_toc',
    description: 'Read the visible table of contents of the current book. The server hides chapters beyond the current reading boundary and returns metadata only, not chapter text.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_chapter_content',
    description: 'Read one chapter from the current book by its zero-based chapter index. The server rejects chapters beyond the current reading boundary. Use get_book_toc first when the index is unknown.',
    parameters: {
      type: 'object',
      properties: {
        chapterIndex: { type: 'integer', minimum: 0, description: 'Zero-based chapter index from the table of contents.' },
      },
      required: ['chapterIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_book',
    description: 'Search the current book for relevant passages by keyword or phrase. Results include chapter and position metadata; the server applies the current reading-position spoiler boundary.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500, description: 'A focused keyword or phrase to find in the book.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_notes',
    description: 'Search the current user\'s notes, highlights, and bookmarks in the current book. Results are bounded and may be limited by the current reading position.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'A focused keyword or phrase to find in notes or highlighted text.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
]

const TOOL_MAP = new Map(AI_TOOLS.map((tool) => [tool.name, tool]))

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, unknown>
  } catch {
    return {}
  }
}

function result(content: string, call: AiToolCall, chapterIndex?: number, citations: AiCitation[] = [], sourceChars = 0): AiToolExecution {
  const bounded = content.slice(0, AI_TOOL_MAX_RESULT_CHARS)
  return {
    call,
    content: bounded,
    ...(chapterIndex === undefined ? {} : { chapterIndex }),
    resultChars: bounded.length,
    sourceChars,
    ...(citations.length > 0 ? { citations } : {}),
  }
}

export async function executeAiTool(userId: string, bookId: string, call: AiToolCall, signal: AbortSignal, maxChapterIndex = -1, embedder?: AiEmbedder, visibleTextVersion?: string): Promise<AiToolExecution> {
  if (!TOOL_MAP.has(call.name)) return result('Unknown tool', call)
  if (signal.aborted) throw new DOMException('The AI request was aborted', 'AbortError')

  try {
    if (call.name === 'get_book_toc') {
      const book = await getActiveBook(userId, bookId)
      const chapters = await getBookChapters(userId, bookId)
      const visibleChapters = maxChapterIndex >= 0 ? chapters.slice(0, maxChapterIndex + 1) : chapters
      const boundedChapters = []
      for (const [index, chapter] of visibleChapters.entries()) {
        const item = {
          index,
          id: chapter.id,
          title: chapter.title,
          level: chapter.level,
          wordCount: chapter.wordCount,
        }
        const candidate = JSON.stringify({ bookTitle: book.title, chapters: [...boundedChapters, item], truncated: false })
        if (candidate.length > AI_TOOL_MAX_RESULT_CHARS - 100 || boundedChapters.length >= 200) break
        boundedChapters.push(item)
      }
      return result(JSON.stringify({
        bookTitle: book.title,
        chapters: boundedChapters,
        truncated: boundedChapters.length < visibleChapters.length || visibleChapters.length < chapters.length,
      }), call)
    }

    if (call.name === 'search_book') {
      const query = parseArguments(call.arguments).query
      if (typeof query !== 'string' || !query.trim()) return result('Invalid query: expected a non-empty string.', call)
      const search = await searchAiBook(userId, { bookId, query, limit: 5, maxChapterIndex }, { signal, embedder, ...(visibleTextVersion ? { visibleTextVersion } : {}) })
      const citations = search.results.map((item) => ({
        id: item.id,
        chapterIndex: item.chapterIndex,
        chapterId: item.chapterId,
        chapterTitle: item.chapterTitle,
        startOffset: item.startOffset,
        endOffset: item.endOffset,
        excerpt: item.excerpt,
      }))
      const sourceChars = search.results.reduce((total, item) => total + item.excerpt.length, 0)
      return result(JSON.stringify({ query: query.trim(), results: search.results, truncated: false, ...(search.reason ? { reason: search.reason } : {}) }), call, undefined, citations, sourceChars)
    }

    if (call.name === 'search_notes') {
      const query = parseArguments(call.arguments).query
      if (typeof query !== 'string' || !query.trim()) return result('Invalid query: expected a non-empty string.', call)
      const normalizedQuery = query.trim().slice(0, 200)
      await getActiveBook(userId, bookId)
      const chapters = await getBookChapters(userId, bookId)
      const chapterIndexByTitle = new Map(chapters.map((chapter, index) => [chapter.title, { index, chapter }]))
      const notes = await searchAnnotations(userId, bookId, normalizedQuery, 8)
      const visibleNotes = notes.flatMap((annotation) => {
        const chapter = annotation.chapter ? chapterIndexByTitle.get(annotation.chapter) : undefined
        if (maxChapterIndex >= 0 && (!chapter || chapter.index > maxChapterIndex)) return []
        return [{ annotation, chapter }]
      })
      const citations = visibleNotes.map(({ annotation, chapter }) => {
        const excerpt = (annotation.note?.trim() || annotation.text || '笔记').slice(0, 240)
        return {
          id: `annotation:${annotation.id}`,
          chapterIndex: chapter?.index ?? 0,
          chapterId: chapter?.chapter.id ?? `annotation:${annotation.id}`,
          chapterTitle: annotation.chapter ?? chapter?.chapter.title ?? '书内笔记',
          startOffset: 0,
          endOffset: excerpt.length,
          excerpt,
          sourceType: 'annotation' as const,
          sourceCfi: annotation.cfiAnchor ?? annotation.cfiRange,
        }
      })
      const results = visibleNotes.map(({ annotation, chapter }) => ({
        id: annotation.id,
        type: annotation.type,
        chapter: annotation.chapter ?? chapter?.chapter.title ?? null,
        text: annotation.text.slice(0, AI_TOOL_MAX_NOTE_TEXT_CHARS),
        note: annotation.note?.slice(0, AI_TOOL_MAX_NOTE_CONTENT_CHARS) ?? null,
      }))
      const sourceChars = results.reduce((total, item) => total + item.text.length + (item.note?.length ?? 0), 0)
      return result(JSON.stringify({ query: normalizedQuery, results, truncated: notes.length > visibleNotes.length || notes.length >= 8 }), call, undefined, citations, sourceChars)
    }

    const chapterIndex = parseArguments(call.arguments).chapterIndex
    if (typeof chapterIndex !== 'number' || !Number.isInteger(chapterIndex) || chapterIndex < 0) {
      return result('Invalid chapterIndex: expected a non-negative integer.', call)
    }
    if (maxChapterIndex >= 0 && chapterIndex > maxChapterIndex) {
      return result('The requested chapter is outside the current reading boundary.', call, chapterIndex)
    }
    const indexedChapter = visibleTextVersion
      ? await getVisibleAiChapterContent(userId, bookId, chapterIndex, visibleTextVersion, AI_TOOL_MAX_CHAPTER_CHARS)
      : null
    if (visibleTextVersion && !indexedChapter) {
      return result(JSON.stringify({
        chapterIndex,
        error: 'visible_index_unavailable',
        message: 'The Reader-visible index is not ready. Ask the user to build or rebuild the book index before reading chapter content.',
      }), call, chapterIndex)
    }
    const chapter = indexedChapter ?? await getBookChapterContent(userId, bookId, chapterIndex)
    const content = chapter.content.slice(0, AI_TOOL_MAX_CHAPTER_CHARS)
    const citation: AiCitation = {
      id: `chapter:${chapter.index}`,
      chapterIndex: chapter.index,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      startOffset: 0,
      endOffset: content.length,
      excerpt: content.slice(0, 240),
    }
    return result(JSON.stringify({
      chapterIndex: chapter.index,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      content,
      truncated: content.length < chapter.content.length,
    }), call, chapterIndex, content ? [citation] : [], content.length)
  } catch (error) {
    if (signal.aborted) throw new DOMException('The AI request was aborted', 'AbortError')
    const message = error instanceof Error && error.message === 'Chapter index is out of range'
      ? error.message
      : 'Unable to read the requested book content.'
    return result(message, call)
  }
}
