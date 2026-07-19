import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import { detectTxtChapters, normalizeText, decodeTextBuffer } from '../formats/txt'

describe('detectTxtChapters', () => {
  it('splits LF text into chapters with correct offsets', () => {
    const content = '前言\n第一章 开篇\n正文内容\n第二章 续篇\n更多内容'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters).toHaveLength(3)
    expect(chapters[0].title).toBe('序章')
    expect(chapters[0].startOffset).toBe(0)
    expect(chapters[0].endOffset).toBe('前言\n\n'.length)
    expect(chapters[1].title).toBe('第一章 开篇')
    expect(chapters[1].startOffset).toBe('前言\n\n'.length)
    expect(chapters[1].endOffset).toBe('前言\n\n第一章 开篇\n\n正文内容\n\n'.length)
    expect(chapters[2].title).toBe('第二章 续篇')
    expect(chapters[2].startOffset).toBe('前言\n\n第一章 开篇\n\n正文内容\n\n'.length)
    expect(chapters[2].endOffset).toBe(normalized.length)
  })

  it('splits CRLF text into chapters with correct offsets', () => {
    const content = '前言\r\n第一章 开篇\r\n正文内容\r\n第二章 续篇\r\n更多内容'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters).toHaveLength(3)
    expect(chapters[0].title).toBe('序章')
    expect(chapters[0].startOffset).toBe(0)
    expect(chapters[0].endOffset).toBe('前言\n\n'.length)
    expect(chapters[1].title).toBe('第一章 开篇')
    expect(chapters[1].startOffset).toBe('前言\n\n'.length)
    expect(chapters[1].endOffset).toBe('前言\n\n第一章 开篇\n\n正文内容\n\n'.length)
    expect(chapters[2].title).toBe('第二章 续篇')
    expect(chapters[2].startOffset).toBe('前言\n\n第一章 开篇\n\n正文内容\n\n'.length)
    expect(chapters[2].endOffset).toBe(normalized.length)

    const firstChapterSlice = normalized.slice(chapters[1].startOffset, chapters[1].endOffset)
    expect(firstChapterSlice).toBe('第一章 开篇\n\n正文内容\n\n')
  })

  it('handles UTF-8 BOM at the start of the file', () => {
    const content = '\uFEFF前言\n第二章 图穷匕见\n正文内容\n第三章 续篇\n更多内容'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters).toHaveLength(3)
    expect(chapters[0].title).toBe('序章')
    expect(chapters[0].startOffset).toBe(0)
    expect(chapters[1].title).toBe('第二章 图穷匕见')
    expect(chapters[1].startOffset).toBe('前言\n\n'.length)
    expect(chapters[2].title).toBe('第三章 续篇')
    expect(chapters[2].startOffset).toBe('前言\n\n第二章 图穷匕见\n\n正文内容\n\n'.length)

    const secondChapterSlice = normalized.slice(chapters[1].startOffset, chapters[1].endOffset)
    expect(secondChapterSlice).toBe('第二章 图穷匕见\n\n正文内容\n\n')
  })

  it('returns a single chapter when no chapter headings are found', () => {
    const content = '没有章节标题\n的纯文本内容\n仍然是一章。'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('全文')
    expect(chapters[0].startOffset).toBe(0)
    expect(chapters[0].endOffset).toBe(normalized.length)
  })

  it('merges soft line breaks inside a paragraph', () => {
    const content = '第一章 开篇\n　　夜色如墨，\n灯影被晚风扯得四下摇晃。\n\n　　下一段。'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters[0].title).toBe('第一章 开篇')
    const bodyStart = chapters[0].contentStartOffset
    const body = normalized.slice(bodyStart, chapters[0].endOffset)
    expect(body).toBe('夜色如墨，灯影被晚风扯得四下摇晃。\n\n下一段。')
  })

  it('keeps chapter title intact when previous paragraph is a single character', () => {
    const content = '第十二章 结尾\n一个胖乎乎的男生。\n\n戴\n\n第十三章 古往今来第一人\n\n着眼镜...'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('第十二章 结尾')
    expect(chapters[1].title).toBe('第十三章 古往今来第一人')
    expect(chapters[1].startOffset).toBe(normalized.indexOf('第十三章'))
    expect(normalized.slice(chapters[1].startOffset, chapters[1].endOffset)).toBe('第十三章 古往今来第一人\n\n着眼镜...')
  })

  it('detects and decodes GBK encoded text', () => {
    const text = '第一章 开篇\n正文内容\n第二章 续篇'
    const buffer = iconv.encode(text, 'gbk')
    const decoded = decodeTextBuffer(buffer)
    expect(decoded).toBe(text)

    const normalized = normalizeText(decoded)
    const chapters = detectTxtChapters(normalized)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('第一章 开篇')
    expect(chapters[1].title).toBe('第二章 续篇')
  })

  it('does not merge paragraphs ending with ellipsis', () => {
    const content = '第一章 开篇\n那我之前给白君做的便当……\n人不能和免费过不去。\n白菌看来更适合在湿润气候生长。'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters[0].title).toBe('第一章 开篇')
    const bodyStart = chapters[0].contentStartOffset
    const body = normalized.slice(bodyStart, chapters[0].endOffset)
    expect(body).toBe('那我之前给白君做的便当……\n\n人不能和免费过不去。\n\n白菌看来更适合在湿润气候生长。')
  })
})
