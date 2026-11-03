import { describe, expect, it } from 'vitest'

import { createEpubCfiTextRange, resolveEpubCfiTextRange } from '../books/epub-cfi-position'
import {
  buildLocatorIndexFromMarkup,
  extractChapterText,
  locateNote,
  matchChapterByTitle,
  normalizeWithMap,
  resolveByOrder,
} from './locator-report'

function chapter(title: string, paragraphs: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h2>${title}</h2>${paragraphs.map((text) => `<p>${text}</p>`).join('')}</body></html>`
}

const CHAPTER_ONE = chapter('第一章 出发', [
  '黑暗森林法则在这里同样适用。',
  '“面壁者，请回答。”他说。',
  '<span>跨段落的</span>',
])
const CHAPTER_TWO = chapter('第二章 抵达', [
  '重复的一句话。',
  '这里是独一无二的句子，只出现一次。',
  '跨段落的',
])
const CHAPTER_THREE = chapter('第三章 归来', ['重复的一句话。'])
const CHAPTER_IMAGE = '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h2>第四章 图版</h2><div><img src="plate.png"/></div></body></html>'

function index() {
  return buildLocatorIndexFromMarkup([
    { spineIndex: 0, href: 'Text/ch1.xhtml', markup: CHAPTER_ONE },
    { spineIndex: 1, href: 'Text/ch2.xhtml', markup: CHAPTER_TWO },
    { spineIndex: 2, href: 'Text/ch3.xhtml', markup: CHAPTER_THREE },
    { spineIndex: 3, href: 'Text/ch4.xhtml', markup: CHAPTER_IMAGE },
  ])
}

describe('chapter text extraction', () => {
  it('keeps document order, headings and paragraph ranges', () => {
    const extracted = extractChapterText(CHAPTER_ONE)!
    expect(extracted.heading).toBe('第一章 出发')
    expect(extracted.text).toBe('第一章 出发黑暗森林法则在这里同样适用。“面壁者，请回答。”他说。跨段落的')
    // The heading is its own block; each paragraph is one; the bare span is
    // one more, so nothing pretends to be a paragraph it is not.
    expect(extracted.blocks).toHaveLength(4)
    const [headingStart, headingEnd] = extracted.blocks[0]!
    expect(extracted.text.slice(headingStart, headingEnd)).toBe('第一章 出发')
  })

  it('maps every normalized character back to its raw position', () => {
    const raw = '“面壁者，请回答。”'
    const normalized = normalizeWithMap(raw)
    expect(normalized.text).toBe('面壁者请回答')
    expect(normalized.starts[0]).toBe(1)
    expect(normalized.text.slice(0, 3)).toBe('面壁者')
    // Last kept character is the reply's last character (答), not the closing
    // quote: 答 sits at raw index 7, so the exclusive end is 8.
    expect(normalized.ends.at(-1)).toBe(8)
  })
})

describe('locating one record', () => {
  it('locates an exact unique quote and produces a CFI that reads back the same text', () => {
    const built = index()
    const note = { recordId: 'h1', kind: 'highlight' as const, text: '这里是独一无二的句子，只出现一次。', chapter: '第二章 抵达' }
    const located = locateNote(note, built)
    expect(located).toMatchObject({ state: 'located', hits: 1, chapter: 1, warning: null, reason: null })
    expect(built.chapters[1]!.text.slice(located.start!, located.end!)).toBe(note.text)

    const cfi = createEpubCfiTextRange(CHAPTER_TWO, 1, located.start!, located.end!)!
    expect(cfi.startsWith('epubcfi(/6/4!')).toBe(true)
    expect(resolveEpubCfiTextRange(CHAPTER_TWO, cfi)).toEqual({ start: located.start, end: located.end })
  })

  it('still locates when only punctuation differs, and says so', () => {
    const located = locateNote(
      { recordId: 'h2', kind: 'highlight', text: '面壁者,请回答.', chapter: '第一章 出发' },
      index(),
    )
    expect(located).toMatchObject({ state: 'located', chapter: 0, warning: 'punctuation' })
    expect(index().chapters[0]!.text.slice(located.start!, located.end!)).toBe('面壁者，请回答。')
  })

  it('reports ambiguity when the same text appears twice, and resolves it with the chapter hint', () => {
    const built = index()
    const ambiguous = locateNote({ recordId: 'h3', kind: 'highlight', text: '重复的一句话。', chapter: null }, built)
    expect(ambiguous).toMatchObject({ state: 'ambiguous', hits: 2, chapter: null, start: null })

    const hinted = locateNote({ recordId: 'h3', kind: 'highlight', text: '重复的一句话。', chapter: '第三章 归来' }, built)
    expect(hinted).toMatchObject({ state: 'located', chapter: 2, warning: null })
  })

  it('cannot disambiguate two hits inside the hinted chapter', () => {
    const built = buildLocatorIndexFromMarkup([
      { spineIndex: 0, href: 'a.xhtml', markup: chapter('第一章', ['同一句话。', '同一句话。']) },
    ])
    // No position, but the chapter is known: two identical sentences inside
    // one chapter still say which chapter they are in.
    expect(locateNote({ recordId: 'h4', kind: 'highlight', text: '同一句话。', chapter: '第一章' }, built))
      .toMatchObject({ state: 'ambiguous', hits: 2, chapter: 0, start: null })
  })

  it('matches chapter titles that are nothing but a number', () => {
    // Plenty of books number chapters without a subtitle ("第一章"), and the
    // loose title key strips exactly those words down to nothing. Falling back
    // to the ordinal keeps the hint useful instead of silently dropping it.
    const built = buildLocatorIndexFromMarkup([
      { spineIndex: 0, href: 'a.xhtml', markup: chapter('第一章', ['甲']) },
      { spineIndex: 1, href: 'b.xhtml', markup: chapter('第一百二十三章', ['乙']) },
    ])
    expect(matchChapterByTitle(built, '第1章')).toBe(0)
    expect(matchChapterByTitle(built, '第一章')).toBe(0)
    expect(matchChapterByTitle(built, '第123章')).toBe(1)
    expect(matchChapterByTitle(built, '第一百二十三章')).toBe(1)
    expect(matchChapterByTitle(built, '第二章')).toBeNull()
    // A subtitle still wins over the ordinal when it can be compared.
    const titled = buildLocatorIndexFromMarkup([
      { spineIndex: 0, href: 'a.xhtml', markup: chapter('第1章 出发', ['甲']) },
      { spineIndex: 1, href: 'b.xhtml', markup: chapter('第1章 抵达', ['乙']) },
    ])
    expect(matchChapterByTitle(titled, '第1章 抵达')).toBe(1)
  })

  it('distinguishes "text is not in this book" from "the book has no text here"', () => {
    const built = index()
    expect(locateNote({ recordId: 'h5', kind: 'highlight', text: '这句话不在书里。', chapter: '第二章 抵达' }, built))
      .toMatchObject({ state: 'missing', reason: 'not-found', hits: 0 })

    // The hinted chapter is an image plate: nothing to search, so the honest
    // reason is "no text", not "not found".
    expect(locateNote({ recordId: 'h6', kind: 'highlight', text: '图版说明', chapter: '第四章 图版' }, built))
      .toMatchObject({ state: 'missing', reason: 'no-text' })
  })

  it('treats a match spanning paragraphs as located but flagged', () => {
    const located = locateNote(
      { recordId: 'h7', kind: 'highlight', text: '他说。跨段落的', chapter: '第一章 出发' },
      index(),
    )
    expect(located).toMatchObject({ state: 'located', warning: 'cross-paragraph' })
  })

  it('flags a match that landed in a different chapter than the source claims', () => {
    const located = locateNote(
      { recordId: 'h8', kind: 'highlight', text: '这里是独一无二的句子，只出现一次。', chapter: '第三章 归来' },
      index(),
    )
    expect(located).toMatchObject({ state: 'located', chapter: 1, warning: 'chapter-mismatch' })
  })

  it('never locates an empty record', () => {
    expect(locateNote({ recordId: 'h9', kind: 'idea', text: '   ', chapter: null }, index()))
      .toMatchObject({ state: 'missing', reason: 'not-found' })
  })
})

describe('chapter title matching', () => {
  it('ignores numbering style, punctuation and spacing', () => {
    const built = index()
    expect(matchChapterByTitle(built, '第1章 出发')).toBe(0)
    expect(matchChapterByTitle(built, '第一章　出发')).toBe(0)
    expect(matchChapterByTitle(built, '第三章 归来')).toBe(2)
    expect(matchChapterByTitle(built, '第九章 不存在')).toBeNull()
    expect(matchChapterByTitle(built, null)).toBeNull()
  })
})

describe('order-only disambiguation', () => {
  // One chapter, two identical highlights, and one unique sentence between them:
  // exactly the shape that leaves a record ambiguous after text matching.
  const markup = chapter('第29章 演员', [
    '开场白。',
    '无病呻、吟，不要在意。',
    '中间的桥句。',
    '无病呻、吟，艾德先生。',
    '结尾。',
  ])
  const built = buildLocatorIndexFromMarkup([{ spineIndex: 0, href: 'Text/ch1.xhtml', markup }])
  const name = '第29章 演员'

  it('keeps both candidates when the text alone is not unique', () => {
    const located = locateNote({ recordId: 'h1', kind: 'highlight', text: '呻、吟', chapter: name, locator: '3427' }, built)
    expect(located).toMatchObject({ state: 'ambiguous', hits: 2, chapter: 0 })
    expect(located.candidates).toHaveLength(2)
  })

  it('promotes a record bracketed by a neighbour the text already placed', () => {
    const anchor = locateNote({ recordId: 'h2', kind: 'highlight', text: '中间的桥句。', chapter: name, locator: '2500' }, built)
    expect(anchor.state).toBe('located')
    const pending = locateNote({ recordId: 'h1', kind: 'highlight', text: '呻、吟', chapter: name, locator: '3427' }, built)
    const [hit] = resolveByOrder(
      [{ chapter: 0, source: 3427, candidates: pending.candidates }],
      [{ chapter: 0, source: 2500, start: anchor.start!, end: anchor.end! }],
    )
    expect(hit).not.toBeNull()
    // The later occurrence: the bracket orders the record, it never converts the
    // source offset into a position.
    expect(built.chapters[0]!.text.slice(hit!.start, hit!.end)).toBe('呻、吟')
    expect(hit!.start).toBeGreaterThan(anchor.end!)
  })

  it('stays ambiguous when one anchor cannot separate the candidates', () => {
    const pending = locateNote({ recordId: 'h1', kind: 'highlight', text: '呻、吟', chapter: name, locator: '3427' }, built)
    // The only anchor sits before both occurrences, so both remain possible.
    const [hit] = resolveByOrder(
      [{ chapter: 0, source: 3427, candidates: pending.candidates }],
      [{ chapter: 0, source: 100, start: 0, end: 4 }],
    )
    expect(hit).toBeNull()
  })

  it('stays ambiguous without any anchor in that chapter', () => {
    const pending = locateNote({ recordId: 'h1', kind: 'highlight', text: '呻、吟', chapter: name, locator: '3427' }, built)
    const [hit] = resolveByOrder([{ chapter: 0, source: 3427, candidates: pending.candidates }], [])
    expect(hit).toBeNull()
  })

  it('ignores anchors from another chapter', () => {
    const pending = locateNote({ recordId: 'h1', kind: 'highlight', text: '呻、吟', chapter: name, locator: '3427' }, built)
    const [hit] = resolveByOrder(
      [{ chapter: 0, source: 3427, candidates: pending.candidates }],
      [{ chapter: 1, source: 2500, start: 0, end: 4 }],
    )
    expect(hit).toBeNull()
  })
})
