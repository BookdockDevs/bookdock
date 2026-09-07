import { normalizeAiToolName } from '@bookdock/shared'
import type { AiCitation, AiRetrievalDiagnostics, AiToolName } from '@bookdock/shared'

import { listAnnotations, searchAnnotations } from '../annotations/annotations.service'
import { getActiveBook, getBookChapterContent, getBookChapters } from '../books/books.service'
import { getVisibleAiChapterContent, searchAiBook, type AiEmbedder } from './ai.retrieval.service'

export const AI_TOOL_MAX_STEPS = 4
export const AI_TOOL_MAX_CALLS = 8
export const AI_TOOL_MAX_RESULT_CHARS = 12_000
export const AI_TOOL_MAX_TOTAL_RESULT_CHARS = 12_000
export const AI_TOOL_MAX_CHAPTER_CHARS = 10_000
export const AI_TOOL_MAX_NOTE_TEXT_CHARS = 500
export const AI_TOOL_MAX_NOTE_CONTENT_CHARS = 800
export const AI_TOOL_MAX_ANNOTATION_RESULTS = 12
export const AI_TOOL_MAX_CONCURRENCY = 3
export const AI_TOOL_DEFAULT_TIMEOUT_MS = 120_000

export interface AiToolDefinition {
  name: AiToolName
  description: string
  parameters: Record<string, unknown>
  readOnly: true
  parallelSafe: boolean
  timeoutMs: number
  maxResultChars: number
}

export interface AiToolCall {
  id: string
  name: string
  arguments: string
  thoughtSignature?: string
}

export interface AiToolExecution {
  call: AiToolCall
  content: string
  chapterIndex?: number
  resultChars: number
  sourceChars: number
  citations?: AiCitation[]
  retrieval?: AiRetrievalDiagnostics
}

export function createAiToolBudgetExecution(call: AiToolCall, maxChars: number): AiToolExecution {
  const content = 'Tool result budget exhausted; answer using the sources already provided.'
  const bounded = content.slice(0, Math.max(0, maxChars))
  return { call, content: bounded, resultChars: bounded.length, sourceChars: 0 }
}

export function createAiToolDisabledExecution(call: AiToolCall): AiToolExecution {
  const content = '该工具已被用户关闭，请不要依赖它，改用已有信息回答。'
  return { call, content, resultChars: content.length, sourceChars: 0 }
}

export function createAiToolRepeatedExecution(call: AiToolCall, streak: number): AiToolExecution {
  const content = `The same read-only tool call was repeated ${streak} times with identical arguments. Do not call it again; answer using the result already available or explain what information is still missing.`
  return { call, content, resultChars: content.length, sourceChars: 0 }
}

export async function executeAiToolWithPolicy(userId: string, bookId: string, call: AiToolCall, signal: AbortSignal, maxChapterIndex = -1, embedder?: AiEmbedder, visibleTextVersion?: string, minChapterIndex = 0, currentChapterIndex = 0): Promise<AiToolExecution> {
  const definition = getAiToolDefinition(call.name)
  if (!definition || definition.timeoutMs <= 0) return executeAiTool(userId, bookId, call, signal, maxChapterIndex, embedder, visibleTextVersion, minChapterIndex, currentChapterIndex)

  const timeoutController = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: ((error: DOMException) => void) | undefined
  const abortPromise = new Promise<AiToolExecution>((_, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => rejectAbort?.(new DOMException('The AI request was aborted', 'AbortError'))
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  try {
    const timeoutPromise = new Promise<AiToolExecution>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve(result(`Tool ${call.name} timed out after ${definition.timeoutMs}ms. Answer using the information already available.`, call))
        timeoutController.abort()
      }, definition.timeoutMs)
    })
    const execution = await Promise.race([
      executeAiTool(userId, bookId, call, AbortSignal.any([signal, timeoutController.signal]), maxChapterIndex, embedder, visibleTextVersion, minChapterIndex, currentChapterIndex),
      timeoutPromise,
      abortPromise,
    ])
    if (execution.resultChars <= definition.maxResultChars) return execution
    const content = execution.content.slice(0, definition.maxResultChars)
    return { ...execution, content, resultChars: content.length }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    signal.removeEventListener('abort', onAbort)
  }
}

export const AI_TOOLS: readonly AiToolDefinition[] = [
  {
    name: 'get_book_toc',
    description: 'Read the visible table of contents of the current book. The server hides chapters beyond the current reading boundary and returns metadata only, not chapter text.',
    readOnly: true,
    parallelSafe: true,
    timeoutMs: AI_TOOL_DEFAULT_TIMEOUT_MS,
    maxResultChars: AI_TOOL_MAX_RESULT_CHARS,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_chapter_content',
    description: 'Read one chapter from the current book by its zero-based chapter index. The server rejects chapters beyond the current reading boundary. Use get_book_toc first when the index is unknown.',
    readOnly: true,
    parallelSafe: true,
    timeoutMs: AI_TOOL_DEFAULT_TIMEOUT_MS,
    maxResultChars: AI_TOOL_MAX_RESULT_CHARS,
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
    readOnly: true,
    parallelSafe: true,
    timeoutMs: AI_TOOL_DEFAULT_TIMEOUT_MS,
    maxResultChars: AI_TOOL_MAX_RESULT_CHARS,
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
    name: 'list_annotations',
    description: 'List the current user\'s highlights, notes, and bookmarks in the current book. By default, list the current chapter within the reading boundary; optionally filter by chapter index or annotation type.',
    readOnly: true,
    parallelSafe: true,
    timeoutMs: AI_TOOL_DEFAULT_TIMEOUT_MS,
    maxResultChars: AI_TOOL_MAX_RESULT_CHARS,
    parameters: {
      type: 'object',
      properties: {
        chapterIndex: { type: 'integer', minimum: 0, description: 'Optional zero-based chapter index. Defaults to the current chapter.' },
        type: { type: 'string', enum: ['highlight', 'note', 'bookmark'], description: 'Optional annotation type filter.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_annotations',
    description: 'Search the current user\'s highlights, notes, and bookmarks in the current book by keyword or phrase. Results are bounded and may be limited by the current reading position; optionally filter by chapter index or annotation type.',
    readOnly: true,
    parallelSafe: true,
    timeoutMs: AI_TOOL_DEFAULT_TIMEOUT_MS,
    maxResultChars: AI_TOOL_MAX_RESULT_CHARS,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'A focused keyword or phrase to find in notes or highlighted text.' },
        chapterIndex: { type: 'integer', minimum: 0, description: 'Optional zero-based chapter index filter.' },
        type: { type: 'string', enum: ['highlight', 'note', 'bookmark'], description: 'Optional annotation type filter.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
]

const TOOL_MAP = new Map<string, AiToolDefinition>(AI_TOOLS.map((tool) => [tool.name, tool]))

export function getAiToolDefinition(name: string) {
  const normalized = normalizeAiToolName(name)
  return normalized ? TOOL_MAP.get(normalized) : undefined
}

export function isAiToolEnabled(name: string, enabledTools: ReadonlySet<string>) {
  const normalized = normalizeAiToolName(name)
  return normalized !== undefined && enabledTools.has(normalized)
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, unknown>
  } catch {
    return {}
  }
}

function result(content: string, call: AiToolCall, chapterIndex?: number, citations: AiCitation[] = [], sourceChars = 0, retrieval?: AiRetrievalDiagnostics): AiToolExecution {
  const bounded = content.slice(0, AI_TOOL_MAX_RESULT_CHARS)
  return {
    call,
    content: bounded,
    ...(chapterIndex === undefined ? {} : { chapterIndex }),
    resultChars: bounded.length,
    sourceChars,
    ...(citations.length > 0 ? { citations } : {}),
    ...(retrieval ? { retrieval } : {}),
  }
}

export async function executeAiTool(userId: string, bookId: string, call: AiToolCall, signal: AbortSignal, maxChapterIndex = -1, embedder?: AiEmbedder, visibleTextVersion?: string, minChapterIndex = 0, currentChapterIndex = 0): Promise<AiToolExecution> {
  const toolName = normalizeAiToolName(call.name)
  if (!toolName) return result('Unknown tool', call)
  if (signal.aborted) throw new DOMException('The AI request was aborted', 'AbortError')

  try {
    if (toolName === 'get_book_toc') {
      const book = await getActiveBook(userId, bookId)
      const chapters = await getBookChapters(userId, bookId)
      const visibleChapters = chapters.slice(minChapterIndex, maxChapterIndex >= 0 ? maxChapterIndex + 1 : undefined)
      const boundedChapters = []
      for (const [offset, chapter] of visibleChapters.entries()) {
        const index = minChapterIndex + offset
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

    if (toolName === 'search_book') {
      const query = parseArguments(call.arguments).query
      if (typeof query !== 'string' || !query.trim()) return result('Invalid query: expected a non-empty string.', call)
      const search = await searchAiBook(userId, { bookId, query, limit: 5, maxChapterIndex, ...(minChapterIndex > 0 ? { minChapterIndex } : {}) }, { signal, embedder, ...(visibleTextVersion ? { visibleTextVersion } : {}) })
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
      return result(JSON.stringify({ query: query.trim(), results: search.results, truncated: false, ...(search.reason ? { reason: search.reason } : {}) }), call, undefined, citations, sourceChars, search.diagnostics)
    }

    if (toolName === 'list_annotations' || toolName === 'search_annotations') {
      const args = parseArguments(call.arguments)
      const query = args.query
      if (toolName === 'search_annotations' && (typeof query !== 'string' || !query.trim())) return result('Invalid query: expected a non-empty string.', call)
      if (toolName === 'list_annotations' && query !== undefined) return result('Invalid arguments: list_annotations does not accept query.', call)
      const normalizedQuery = typeof query === 'string' ? query.trim().slice(0, 200) : undefined
      const requestedChapterIndex = args.chapterIndex
      if (requestedChapterIndex !== undefined && (typeof requestedChapterIndex !== 'number' || !Number.isInteger(requestedChapterIndex) || requestedChapterIndex < 0)) {
        return result('Invalid chapterIndex: expected a non-negative integer.', call)
      }
      const requestedType = args.type
      if (requestedType !== undefined && (typeof requestedType !== 'string' || !['highlight', 'note', 'bookmark'].includes(requestedType))) {
        return result('Invalid type: expected highlight, note, or bookmark.', call)
      }
      const chapterFilter = toolName === 'list_annotations' ? requestedChapterIndex ?? currentChapterIndex : requestedChapterIndex
      if (chapterFilter !== undefined && (chapterFilter < minChapterIndex || (maxChapterIndex >= 0 && chapterFilter > maxChapterIndex))) {
        return result('The requested chapter is outside the current reading boundary.', call, chapterFilter)
      }
      await getActiveBook(userId, bookId)
      const chapters = await getBookChapters(userId, bookId)
      const chapterIndexByTitle = new Map(chapters.map((chapter, index) => [chapter.title, { index, chapter }]))
      const annotations = toolName === 'list_annotations'
        ? await listAnnotations(userId, bookId)
        : await searchAnnotations(userId, bookId, normalizedQuery!, 20)
      const visibleAnnotations = annotations.flatMap((annotation) => {
        const chapter = annotation.chapter ? chapterIndexByTitle.get(annotation.chapter) : undefined
        if (!chapter || chapter.index < minChapterIndex || (maxChapterIndex >= 0 && chapter.index > maxChapterIndex)) return []
        if (chapterFilter !== undefined && chapter.index !== chapterFilter) return []
        if (requestedType !== undefined && annotation.type !== requestedType) return []
        return [{ annotation, chapter }]
      })
      visibleAnnotations.sort((left, right) => right.annotation.updatedAt - left.annotation.updatedAt || right.annotation.id.localeCompare(left.annotation.id))
      const boundedAnnotations = visibleAnnotations.slice(0, AI_TOOL_MAX_ANNOTATION_RESULTS)
      const citations = boundedAnnotations.map(({ annotation, chapter }) => {
        const excerpt = (annotation.note?.trim() || annotation.text || '书签位置').slice(0, 240)
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
      const results = boundedAnnotations.map(({ annotation, chapter }) => ({
        id: annotation.id,
        type: annotation.type,
        chapter: annotation.chapter ?? chapter?.chapter.title ?? null,
        text: annotation.text.slice(0, AI_TOOL_MAX_NOTE_TEXT_CHARS),
        note: annotation.note?.slice(0, AI_TOOL_MAX_NOTE_CONTENT_CHARS) ?? null,
        cfi: annotation.cfiAnchor ?? annotation.cfiRange,
      }))
      const sourceChars = results.reduce((total, item) => total + item.text.length + (item.note?.length ?? 0), 0)
      return result(JSON.stringify({
        ...(normalizedQuery === undefined ? { chapterIndex: chapterFilter } : { query: normalizedQuery }),
        ...(requestedType === undefined ? {} : { type: requestedType }),
        results,
        truncated: visibleAnnotations.length > boundedAnnotations.length || (annotations.length >= 20 && visibleAnnotations.length >= boundedAnnotations.length),
      }), call, undefined, citations, sourceChars)
    }

    const chapterIndex = parseArguments(call.arguments).chapterIndex
    if (typeof chapterIndex !== 'number' || !Number.isInteger(chapterIndex) || chapterIndex < 0) {
      return result('Invalid chapterIndex: expected a non-negative integer.', call)
    }
    if ((maxChapterIndex >= 0 && chapterIndex > maxChapterIndex) || chapterIndex < minChapterIndex) {
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
