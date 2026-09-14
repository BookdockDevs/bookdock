import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'

import { convertTxtToEpub } from '../lib/txt-to-epub'
import { parseEpubBuffer } from '../formats/epub'

// The reader (foliate-js) resolves the OPF via a namespace-aware lookup, so a
// wrong container namespace passes our lenient parser but breaks the reader.
const OCF_CONTAINER_NS = 'urn:oasis:names:tc:opendocument:xmlns:container'

async function expectReaderCompatibleContainer(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('META-INF/container.xml')!.async('text')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const rootfiles = Array.from(doc.getElementsByTagNameNS(OCF_CONTAINER_NS, 'rootfile'))
  const opf = rootfiles.find(
    (el) => el.getAttribute('media-type') === 'application/oebps-package+xml',
  )
  expect(opf?.getAttribute('full-path')).toBe('OEBPS/content.opf')
}

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
    await expectReaderCompatibleContainer(buffer)

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.meta.title).toBe('测试之书')
    expect(parsed.meta.author).toBe('测试作者')
    expect(parsed.chapters.length).toBe(2)
    expect(parsed.chapters[0].title).toBe('第一章 启程')
    expect(parsed.chapters[1].title).toBe('第二章 旅途')
  })

  it('leaves the generated text stylesheet font-neutral for reader defaults', async () => {
    const buffer = await convertTxtToEpub(
      { title: '字体回退' },
      [{ id: 'ch-0', title: '全文', level: 1 }],
      () => '正文',
    )
    const zip = await JSZip.loadAsync(buffer)
    const css = await zip.file('OEBPS/style.css')?.async('string')

    expect(css).toBeDefined()
    expect(css).not.toMatch(/font-family\s*:/i)
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
    await expectReaderCompatibleContainer(buffer)
  })
})
