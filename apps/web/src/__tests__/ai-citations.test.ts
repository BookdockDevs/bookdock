import { describe, expect, it } from 'vitest'

import { aiLocalChatSchema, boundAiHistory, createAiPassageCitations, createAiContextCitations, normalizeAiCitationMarkers } from '@bookdock/shared'
import type { AiCitation, AiHistoryMessage } from '@bookdock/shared'

import { extractChapterText, findUniqueQuoteRange, offsetsToRange } from '../features/reader/lib/book-search'

const source: AiCitation = { id: 'one', chapterIndex: 0, chapterId: 'ch0', chapterTitle: 'One', startOffset: 0, endOffset: 3, excerpt: '原文' }

describe('AI citation and history boundaries', () => {
  it('preserves ordinary arrays, links, inline code, fenced code and unknown numeric brackets', () => {
    const text = 'JSON: [1]. [42] [1](https://example.com) `[[cite:1]]`\n```json\n[1] [[cite:1]]\n```\n~~~\n[[cite:1]]\n~~~'
    expect(normalizeAiCitationMarkers(text, [source])).toEqual({ content: text, citations: [] })
  })

  it('normalizes explicit source numbers and only drops unknown explicit markers', () => {
    const normalized = normalizeAiCitationMarkers('证据[[cite:2]]，重复[[cite:2]]，未知[[cite:9]]，JSON [1]', [source, { ...source, id: 'two' }])
    expect(normalized.content).toBe('证据【1】，重复【1】，未知，JSON [1]')
    expect(normalized.citations.map((citation) => citation.id)).toEqual(['two'])
    expect(normalizeAiCitationMarkers(normalized.content, normalized.citations)).toEqual(normalized)
  })

  it('restores legacy citation numbers only when explicitly requested', () => {
    expect(normalizeAiCitationMarkers('旧引用[1]', [source], true).content).toBe('旧引用【1】')
    expect(normalizeAiCitationMarkers('JSON [1]', [source]).content).toBe('JSON [1]')
  })

  it('bounds many local turns without modifying visible history', () => {
    const history: AiHistoryMessage[] = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: String(index) }))
    const bounded = boundAiHistory(history)
    expect(history).toHaveLength(20)
    expect(bounded).toHaveLength(12)
    expect(bounded[0]!.content).toBe('8')
    expect(aiLocalChatSchema.safeParse({ prompt: 'continue', context: { chapterIndex: 0, selection: '', cfiRange: 'selection' }, history: bounded }).success).toBe(true)
  })

  it('omits an oversized turn as a whole and leaves no orphan assistant', () => {
    const history: AiHistoryMessage[] = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'answer' }, { role: 'user', content: 'long' }, { role: 'assistant', content: 'x'.repeat(8001) }]
    expect(boundAiHistory(history)).toEqual(history.slice(0, 2))
  })

  it('gives direct attachments separate source IDs and text bases', () => {
    const citations = createAiContextCitations({ chapterIndex: 0, chapterTitle: 'One', cfiRange: 'epubcfi(/6/2!/2)', selection: '选区', paragraph: '完整段落', visibleTextVersion: 'v1', chapterReferences: [{ chapterIndex: 1, chapterTitle: 'Two', text: '第二章', chapterHref: 'two.xhtml' }] })
    expect(citations.map((citation) => citation.id)).toEqual(['direct:selection', 'direct:paragraph', 'direct:chapter:1'])
    expect(citations[0]).toMatchObject({ sourceCfi: 'epubcfi(/6/2!/2)', textBasis: 'reader' })
    expect(citations[1]!.sourceCfi).toBeUndefined()
    expect(citations[2]!.chapterHref).toBe('two.xhtml')
  })

  it('gives chapter middle and ending their own exact source positions without cutting surrogate pairs', () => {
    const text = 'Opening. '.repeat(50) + '\n\n' + 'A different middle. '.repeat(40) + '\n\n' + 'The ending. '.repeat(40) + '😀'.repeat(400)
    const citations = createAiContextCitations({ chapterIndex: 1, cfiRange: 'selection', selection: '', chapterReferences: [{ chapterIndex: 1, chapterTitle: 'One', text }] })
    expect(citations.length).toBeGreaterThan(3)
    expect(new Set(citations.map((citation) => citation.id)).size).toBe(citations.length)
    for (const citation of citations) {
      expect(citation.quote).toBe(text.slice(citation.startOffset, citation.endOffset))
      expect(citation.quote!.length).toBeLessThanOrEqual(600)
      expect(citation.quote).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
    }
    expect(citations.at(-1)!.endOffset).toBe(text.length)
    const numbered = normalizeAiCitationMarkers(`Middle[[cite:2]], ending[[cite:${citations.length}]]`, citations)
    expect(numbered.citations.map((citation) => citation.id)).toEqual([citations[1]!.id, citations.at(-1)!.id])
    const tool = createAiPassageCitations(text, { ...source, id: 'chapter:revision:1', textBasis: 'source' }, 100)
    expect(tool[0]!.startOffset).toBe(100)
    expect(tool.at(-1)!.endOffset).toBe(100 + text.length)
  })

  it('drops unsupported citation-shaped markers while keeping arrays, links and code', () => {
    const text = 'Unsupported【9】, explicit[[cite:2]], array [1], [1](https://example.com), `【9】`'
    expect(normalizeAiCitationMarkers(text, []).content).toBe('Unsupported, explicit, array [1], [1](https://example.com), `【9】`')
  })

  it('maps server paragraph whitespace to live DOM ranges rather than raw offsets', () => {
    const doc = new DOMParser().parseFromString('<html><body><p>甲</p><p>乙丙丁</p></body></html>', 'text/html')
    const readerText = extractChapterText(doc).text
    expect(readerText).toBe('甲 乙丙丁')
    const hit = findUniqueQuoteRange(readerText, '乙\n\n丙丁')!
    expect(hit).toBeNull()
    const actual = findUniqueQuoteRange(readerText, '丙丁')!
    expect(offsetsToRange(doc, actual.start, actual.end)!.toString()).toBe('丙丁')
    const paragraphs = findUniqueQuoteRange(readerText, '甲\n\n乙')!
    expect(offsetsToRange(doc, paragraphs.start, paragraphs.end)!.toString()).toBe('甲乙')
  })

  it('refuses missing or ambiguous quotes', () => {
    expect(findUniqueQuoteRange('原文 原文', '原文')).toBeNull()
    expect(findUniqueQuoteRange('新正文', '旧正文')).toBeNull()
  })
})
