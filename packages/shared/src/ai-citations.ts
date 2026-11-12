import { AI_MAX_HISTORY_MESSAGES, AI_MAX_HISTORY_MESSAGE_CHARS } from './constants'
import type { AiCitation, AiContextReq, AiHistoryMessage } from './contract'

function mapCitationMarkers(content: string, replace: (marker: string, number: number, explicit: boolean) => string, legacyNumericMarkers = false) {
  let result = ''
  let index = 0
  while (index < content.length) {
    if (index === 0 || content[index - 1] === '\n') {
      const fence = content.slice(index).match(/^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/)
      if (fence) {
        const closer = new RegExp(`^ {0,3}${fence[1]![0]}{${fence[1]!.length},}[ \t]*(?:\n|$)`, 'gm')
        closer.lastIndex = index + fence[0].length
        const end = closer.exec(content)
        const next = end ? end.index + end[0].length : content.length
        result += content.slice(index, next)
        index = next
        continue
      }
    }
    if (content[index] === '`') {
      const ticks = content.slice(index).match(/^`+/)![0]
      const end = content.indexOf(ticks, index + ticks.length)
      if (end >= 0) {
        result += content.slice(index, end + ticks.length)
        index = end + ticks.length
        continue
      }
    }
    const pattern = legacyNumericMarkers ? /^(?:\[\[cite:(\d+)\]\]|【(\d+)】|\[(\d+)\](?!\())/ : /^(?:\[\[cite:(\d+)\]\]|【(\d+)】)/
    const match = (content[index] === '[' || content[index] === '【') ? content.slice(index).match(pattern) : null
    if (match) {
      result += replace(match[0], Number(match[1] ?? match[2] ?? match[3]), match[1] !== undefined || match[2] !== undefined)
      index += match[0].length
    } else result += content[index++]
  }
  return result
}

export function sanitizeAiCitationMarkers(content: string, citationCount: number) {
  return mapCitationMarkers(content, (marker, number, explicit) =>
    Number.isInteger(number) && number >= 1 && number <= citationCount ? `【${number}】` : explicit ? '' : marker)
}

export function normalizeAiCitationMarkers(content: string, citations: readonly (AiCitation | undefined)[], legacyNumericMarkers = false) {
  const selected: AiCitation[] = []
  const renumbered = new Map<number, number>()
  const normalizedContent = mapCitationMarkers(content, (marker, number, explicit) => {
    const citation = citations[number - 1]
    if (!Number.isInteger(number) || number < 1 || !citation) return explicit ? '' : marker
    let targetNumber = renumbered.get(number)
    if (targetNumber === undefined) {
      targetNumber = selected.length + 1
      renumbered.set(number, targetNumber)
      selected.push(citation)
    }
    return `【${targetNumber}】`
  }, legacyNumericMarkers)
  return { content: normalizedContent, citations: selected }
}

export function boundAiHistory(history: readonly AiHistoryMessage[]): AiHistoryMessage[] {
  const retained: AiHistoryMessage[] = []
  for (let index = history.length - 1; index > 0 && retained.length < AI_MAX_HISTORY_MESSAGES; index--) {
    const assistant = history[index]!
    const user = history[index - 1]!
    if (assistant.role !== 'assistant' || user.role !== 'user') continue
    index--
    if (!user.content.trim() || !assistant.content.trim() || user.content.length > AI_MAX_HISTORY_MESSAGE_CHARS || assistant.content.length > AI_MAX_HISTORY_MESSAGE_CHARS) continue
    retained.unshift(user, assistant)
  }
  return retained
}

export function createAiPassageCitations(text: string, source: Omit<AiCitation, 'startOffset' | 'endOffset' | 'quote' | 'excerpt'>, offset = 0): AiCitation[] {
  const citations: AiCitation[] = []
  let start = 0
  while (start < text.length) {
    while (start < text.length && /\s/.test(text[start]!)) start++
    if (start >= text.length) break
    let end = Math.min(text.length, start + 600)
    if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end]!)) end--
    const window = text.slice(start, end)
    const paragraph = window.lastIndexOf('\n')
    const sentence = [...window.matchAll(/[。！？][”’"']?|[.!?][”’"']?(?=\s|$)/g)].at(-1)
    if (paragraph >= 120) end = start + paragraph
    else if (end < text.length && sentence && sentence.index! >= 120) end = start + sentence.index! + sentence[0].length
    while (end > start && /\s/.test(text[end - 1]!)) end--
    const quote = text.slice(start, end)
    citations.push({ ...source, id: `${source.id}:${offset + start}:${offset + end}`, startOffset: offset + start, endOffset: offset + end, quote, excerpt: quote.slice(0, 240) })
    start = end
  }
  if (citations.length === 1 && source.id.startsWith('direct:')) citations[0]!.id = source.id
  if (citations.length > 1) for (const citation of citations) delete citation.sourceCfi
  return citations
}

export function createAiContextCitations(context: AiContextReq): AiCitation[] {
  const citations: AiCitation[] = []
  const add = (id: string, text: string, chapterIndex: number, chapterTitle?: string, chapterHref?: string, sourceCfi?: string) => {
    citations.push(...createAiPassageCitations(text.trim(), {
      id, chapterIndex, chapterId: `direct:${chapterIndex}`, chapterTitle: chapterTitle ?? '', textBasis: 'reader',
      ...(chapterHref ? { chapterHref } : {}), ...(sourceCfi && sourceCfi !== 'selection' ? { sourceCfi } : {}),
      ...(context.visibleTextVersion ? { visibleTextVersion: context.visibleTextVersion } : {}),
    }))
  }
  add('direct:selection', context.selection, context.chapterIndex, context.chapterTitle, context.chapterHref, context.cfiRange)
  add('direct:paragraph', context.paragraph ?? '', context.chapterIndex, context.chapterTitle, context.chapterHref)
  for (const reference of new Map((context.chapterReferences ?? []).map((item) => [item.chapterIndex, item])).values()) {
    add(`direct:chapter:${reference.chapterIndex}`, reference.text, reference.chapterIndex, reference.chapterTitle, reference.chapterHref)
  }
  return citations
}
