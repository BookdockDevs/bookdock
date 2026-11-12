import { createAiPassageCitations, aiSearchSchema, normalizeAiToolName, txtChapterHref } from '@bookdock/shared'
import type { AiCitation, AiRetrievalDiagnostics, AiToolName } from '@bookdock/shared'

import { listAnnotations, searchAnnotations } from '../annotations/annotations.service'
import { getActiveBook, getBookChapterContent, getBookChapters, getBookEpubBuffer } from '../books/books.service'
import { parseEpubBuffer } from '../../formats/epub'
import { searchAiBook } from './ai.retrieval.service'

export const AI_TOOL_MAX_STEPS = 12
export const AI_TOOL_MAX_CALLS = 24
export const AI_TOOL_MAX_RESULT_CHARS = 12_000
export const AI_TOOL_MAX_TOTAL_RESULT_CHARS = 36_000
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

export function createAiToolBudgetExecution(call: AiToolCall, maxChars: number, content = 'Tool result budget exhausted; answer using the sources already provided.'): AiToolExecution {
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

export async function executeAiToolWithPolicy(userId: string, bookId: string, call: AiToolCall, signal: AbortSignal, maxChapterIndex = -1, minChapterIndex = 0, currentChapterIndex = 0): Promise<AiToolExecution> {
  const definition = getAiToolDefinition(call.name)
  if (!definition || definition.timeoutMs <= 0) return executeAiTool(userId, bookId, call, signal, maxChapterIndex, minChapterIndex, currentChapterIndex)

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
      executeAiTool(userId, bookId, call, AbortSignal.any([signal, timeoutController.signal]), maxChapterIndex, minChapterIndex, currentChapterIndex),
      timeoutPromise,
      abortPromise,
    ])
    if (execution.resultChars <= definition.maxResultChars) return execution
    return createAiToolBudgetExecution(call, definition.maxResultChars)
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    signal.removeEventListener('abort', onAbort)
  }
}

export const AI_TOOLS: readonly AiToolDefinition[] = [
  {
    name: 'get_book_toc',
    description: 'Read the visible table of contents of the current book. The server hides chapters beyond the current reading boundary and returns metadata only, not chapter text. TOC metadata has no citation sources; do not add citation markers to directory counts or titles.',
    readOnly: true,
    parallelSafe: true,
    timeoutMs: AI_TOOL_DEFAULT_TIMEOUT_MS,
    maxResultChars: AI_TOOL_MAX_RESULT_CHARS,
    parameters: {
      type: 'object',
      properties: { startChapterIndex: { type: 'integer', minimum: 0, description: 'Continue from nextChapterIndex only when the previous TOC exceeded the output budget.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_chapter_content',
    description: 'Read one chapter from the current book by its zero-based chapter index. The server rejects chapters beyond the current reading boundary. Use get_book_toc first when the index is unknown. Supply startOffset and maxChars to read around a search hit or continue a truncated chapter.',
    readOnly: true,
    parallelSafe: true,
    timeoutMs: AI_TOOL_DEFAULT_TIMEOUT_MS,
    maxResultChars: AI_TOOL_MAX_RESULT_CHARS,
    parameters: {
      type: 'object',
      properties: {
        chapterIndex: { type: 'integer', minimum: 0, description: 'Zero-based chapter index from the table of contents.' },
        startOffset: { type: 'integer', minimum: 0, description: 'Start character offset in server chapter text; use the search hit offset, minus some context if needed.' },
        maxChars: { type: 'integer', minimum: 1, maximum: AI_TOOL_MAX_CHAPTER_CHARS, description: 'Maximum characters to return. Prefer 2000 for inspecting a hit.' },
      },
      required: ['chapterIndex'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_book',
    description: 'Search the current book using a focused phrase or keyword conditions. All requiredTerms and at least one anyTerms must occur within a 600-character passage. Avoid whole natural-language questions. If evidence is insufficient, change terms or read around a returned offset. Results include chapter and position metadata; the server applies the current reading-position spoiler boundary.',
    readOnly: true,
    parallelSafe: true,
    timeoutMs: AI_TOOL_DEFAULT_TIMEOUT_MS,
    maxResultChars: AI_TOOL_MAX_RESULT_CHARS,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 500, description: 'Optional focused phrase; exact matches rank first. Provide query or at least one term.' },
        requiredTerms: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 100 }, description: 'Every term must occur near the others, e.g. character names. Relax these if no passages match.' },
        anyTerms: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 100 }, description: 'At least one term must occur, e.g. alternative clues or synonyms.' },
        minChapterIndex: { type: 'integer', minimum: 0, maximum: 1_000_000, description: 'Inclusive zero-based TOC index to start searching. Omit to start at the allowed reading boundary. Use ranges to inspect middle or later chapters rather than repeatedly retrieving opening passages.' },
        maxChapterIndex: { type: 'integer', minimum: 0, maximum: 1_000_000, description: 'Inclusive zero-based TOC index to end searching. Omit to search through the allowed reading boundary. Set minChapterIndex and maxChapterIndex to the same index to search a single chapter. The server always enforces reading permissions.' },
      },
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
  let bounded = content
  if (bounded.length > AI_TOOL_MAX_RESULT_CHARS) {
    try {
      const value = JSON.parse(content)
      if (Array.isArray(value.passages)) {
        value.truncated = true
        while (value.passages.length && JSON.stringify(value).length > AI_TOOL_MAX_RESULT_CHARS) {
          value.passages.pop()
          value.endOffset = value.passages.at(-1)?.endOffset ?? value.startOffset
        }
        const ids = new Set(value.passages.map((passage: { id: string }) => passage.id))
        citations = citations.filter((citation) => ids.has(citation.id))
        sourceChars = value.endOffset - value.startOffset
      } else if (typeof value.content === 'string') {
        const original = value.content
        let low = 0
        let high = original.length
        while (low < high) {
          const middle = Math.ceil((low + high) / 2)
          const candidate = { ...value, content: original.slice(0, middle), endOffset: (value.startOffset ?? 0) + middle, truncated: true }
          if (JSON.stringify(candidate).length <= AI_TOOL_MAX_RESULT_CHARS) low = middle
          else high = middle - 1
        }
        value.content = original.slice(0, low)
        value.endOffset = (value.startOffset ?? 0) + low
        value.truncated = true
        sourceChars = low
        citations = low > 0 ? citations.map((citation) => ({ ...citation, id: `chapter:${citation.revisionId ? `${citation.revisionId}:` : ''}${citation.chapterIndex}:${value.startOffset ?? 0}:${value.endOffset}`, endOffset: value.endOffset, quote: value.content.slice(0, 600), excerpt: value.content.slice(0, 240) })) : []
      } else if (Array.isArray(value.results)) {
        value.truncated = true
        while (value.results.length && JSON.stringify(value).length > AI_TOOL_MAX_RESULT_CHARS) value.results.pop()
        const ids = new Set(value.results.map((item: { id: string }) => item.id))
        citations = citations.filter((citation) => ids.has(citation.id) || ids.has(citation.id.replace(/^annotation:/, '')))
        sourceChars = value.results.reduce((sum: number, item: { excerpt?: string; text?: string; note?: string }) => sum + (item.excerpt?.length ?? 0) + (item.text?.length ?? 0) + (item.note?.length ?? 0), 0)
      }
      if (retrieval) retrieval = { ...retrieval, selectedCount: citations.length, topResults: retrieval.topResults.filter((item) => citations.some((citation) => citation.id === item.id)) }
      bounded = JSON.stringify(value)
    } catch {
      bounded = JSON.stringify({ error: 'Tool output could not be bounded safely.', truncated: true })
      citations = []
      sourceChars = 0
    }
    if (bounded.length > AI_TOOL_MAX_RESULT_CHARS) {
      bounded = JSON.stringify({ error: 'Tool metadata exceeds the result budget.', truncated: true })
      citations = []
      sourceChars = 0
    }
  }
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

export async function executeAiTool(userId: string, bookId: string, call: AiToolCall, signal: AbortSignal, maxChapterIndex = -1, minChapterIndex = 0, currentChapterIndex = 0): Promise<AiToolExecution> {
  const toolName = normalizeAiToolName(call.name)
  if (!toolName) return result('Unknown tool', call)
  if (signal.aborted) throw new DOMException('The AI request was aborted', 'AbortError')

  try {
    if (toolName === 'get_book_toc') {
      const book = await getActiveBook(userId, bookId)
      const chapters = await getBookChapters(userId, bookId)
      const args = parseArguments(call.arguments)
      const start = args.startChapterIndex === undefined ? minChapterIndex : args.startChapterIndex
      if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < minChapterIndex || (maxChapterIndex >= 0 && start > maxChapterIndex)) return result('Invalid TOC start: outside the reading boundary.', call)
      const end = maxChapterIndex >= 0 ? Math.min(chapters.length, maxChapterIndex + 1) : chapters.length
      const boundedChapters = []
      let next = start
      for (; next < end; next++) {
        const chapter = chapters[next]!
        const item = { index: next, id: chapter.id, title: chapter.title.slice(0, 200), level: chapter.level, wordCount: chapter.wordCount }
        if (JSON.stringify({ bookTitle: book.title, chapters: [...boundedChapters, item], truncated: true, nextChapterIndex: next + 1 }).length > AI_TOOL_MAX_RESULT_CHARS) break
        boundedChapters.push(item)
      }
      return result(JSON.stringify({ bookTitle: book.title, chapters: boundedChapters,
        truncated: next < end || start > minChapterIndex || end < chapters.length,
        ...(next < end ? { nextChapterIndex: next } : {}),
      }), call)
    }

    if (toolName === 'search_book') {
      const args = parseArguments(call.arguments)
      const requestedMin = args.minChapterIndex
      const requestedMax = args.maxChapterIndex
      if ([requestedMin, requestedMax].some((value) => value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000))) {
        return result('Invalid chapter range: use non-negative integer TOC indices, at most 1000000.', call)
      }
      const requestedStart = requestedMin as number | undefined
      const requestedEnd = requestedMax as number | undefined
      if (requestedStart !== undefined && requestedEnd !== undefined && requestedStart > requestedEnd) {
        return result('Invalid chapter range: minChapterIndex must not exceed maxChapterIndex.', call)
      }
      const searchMin = Math.max(minChapterIndex, requestedStart ?? minChapterIndex)
      const searchMax = maxChapterIndex < 0 ? requestedEnd ?? -1 : Math.min(maxChapterIndex, requestedEnd ?? maxChapterIndex)
      if (searchMax >= 0 && searchMin > searchMax) return result('The requested range is outside the current reading boundary.', call)
      const parsed = aiSearchSchema.safeParse({
        bookId, query: args.query, requiredTerms: args.requiredTerms, anyTerms: args.anyTerms,
        limit: 5, maxChapterIndex: searchMax, ...(searchMin > 0 ? { minChapterIndex: searchMin } : {}),
      })
      if (!parsed.success) return result('Invalid query: provide a non-empty phrase or bounded keyword lists.', call)
      const search = await searchAiBook(userId, parsed.data, { signal })
      const citations = search.results.map((item) => ({
        id: item.id,
        chapterIndex: item.chapterIndex,
        chapterId: item.chapterId,
        chapterTitle: item.chapterTitle,
        startOffset: item.startOffset,
        endOffset: item.endOffset,
        excerpt: item.excerpt,
        ...(item.quote ? { quote: item.quote, textBasis: item.textBasis } : {}),
        ...(item.chapterHref ? { chapterHref: item.chapterHref } : {}),
        ...(item.revisionId ? { revisionId: item.revisionId } : {}),
      }))
      const sourceChars = search.results.reduce((total, item) => total + item.excerpt.length, 0)
      return result(JSON.stringify({ ...(parsed.data.query ? { query: parsed.data.query } : {}), ...(parsed.data.requiredTerms ? { requiredTerms: parsed.data.requiredTerms } : {}), ...(parsed.data.anyTerms ? { anyTerms: parsed.data.anyTerms } : {}), ...(requestedStart !== undefined || requestedEnd !== undefined ? { searchRange: { minChapterIndex: searchMin, ...(searchMax >= 0 ? { maxChapterIndex: searchMax } : {}) } } : {}), results: search.results, truncated: search.truncated ?? false }), call, undefined, citations, sourceChars, search.diagnostics)
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
      const book = await getActiveBook(userId, bookId)
      const chapters = await getBookChapters(userId, bookId)
      const parsed = book.format === 'epub' ? await parseEpubBuffer(await getBookEpubBuffer(userId, bookId)) : null
      const normalizedHref = (href: string) => {
        const path = href.split('#')[0]!
        try { return decodeURIComponent(path) } catch { return path }
      }
      const indexed = chapters.map((chapter, index) => ({ chapter, index, href: parsed?.chapters[index]?.content ?? (book.format === 'txt' ? txtChapterHref(index) : undefined) }))
      const titles = new Map<string, typeof indexed>()
      for (const item of indexed) titles.set(item.chapter.title, [...(titles.get(item.chapter.title) ?? []), item])
      const allowed = indexed.filter((item) => item.index >= minChapterIndex && (maxChapterIndex < 0 || item.index <= maxChapterIndex) && (chapterFilter === undefined || item.index === chapterFilter))
      const scope = {
        ...(requestedType ? { type: requestedType as 'highlight' | 'note' | 'bookmark' } : {}),
        chapterHrefs: allowed.flatMap((item) => item.href ? [item.href.split('#')[0]!, normalizedHref(item.href)] : []),
        chapterTitles: allowed.filter((item) => titles.get(item.chapter.title)?.length === 1).map((item) => item.chapter.title),
        limit: AI_TOOL_MAX_ANNOTATION_RESULTS + 1,
      }
      const annotations = toolName === 'list_annotations'
        ? await listAnnotations(userId, bookId, scope)
        : await searchAnnotations(userId, bookId, normalizedQuery!, scope.limit, scope)
      const visibleAnnotations = annotations.flatMap((annotation) => {
        if ('locationAvailable' in annotation && annotation.locationAvailable === false) return []
        const matches = annotation.chapterHref
          ? indexed.filter((item) => item.href && normalizedHref(item.href) === normalizedHref(annotation.chapterHref!))
          : titles.get(annotation.chapter ?? '') ?? []
        const item = matches.length === 1 ? matches[0] : undefined
        if (!item || !allowed.includes(item)) return []
        if (requestedType !== undefined && annotation.type !== requestedType) return []
        return [{ annotation, chapter: item }]
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
          ...(annotation.type !== 'bookmark' && annotation.text ? { quote: annotation.text.slice(0, 600), textBasis: 'reader' as const } : {}),
          sourceCfi: annotation.cfiRange ?? annotation.cfiAnchor ?? undefined,
          ...(annotation.chapterHref ? { chapterHref: annotation.chapterHref } : {}),
        }
      })
      const results = boundedAnnotations.map(({ annotation, chapter }) => ({
        id: annotation.id,
        type: annotation.type,
        chapter: annotation.chapter ?? chapter?.chapter.title ?? null,
        text: annotation.text.slice(0, AI_TOOL_MAX_NOTE_TEXT_CHARS),
        note: annotation.note?.slice(0, AI_TOOL_MAX_NOTE_CONTENT_CHARS) ?? null,
        cfi: annotation.cfiRange ?? annotation.cfiAnchor,
      }))
      const sourceChars = results.reduce((total, item) => total + item.text.length + (item.note?.length ?? 0), 0)
      return result(JSON.stringify({
        ...(normalizedQuery === undefined ? { chapterIndex: chapterFilter } : { query: normalizedQuery }),
        ...(requestedType === undefined ? {} : { type: requestedType }),
        results,
        truncated: visibleAnnotations.length > boundedAnnotations.length || (annotations.length >= scope.limit && visibleAnnotations.length >= boundedAnnotations.length),
      }), call, undefined, citations, sourceChars)
    }

    const args = parseArguments(call.arguments)
    const chapterIndex = args.chapterIndex
    if (typeof chapterIndex !== 'number' || !Number.isInteger(chapterIndex) || chapterIndex < 0) {
      return result('Invalid chapterIndex: expected a non-negative integer.', call)
    }
    if ((maxChapterIndex >= 0 && chapterIndex > maxChapterIndex) || chapterIndex < minChapterIndex) {
      return result('The requested chapter is outside the current reading boundary.', call, chapterIndex)
    }
    const startOffset = args.startOffset === undefined ? 0 : args.startOffset
    const maxChars = args.maxChars === undefined ? AI_TOOL_MAX_CHAPTER_CHARS : args.maxChars
    if (typeof startOffset !== 'number' || !Number.isSafeInteger(startOffset) || startOffset < 0 ||
      typeof maxChars !== 'number' || !Number.isInteger(maxChars) || maxChars < 1 || maxChars > AI_TOOL_MAX_CHAPTER_CHARS) {
      return result('Invalid chapter range: expected a non-negative startOffset and maxChars between 1 and 10000.', call, chapterIndex)
    }
    const sourceBook = await getActiveBook(userId, bookId)
    const chapter = await getBookChapterContent(userId, bookId, chapterIndex)
    if (startOffset > chapter.content.length) return result('The requested offset is outside the chapter.', call, chapterIndex)
    const content = chapter.content.slice(startOffset, startOffset + maxChars)
    const endOffset = startOffset + content.length
    const citations = createAiPassageCitations(content, {
      id: `chapter:${sourceBook.revisionId ? `${sourceBook.revisionId}:` : ''}${chapter.index}`,
      chapterIndex: chapter.index, chapterId: chapter.id, chapterTitle: chapter.title, textBasis: 'source',
      ...(sourceBook.revisionId ? { revisionId: sourceBook.revisionId } : {}),
    }, startOffset)
    return result(JSON.stringify({
      chapterIndex: chapter.index,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      passages: citations.map((citation) => ({ id: citation.id, text: citation.quote, startOffset: citation.startOffset, endOffset: citation.endOffset })),
      startOffset,
      endOffset,
      truncated: startOffset > 0 || endOffset < chapter.content.length,
    }), call, chapterIndex, citations, content.length)
  } catch (error) {
    if (signal.aborted) throw new DOMException('The AI request was aborted', 'AbortError')
    const message = error instanceof Error && error.message === 'Chapter index is out of range'
      ? error.message
      : 'Unable to read the requested book content.'
    return result(message, call)
  }
}
