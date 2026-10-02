import { describe, expect, it } from 'vitest'

import { ANNOTATION_MAX_TEXT_LENGTH, annotationCreateSchema } from '@bookdock/shared'

import { bookmarkContext, extractAnnotationText, isCustomBookmarkTitle } from '../annotation-text'

function rangeFor(html: string): Range {
  document.body.innerHTML = html
  const range = document.createRange()
  range.selectNodeContents(document.body)
  return range
}

describe('annotation text extraction', () => {
  it('preserves paragraph boundaries, authored indentation, inline joins and explicit line breaks', () => {
    const range = rangeFor('<p>　　第一<span>段</span><em>原文</em><br>换行</p>\n<p>第二段</p>')
    expect(extractAnnotationText(range)).toBe('　　第一段原文\n换行\n\n第二段')
  })

  it('preserves block boundaries in XHTML documents with lowercase tag names', () => {
    const doc = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>First<br/>line</p><p>Second</p></body></html>', 'application/xhtml+xml')
    const range = doc.createRange()
    range.selectNodeContents(doc.querySelector('body')!)
    expect(extractAnnotationText(range)).toBe('First\nline\n\nSecond')
  })

  it('excludes hidden ancestors, stylesheet-hidden content and reader controls', () => {
    const range = rangeFor('<style>.hidden-quote {display:none}</style><p>正文<span hidden>隐藏</span><span class="hidden-quote">样式隐藏</span><button>播放</button><span aria-hidden="true">装饰</span></p><div hidden><p>隐藏段落</p></div>')
    expect(extractAnnotationText(range)).toBe('正文')
  })

  it('keeps exactly the selected portion across paragraphs', () => {
    rangeFor('<p>甲乙<span>丙丁</span></p><p>戊己庚辛</p>')
    const range = document.createRange()
    range.setStart(document.querySelector('p')!.firstChild!, 1)
    range.setEnd(document.querySelectorAll('p')[1]!.firstChild!, 2)
    expect(extractAnnotationText(range)).toBe('乙丙丁\n\n戊己')
  })

  it('does not silently shorten a long quote and rejects oversized requests', () => {
    const text = '正文'.repeat(1000)
    expect(extractAnnotationText(rangeFor(`<p>${text}</p>`))).toBe(text)
    const request = { type: 'highlight', cfiRange: 'cfi', text: 'a'.repeat(ANNOTATION_MAX_TEXT_LENGTH) }
    expect(annotationCreateSchema.safeParse(request).success).toBe(true)
    expect(annotationCreateSchema.safeParse({ ...request, text: request.text + 'a' }).success).toBe(false)
  })
})

describe('bookmark context', () => {
  it('includes nearby preceding text and following paragraphs around a point', () => {
    rangeFor('<p>前文。当前段落。</p><p>后续段落。</p>')
    const range = document.createRange()
    range.setStart(document.querySelector('p')!.firstChild!, 3)
    range.collapse(true)
    expect(bookmarkContext(range, 240)).toBe('前文。当前段落。\n\n后续段落。')
  })

  it('preserves paragraph break when anchor collapses at the very end of a paragraph', () => {
    rangeFor('<p>第一段文本。</p><p>第二段文本展开。</p>')
    const p1 = document.querySelector('p')!
    const range = document.createRange()
    range.setStart(p1.firstChild!, p1.firstChild!.textContent!.length)
    range.collapse(true)
    expect(bookmarkContext(range, 240)).toBe('第一段文本。\n\n第二段文本展开。')
  })

  it('keeps word separators at the anchor in an English paragraph', () => {
    rangeFor('<p>Hello world, this is context.</p>')
    const range = document.createRange()
    range.setStart(document.querySelector('p')!.firstChild!, 6)
    range.collapse(true)
    expect(bookmarkContext(range, 240)).toBe('Hello world, this is context.')
  })

  it('aligns to the nearest sentence beginning when context before anchor exceeds 60 characters', () => {
    // Generate a paragraph with several complete sentences before the anchor point
    const firstSentence = '这是很久以前发生的第一句话。'
    const secondSentence = '这是第二句非常完整的长句子。'
    const thirdSentence = '第三句在此展开。'
    const afterAnchor = '视口后方的内容。'
    rangeFor(`<p>${'无关前言。'.repeat(15)}${firstSentence}${secondSentence}${thirdSentence}${afterAnchor}</p>`)
    const p = document.querySelector('p')!
    const fullText = p.textContent!
    const anchorIdx = fullText.indexOf(thirdSentence) + 2
    const range = document.createRange()
    range.setStart(p.firstChild!, anchorIdx)
    range.collapse(true)

    const result = bookmarkContext(range, 240)
    // Should align to the sentence start rather than cutting with '…' mid-sentence
    expect(result.startsWith(thirdSentence) || result.startsWith(secondSentence)).toBe(true)
    expect(result.startsWith('…')).toBe(false)
  })

  it('bounds context by code points, marks omissions and never splits emoji', () => {
    const range = rangeFor(`<p>${'😀'.repeat(400)}</p>`)
    range.collapse(true)
    const text = bookmarkContext(range, 240)
    expect(Array.from(text)).toHaveLength(240)
    expect(text.endsWith('…')).toBe(true)
    expect(text).not.toContain('\uFFFD')
  })

  it('omits trailing ellipsis when naturally ending at a sentence punctuation', () => {
    const sentence = '这是一句结构完整的短句子。'
    // Repeat to slightly exceed 240 characters
    const html = `<p>${sentence.repeat(20)}</p>`
    const range = rangeFor(html)
    range.collapse(true)
    const text = bookmarkContext(range, 240)
    expect(text.endsWith('。')).toBe(true)
    expect(text.endsWith('…')).toBe(false)
  })

  it('prioritizes paragraph endings over cutting off in the middle of a trailing paragraph', () => {
    const p1 = '第一段内容，这里记录了一段完整叙述。'.repeat(4) // 72 chars
    const p2 = '第二段内容，同样保持完整的段落结构。'.repeat(5) // 90 chars
    // p1 + '\n\n' + p2 = 164 chars
    // Add p3 which extends beyond maxLength (200)
    const p3 = '第三段很长的一段话，远远超出了字符限制范围，导致必须发生截断。'.repeat(3)
    const html = `<p>${p1}</p><p>${p2}</p><p>${p3}</p>`
    const range = rangeFor(html)
    range.collapse(true)
    const text = bookmarkContext(range, 200)
    expect(text).toBe(`${p1}\n\n${p2}`)
    expect(text).not.toContain(p3)
  })

  it('detects whether a bookmark has a user-customized title or an automated excerpt', () => {
    // Auto-generated snippet prefix
    expect(isCustomBookmarkTitle({
      text: '清晨的阳光透过窗棂洒在书桌上，微风轻轻吹拂着窗纱',
      contextText: '清晨的阳光透过窗棂洒在书桌上，微风轻轻吹拂着窗纱，屋子里弥漫着淡淡的花香与草木气息…',
    })).toBe(false)

    // Default bookmark label
    expect(isCustomBookmarkTitle({ text: '书签', contextText: '任何正文' })).toBe(false)
    expect(isCustomBookmarkTitle({ text: 'Bookmark', contextText: 'Any context' })).toBe(false)

    // Chapter fallback when snippet was empty
    expect(isCustomBookmarkTitle({ text: '第一章 启程', chapter: '第一章 启程', contextText: '第一章 启程' })).toBe(false)

    // User customized title
    expect(isCustomBookmarkTitle({
      text: '精彩伏笔',
      contextText: '清晨的阳光透过窗棂洒在书桌上，微风轻轻吹拂着窗纱…',
    })).toBe(true)
  })
})
