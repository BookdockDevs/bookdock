import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'

import { parseEpubBuffer } from '../formats/epub'

async function buildEpub(opfMetadata: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" version="2.0">
  <metadata>${opfMetadata}</metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
  )
  zip.file('OEBPS/ch1.xhtml', '<html><body><p>content</p></body></html>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('epub metadata extraction', () => {
  it('extracts full bookmeta from OPF', async () => {
    const buffer = await buildEpub(`
    <dc:title>四大名著评注本</dc:title>
    <dc:creator>施耐庵 等</dc:creator>
    <dc:publisher>上海古籍出版社</dc:publisher>
    <dc:date>2019-07-21</dc:date>
    <dc:language>zh-CN</dc:language>
    <dc:subject>古典小说</dc:subject>
    <dc:subject>评注</dc:subject>
    <dc:description>&lt;p&gt;简介内容&lt;/p&gt;</dc:description>
    <dc:identifier opf:scheme="ISBN">9787532567890</dc:identifier>
    <dc:identifier>uid-1560836437</dc:identifier>
    <meta name="calibre:series" content="中国古典文学丛书"/>
    <meta name="calibre:series_index" content="3"/>`)

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.meta.title).toBe('四大名著评注本')
    expect(parsed.meta.author).toBe('施耐庵 等')

    const bookmeta = parsed.meta.bookmeta!
    expect(bookmeta.publisher).toBe('上海古籍出版社')
    expect(bookmeta.published).toBe('2019-07-21')
    expect(bookmeta.language).toBe('zh-CN')
    expect(bookmeta.subjects).toEqual(['古典小说', '评注'])
    expect(bookmeta.description).toBe('简介内容')
    expect(bookmeta.isbn).toBe('9787532567890')
    expect(bookmeta.identifier).toBe('uid-1560836437')
    expect(bookmeta.series).toBe('中国古典文学丛书')
    expect(bookmeta.seriesIndex).toBe(3)
  })

  it('detects ISBN by value shape without a scheme attribute', async () => {
    const buffer = await buildEpub(`
    <dc:title>T</dc:title>
    <dc:identifier>978-0-13-468599-1</dc:identifier>`)

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.meta.bookmeta!.isbn).toBe('978-0-13-468599-1')
    expect(parsed.meta.bookmeta!.identifier).toBeUndefined()
  })

  it('keeps paragraph breaks in escaped HTML descriptions', async () => {
    const buffer = await buildEpub(`
    <dc:title>T</dc:title>
    <dc:description>&lt;p&gt;第一段。&lt;/p&gt;&lt;p&gt;第二段&lt;br/&gt;换行。&lt;/p&gt;</dc:description>`)

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.meta.bookmeta!.description).toBe('第一段。\n\n第二段\n换行。')
  })

  it('keeps paragraph breaks in nested XHTML descriptions', async () => {
    const buffer = await buildEpub(`
    <dc:title>T</dc:title>
    <dc:description><p xmlns="http://www.w3.org/1999/xhtml">第一段。</p><p xmlns="http://www.w3.org/1999/xhtml">第二段。</p></dc:description>`)

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.meta.bookmeta!.description).toBe('第一段。\n\n第二段。')
  })

  it('returns undefined bookmeta when the OPF has no extra metadata', async () => {
    const buffer = await buildEpub(`
    <dc:title>Plain</dc:title>
    <dc:creator>Someone</dc:creator>`)

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.meta.bookmeta).toBeUndefined()
  })
})
