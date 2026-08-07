import { describe, it, expect } from 'vitest'
import { convertTxtToEpub } from '../lib/txt-to-epub'
import { parseEpubBuffer } from '../formats/epub'

describe('convertTxtToEpub', () => {
  it('produces a valid EPUB with chapters', async () => {
    const chapters = [
      { id: 'ch-1', title: '第一章 启程', level: 1 },
      { id: 'ch-2', title: '第二章 旅途', level: 1 },
    ]
    const contentFor = (i: number) => (i === 0 ? '这是一个开始。\n\n第二段。' : '继续旅程。\n\n又一段。')

    const buffer = await convertTxtToEpub(
      { title: '测试之书', author: '测试作者', id: 'test-book-id' },
      chapters,
      contentFor,
    )

    expect(buffer.length).toBeGreaterThan(0)

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.meta.title).toBe('测试之书')
    expect(parsed.meta.author).toBe('测试作者')
    expect(parsed.chapters.length).toBe(2)
    expect(parsed.chapters[0].title).toBe('第一章 启程')
    expect(parsed.chapters[1].title).toBe('第二章 旅途')
  })

  it('handles a single chapter fallback', async () => {
    const buffer = await convertTxtToEpub(
      { title: 'Only' },
      [{ id: 'ch-0', title: '全文', level: 1 }],
      () => '只有一段。',
    )

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.chapters.length).toBe(1)
    expect(parsed.chapters[0].title).toBe('全文')
  })
})
