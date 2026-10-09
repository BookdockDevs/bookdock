import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import {
  applyTxtChapterExclusions,
  decodeTextBuffer,
  detectTxtChapters,
  fallbackChapters,
  getTxtChapterContent,
  normalizeText,
  scanTxtChapters,
  TxtParser,
} from '../formats/txt'

describe('detectTxtChapters', () => {
  it('compresses unmatched parent levels for a flat book', () => {
    const normalized = normalizeText('前言\n\n第一章 开篇\n\n正文\n\n第二章 续篇\n\n正文')
    const chapters = scanTxtChapters(normalized, [
      { level: 1, regex: '^第[一二三四五六七八九十]+卷 .+$' },
      { level: 2, regex: '^第[一二三四五六七八九十]+章 .+$' },
    ])

    expect(chapters.map((chapter) => ({ title: chapter.title, level: chapter.level }))).toEqual([
      { title: '序章', level: 1 },
      { title: '第一章 开篇', level: 1 },
      { title: '第二章 续篇', level: 1 },
    ])
  })

  it('preserves observed hierarchy levels', () => {
    const normalized = normalizeText('第一卷 示例首卷\n\n第一章 开篇\n\n第一节 示例会面\n\n正文\n\n第二章 续篇\n\n正文')
    const chapters = scanTxtChapters(normalized, [
      { level: 1, regex: '^第[一二三四五六七八九十]+卷 .+$' },
      { level: 2, regex: '^第[一二三四五六七八九十]+章 .+$' },
      { level: 3, regex: '^第[一二三四五六七八九十]+节 .+$' },
    ])

    expect(chapters.map((chapter) => chapter.level)).toEqual([1, 2, 3, 2])
  })

  it('does not include a multi-level chapter heading in its extracted body', () => {
    const normalized = normalizeText('第一卷 示例争霸\n\n第370章 进邺城\n\n进邺城\n\n安顿好行李之后，众人各自散去休息')
    const chapters = scanTxtChapters(normalized)
    const chapter = chapters[1]!

    expect(chapter.title).toBe('第370章 进邺城')
    expect(getTxtChapterContent(normalized, chapter)).toBe('进邺城\n\n安顿好行李之后，众人各自散去休息')
    expect(getTxtChapterContent(normalized, chapter)).not.toContain('第370章 进邺城')
  })

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
    const content = '\uFEFF前言\n第二章 示例转折\n正文内容\n第三章 续篇\n更多内容'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters).toHaveLength(3)
    expect(chapters[0].title).toBe('序章')
    expect(chapters[0].startOffset).toBe(0)
    expect(chapters[1].title).toBe('第二章 示例转折')
    expect(chapters[1].startOffset).toBe('前言\n\n'.length)
    expect(chapters[2].title).toBe('第三章 续篇')
    expect(chapters[2].startOffset).toBe('前言\n\n第二章 示例转折\n\n正文内容\n\n'.length)

    const secondChapterSlice = normalized.slice(chapters[1].startOffset, chapters[1].endOffset)
    expect(secondChapterSlice).toBe('第二章 示例转折\n\n正文内容\n\n')
  })

  it('falls back to a single 10KB chunk when no chapter headings are found', () => {
    const content = '没有章节标题\n的纯文本内容\n仍然是一章。'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('第1章(1)')
    expect(chapters[0].startOffset).toBe(0)
    expect(chapters[0].endOffset).toBe(normalized.length)
  })

  it('splits long unsectioned text into aligned 10KB chunks', () => {
    const paragraph = '一段没有章节标题的内容。'
    const content = Array.from({ length: 800 }, () => paragraph).join('\n')
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters.length).toBeGreaterThan(1)
    expect(chapters[0].title).toBe('第1章(1)')
    expect(chapters[1].title).toBe('第2章(1)')
    for (const c of chapters) {
      expect(c.endOffset - c.startOffset).toBeLessThanOrEqual(10 * 1024)
    }
    // chunks must be aligned: never split a paragraph mid-line
    for (const c of chapters) {
      if (c.startOffset > 0) {
        const before = normalized.slice(c.startOffset - 1, c.startOffset + 1)
        expect(before).toContain('\n')
      }
    }
  })

  it('merges soft line breaks inside a paragraph', () => {
    const content = '第一章 开篇\n　　示例甲句，\n示例乙句。\n\n　　下一段。'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters[0].title).toBe('第一章 开篇')
    const bodyStart = chapters[0].contentStartOffset
    const body = normalized.slice(bodyStart, chapters[0].endOffset)
    expect(body).toBe('示例甲句，示例乙句。\n\n下一段。')
  })

  it('keeps chapter title intact when previous paragraph is a single character', () => {
    const content = '第十二章 示例收束\n示例正文第一段内容。\n\n甲\n\n第十三章 示例关键人物\n\n戴配饰...'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('第十二章 示例收束')
    expect(chapters[1].title).toBe('第十三章 示例关键人物')
    expect(chapters[1].startOffset).toBe(normalized.indexOf('第十三章'))
    expect(normalized.slice(chapters[1].startOffset, chapters[1].endOffset)).toBe('第十三章 示例关键人物\n\n戴配饰...')
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

  it('honors UTF-8 and UTF-16 BOMs before heuristic detection', () => {
    const text = '第一章 开篇\n正文内容'
    const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
    const utf16le = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, 'utf16le')])
    const utf16beBody = iconv.encode(text, 'utf16le')
    const utf16beBodySwapped = Buffer.allocUnsafe(utf16beBody.length)
    for (let i = 0; i + 1 < utf16beBody.length; i += 2) {
      utf16beBodySwapped[i] = utf16beBody[i + 1]
      utf16beBodySwapped[i + 1] = utf16beBody[i]
    }
    const utf16be = Buffer.concat([Buffer.from([0xfe, 0xff]), utf16beBodySwapped])

    expect(decodeTextBuffer(utf8)).toBe(text)
    expect(decodeTextBuffer(utf16le)).toBe(text)
    expect(decodeTextBuffer(utf16be)).toBe(text)
  })

  it('matches TXT filenames and MIME parameters case-insensitively', () => {
    const parser = new TxtParser()

    expect(parser.match('BOOK.TXT', 'application/octet-stream')).toBe(true)
    expect(parser.match('book.bin', ' Text/Plain; charset=utf-8 ')).toBe(true)
  })

  it('always advances fallback chunks when a boundary newline is at the start', () => {
    const normalized = `\n${'一'.repeat(10 * 1024)}`
    const chapters = fallbackChapters(normalized)

    expect(chapters.length).toBe(2)
    expect(chapters[0].endOffset).toBe(10 * 1024)
    expect(chapters[1].startOffset).toBe(chapters[0].endOffset)
  })

  it('does not merge paragraphs ending with ellipsis', () => {
    const content = '第一章 开篇\n示例第一句内容……\n示例第二句内容。\n示例第三句内容。'
    const normalized = normalizeText(content)
    const chapters = detectTxtChapters(content)

    expect(chapters[0].title).toBe('第一章 开篇')
    const bodyStart = chapters[0].contentStartOffset
    const body = normalized.slice(bodyStart, chapters[0].endOffset)
    expect(body).toBe('示例第一句内容……\n\n示例第二句内容。\n\n示例第三句内容。')
  })

  it('merges a cancelled middle boundary into the previous chapter', () => {
    const normalized = normalizeText('第一章 开篇\n正文一\n第二章 示例排除\n正文二\n第三章 续篇\n正文三')
    const chapters = scanTxtChapters(normalized)
    const targetId = 'ch-' + chapters[1]!.startOffset

    const applied = applyTxtChapterExclusions(chapters, [targetId])

    expect(applied.excludedChapterIds).toEqual([targetId])
    expect(applied.chapters.map((chapter) => chapter.title)).toEqual(['第一章 开篇', '第三章 续篇'])
    expect(getTxtChapterContent(normalized, applied.chapters[0]!)).toContain('第二章 示例排除')
  })

  it('merges a cancelled synthetic preface into the first real chapter', () => {
    const normalized = normalizeText('作品前言\n第一章 开篇\n正文一\n第二章 续篇\n正文二')
    const chapters = scanTxtChapters(normalized)

    const applied = applyTxtChapterExclusions(chapters, ['ch-' + chapters[0]!.startOffset])

    expect(applied.chapters.map((chapter) => chapter.title)).toEqual(['第一章 开篇', '第二章 续篇'])
    expect(getTxtChapterContent(normalized, applied.chapters[0]!)).toContain('作品前言')
  })

  it('does not cancel the first real chapter when there is no preface', () => {
    const normalized = normalizeText('第一章 开篇\n正文一\n第二章 续篇\n正文二')
    const chapters = scanTxtChapters(normalized)

    const applied = applyTxtChapterExclusions(chapters, ['ch-' + chapters[0]!.startOffset])

    expect(applied.excludedChapterIds).toEqual([])
    expect(applied.chapters).toHaveLength(2)
  })

  it('leaves section-like body lines alone without a rule', () => {
    const chapters = detectTxtChapters('第二章 示例旧友\n\n第一节是学校统一安排的晨读。\n\n正文内容\n\n第六章 测试\n\n仅供测试追加内容')

    expect(chapters.map((chapter) => chapter.title)).toEqual(['第二章 示例旧友', '第六章 测试'])
  })

  it('detects 卷一, 部, brackets, and special chapters with default patterns', () => {
    const content = [
      '卷一 甲卷示例',
      '第一章 示例开篇',
      '正文内容一',
      '大结局',
      '正文内容二',
      '【卷二】 乙卷示例',
      '第10章 示例收束',
      '正文内容三',
    ].join('\n\n')

    const chapters = detectTxtChapters(content)
    expect(chapters.map((c) => ({ title: c.title, level: c.level }))).toEqual([
      { title: '卷一 甲卷示例', level: 1 },
      { title: '第一章 示例开篇', level: 2 },
      { title: '大结局', level: 2 },
      { title: '【卷二】 乙卷示例', level: 1 },
      { title: '第10章 示例收束', level: 2 },
    ])
  })

  it('rejects false-positive volume and chapter candidates with default patterns', () => {
    const content = [
      '第一章 示例开篇',
      '第一部分 引言内容属于正文段落。',
      '卷一展开，后面全是正文内容。',
      '第一回合结束，比赛继续进行。',
      '第二章 示例后续',
      '正文内容',
    ].join('\n\n')

    const chapters = detectTxtChapters(content)
    expect(chapters.map((c) => c.title)).toEqual(['第一章 示例开篇', '第二章 示例后续'])
  })
})
