import { describe, expect, it } from 'vitest'

import { ANNOTATION_MAX_TEXT_LENGTH, annotationCreateSchema } from '@bookdock/shared'

import { bookmarkContext, extractAnnotationText } from '../annotation-text'

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

  it('keeps word separators at the anchor in an English paragraph', () => {
    rangeFor('<p>Hello world, this is context.</p>')
    const range = document.createRange()
    range.setStart(document.querySelector('p')!.firstChild!, 6)
    range.collapse(true)
    expect(bookmarkContext(range, 240)).toBe('Hello world, this is context.')
  })

  it('bounds context by code points, marks omissions and never splits emoji', () => {
    const range = rangeFor(`<p>${'😀'.repeat(400)}</p>`)
    range.collapse(true)
    const text = bookmarkContext(range, 240)
    expect(Array.from(text)).toHaveLength(240)
    expect(text.endsWith('…')).toBe(true)
    expect(text).not.toContain('\uFFFD')
  })
})
