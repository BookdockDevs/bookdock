import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'

import { EpubParser, parseEpubBuffer } from '../formats/epub'

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

async function buildEpubWithNamedCover(): Promise<Buffer> {
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
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <metadata><dc:title>Named cover</dc:title></metadata>
  <manifest>
    <item id="icon" href="Images/icon.png" media-type="image/png"/>
    <item id="cover" href="Images/cover.jpg" media-type="image/jpeg"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
  )
  zip.file('OEBPS/Images/icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  zip.file('OEBPS/Images/cover.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  zip.file('OEBPS/ch1.xhtml', '<html><body><p>content</p></body></html>')
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function buildEpubFixture(
  opf: string | Buffer,
  files: Array<{ path: string; data: string | Buffer }>,
  rootfile = 'OPS/package.opf',
  rootfileMediaType = 'application/oebps-package+xml',
): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${rootfile}" media-type="${rootfileMediaType}"/></rootfiles>
</container>`,
  )
  zip.file(rootfile, opf)
  for (const file of files) zip.file(file.path, file.data)
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('epub metadata extraction', () => {
  it('matches EPUB filenames and MIME parameters case-insensitively', () => {
    const parser = new EpubParser()

    expect(parser.match('BOOK.EPUB', 'application/octet-stream')).toBe(true)
    expect(parser.match('book.bin', ' Application/EPUB+ZIP; charset=binary ')).toBe(true)
  })

  it('normalizes manifest MIME case and parameters for rootfile, NCX, nav, and chapters', async () => {
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">MIME</dc:title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="APPLICATION/X-DTBNCX+XML; charset=utf-8"/><item id="chapter" href="chapter.xhtml" media-type="APPLICATION/XHTML+XML; charset=utf-8"/><item id="nav" href="nav.xhtml" media-type="TEXT/HTML; charset=utf-8" properties="nav"/></manifest><spine toc="ncx"><itemref idref="chapter"/></spine></package>`,
      [
        { path: 'OPS/toc.ncx', data: '<ncx><navMap><navPoint><navLabel><text>第一章</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>' },
        { path: 'OPS/nav.xhtml', data: '<html><body><nav epub:type="toc"><a href="chapter.xhtml">导航</a></nav></body></html>' },
        { path: 'OPS/chapter.xhtml', data: '<html><body><p>正文</p></body></html>' },
      ],
      'OPS/package.opf',
      'APPLICATION/OEBPS-PACKAGE+XML; charset=utf-8',
    )

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.chapters).toEqual([{ title: '第一章', content: 'OPS/chapter.xhtml', wordCount: 2 }])
  })

  it('preserves nested NCX and EPUB3 navigation levels', async () => {
    const ncxBuffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Nested NCX</dc:title></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="three" href="three.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine></package>`,
      [
        { path: 'OPS/toc.ncx', data: '<ncx><navMap><navPoint><navLabel><text>第一卷</text></navLabel><content src="one.xhtml"/><navPoint><navLabel><text>第一章</text></navLabel><content src="two.xhtml"/></navPoint></navPoint><navPoint><navLabel><text>第二卷</text></navLabel><content src="three.xhtml"/></navPoint></navMap></ncx>' },
        { path: 'OPS/one.xhtml', data: '<html><body><p>one</p></body></html>' },
        { path: 'OPS/two.xhtml', data: '<html><body><p>two</p></body></html>' },
        { path: 'OPS/three.xhtml', data: '<html><body><p>three</p></body></html>' },
      ],
    )
    const ncx = await parseEpubBuffer(ncxBuffer)
    expect(ncx.chapters.map(({ title, level }) => ({ title, level }))).toEqual([
      { title: '第一卷', level: undefined },
      { title: '第一章', level: 2 },
      { title: '第二卷', level: undefined },
    ])

    const navBuffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0"><metadata><dc:title>Nested nav</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
      [
        { path: 'OPS/nav.xhtml', data: '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml">卷一</a><ol><li><a href="two.xhtml">第一章</a></li></ol></li></ol></nav></body></html>' },
        { path: 'OPS/one.xhtml', data: '<html><body><p>one</p></body></html>' },
        { path: 'OPS/two.xhtml', data: '<html><body><p>two</p></body></html>' },
      ],
    )
    const nav = await parseEpubBuffer(navBuffer)
    expect(nav.chapters.map(({ title, level }) => ({ title, level }))).toEqual([
      { title: '卷一', level: undefined },
      { title: '第一章', level: 2 },
    ])
  })

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

  it('honors EPUB 3 title, creator role, and series refinements', async () => {
    const buffer = await buildEpub(`
    <dc:title id="subtitle">副标题</dc:title>
    <meta refines="#subtitle" property="title-type">subtitle</meta>
    <dc:title id="main">主标题</dc:title>
    <meta refines="#main" property="title-type">main</meta>
    <dc:creator id="editor">编者</dc:creator>
    <meta refines="#editor" property="role">edt</meta>
    <dc:creator id="author">作者</dc:creator>
    <meta refines="#author" property="role">aut</meta>
    <meta id="series" property="belongs-to-collection">系列</meta>
    <meta refines="#series" property="collection-type">series</meta>
    <meta refines="#series" property="group-position">2.2</meta>`)

    const parsed = await parseEpubBuffer(buffer)
    expect(parsed.meta.title).toBe('主标题')
    expect(parsed.meta.author).toBe('作者')
    expect(parsed.meta.bookmeta?.series).toBe('系列')
    expect(parsed.meta.bookmeta?.seriesIndex).toBe(2.2)
  })

  it('keeps OPF refinement and contributor metadata', async () => {
    const buffer = await buildEpub(`
    <dc:title id="main" opf:file-as="Main title">主标题</dc:title>
    <meta refines="#main" property="title-type">main</meta>
    <dc:title id="sub">副标题</dc:title>
    <meta refines="#sub" property="title-type">subtitle</meta>
    <dc:creator id="author" opf:file-as="Author, A">作者</dc:creator>
    <meta refines="#author" property="role">aut</meta>
    <dc:creator>编者</dc:creator>
    <dc:contributor opf:role="trl" opf:file-as="Translator, T">译者</dc:contributor>
    <dc:language>zh-CN</dc:language>
    <dc:language>en</dc:language>
    <dc:subject opf:term="FIC" opf:authority="BISAC">小说</dc:subject>
    <dc:rights>版权所有</dc:rights>
    <dc:source>urn:source:test</dc:source>
    <meta property="dcterms:modified">2026-09-14T08:00:00Z</meta>`)

    const parsed = await parseEpubBuffer(buffer)
    const bookmeta = parsed.meta.bookmeta!
    expect(bookmeta.subtitle).toBe('副标题')
    expect(bookmeta.sortAs).toBe('Main title')
    expect(bookmeta.authorSortAs).toBe('Author, A')
    expect(bookmeta.languages).toEqual(['zh-CN', 'en'])
    expect(bookmeta.subjectDetails).toEqual([{ name: '小说', term: 'FIC', authority: 'BISAC' }])
    expect(bookmeta.rights).toBe('版权所有')
    expect(bookmeta.source).toBe('urn:source:test')
    expect(bookmeta.modified).toBe('2026-09-14T08:00:00Z')
    expect(bookmeta.contributors).toEqual([
      { name: '作者', role: 'aut', sortAs: 'Author, A' },
      { name: '编者', role: undefined, sortAs: undefined },
      { name: '译者', role: 'trl', sortAs: 'Translator, T' },
    ])
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

  it('accepts alternate DC and OPF prefixes in metadata', async () => {
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" xmlns:d="http://purl.org/dc/elements/1.1/" xmlns:o="http://www.idpf.org/2007/opf" version="3.0">
        <metadata>
          <d:title o:file-as="Title, T">标题</d:title>
          <d:creator o:role="aut" o:file-as="Author, A">作者</d:creator>
          <d:identifier o:scheme="ISBN">9787532567890</d:identifier>
        </metadata>
        <manifest><item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="ch1"/></spine>
      </package>`,
      [{ path: 'OPS/chapter.xhtml', data: '<html><body><p>content</p></body></html>' }],
      'OPS/package.opf',
    )

    const parsed = await parseEpubBuffer(buffer)

    expect(parsed.meta.title).toBe('标题')
    expect(parsed.meta.author).toBe('作者')
    expect(parsed.meta.bookmeta).toMatchObject({
      sortAs: 'Title, T',
      authorSortAs: 'Author, A',
      isbn: '9787532567890',
    })
  })

  it('prefers a cover-named image over the first auxiliary image', async () => {
    const parsed = await parseEpubBuffer(await buildEpubWithNamedCover())

    expect(parsed.meta.cover).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  })

  it('prioritizes EPUB 3 cover-image and resolves normalized archive paths', async () => {
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata>
    <dc:title>Cover priority</dc:title>
    <meta name="cover" content="cover-page"/>
  </metadata>
  <manifest>
    <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="icon" href="images/icon.png" media-type="image/png"/>
    <item id="front-cover" href="../Images/My%20Cover.JPG?cache=1#front" media-type="IMAGE/JPEG" properties="cover-image rendition:page-spread-center"/>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
      [
        { path: 'images/icon.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
        { path: 'images/My Cover.JPG', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
        { path: 'text/cover.xhtml', data: '<html><body>cover page</body></html>' },
        { path: 'text/ch1.xhtml', data: '<html><body><p>content</p></body></html>' },
      ],
    )

    const parsed = await parseEpubBuffer(buffer)

    expect(parsed.meta.cover).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  })

  it('ignores a non-image legacy cover target and skips navigation images', async () => {
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <metadata>
    <dc:title>Heuristic cover</dc:title>
    <meta name="cover" content="cover-page"/>
  </metadata>
  <manifest>
    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav-cover" href="images/nav-cover.png" media-type="image/png" properties="nav"/>
    <item id="front-cover" href="images/front-cover.jpg" media-type="image/jpeg"/>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
      [
        { path: 'OPS/cover.xhtml', data: '<html><body>cover page</body></html>' },
        { path: 'OPS/images/nav-cover.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
        { path: 'OPS/images/front-cover.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
        { path: 'OPS/chapter.xhtml', data: '<html><body><p>content</p></body></html>' },
      ],
    )

    const parsed = await parseEpubBuffer(buffer)

    expect(parsed.meta.cover).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  })

  it('falls back to EPUB3 nav when the preferred NCX is unavailable', async () => {
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata><dc:title>Nav fallback</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="missing-ncx" href="missing.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="missing-ncx"><itemref idref="ch1"/></spine>
</package>`,
      [
        { path: 'OPS/nav.xhtml', data: '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="chapter.xhtml#start">第一章</a></li></ol></nav><nav epub:type="page-list" xmlns:epub="http://www.idpf.org/2007/ops"><a href="chapter.xhtml">1</a></nav></body></html>' },
        { path: 'OPS/chapter.xhtml', data: '<html><body><p>content</p></body></html>' },
      ],
    )

    const parsed = await parseEpubBuffer(buffer)

    expect(parsed.chapters).toEqual([{ title: '第一章', content: 'OPS/chapter.xhtml', wordCount: 1 }])
  })


  it('extracts the image referenced by a legacy cover XHTML page', async () => {
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <metadata><dc:title>Cover page</dc:title><meta name="cover" content="cover-page"/></metadata>
  <manifest>
    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
      [
        { path: 'OPS/cover.xhtml', data: '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="images/artwork.bin"/></body></html>' },
        { path: 'OPS/images/artwork.bin', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
        { path: 'OPS/chapter.xhtml', data: '<html><body><p>content</p></body></html>' },
      ],
    )

    const parsed = await parseEpubBuffer(buffer)

    expect(parsed.meta.cover).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  })

  it('falls back to a valid common root cover when the manifest has no cover', async () => {
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata><dc:title>Root cover</dc:title></metadata>
  <manifest><item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
      [
        { path: 'OPS/chapter.xhtml', data: '<html><body><p>content</p></body></html>' },
        { path: 'iTunesArtwork', data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
      ],
    )

    const parsed = await parseEpubBuffer(buffer)

    expect(parsed.meta.cover).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  })
  it('uses the NCX declared by spine toc before a different NCX manifest item', async () => {
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <metadata><dc:title>Declared NCX</dc:title></metadata>
  <manifest>
    <item id="legacy-ncx" href="toc/legacy.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="preferred-ncx" href="toc/preferred.ncx" media-type="APPLICATION/X-DTBNCX+XML"/>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="preferred-ncx"><itemref idref="ch1"/></spine>
</package>`,
      [
        {
          path: 'OPS/toc/legacy.ncx',
          data: '<ncx><navMap><navPoint><navLabel><text>Legacy</text></navLabel><content src="../chapter.xhtml"/></navPoint></navMap></ncx>',
        },
        {
          path: 'OPS/toc/preferred.ncx',
          data: '<ncx><navMap><navPoint><navLabel><text>Preferred</text></navLabel><content src="../chapter.xhtml#start"/></navPoint></navMap></ncx>',
        },
        { path: 'OPS/chapter.xhtml', data: '<html><body><p>content</p></body></html>' },
      ],
    )

    const parsed = await parseEpubBuffer(buffer)

    expect(parsed.chapters[0]?.title).toBe('Preferred')
    expect(parsed.chapters[0]?.content).toBe('OPS/chapter.xhtml')
  })

  it('skips an invalid named cover and falls back to another usable raster image', async () => {
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <metadata><dc:title>Cover fallback</dc:title></metadata>
  <manifest>
    <item id="icon" href="images/icon.png" media-type="image/png"/>
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
      [
        { path: 'OPS/images/icon.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
        { path: 'OPS/images/cover.jpg', data: Buffer.from([0x01, 0x02, 0x03]) },
        { path: 'OPS/chapter.xhtml', data: '<html><body><p>content</p></body></html>' },
      ],
    )

    const parsed = await parseEpubBuffer(buffer)

    expect(parsed.meta.cover).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('reads UTF-16 OPF metadata and chapter content', async () => {
    const opf = `<?xml version="1.0" encoding="utf-16"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <metadata><dc:title>UTF-16 book</dc:title></metadata>
  <manifest><item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`
    const opfBytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(opf, 'utf16le')])
    const parsed = await parseEpubBuffer(await buildEpubFixture(opfBytes, [
      { path: 'OPS/chapter.xhtml', data: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<html><body><p>正文</p></body></html>', 'utf16le')]) },
    ]))

    expect(parsed.meta.title).toBe('UTF-16 book')
    expect(parsed.chapters[0]?.wordCount).toBeGreaterThan(0)
  })

  it('detects a PNG stored as an extensionless iTunesArtwork cover', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const buffer = await buildEpubFixture(
      `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata><dc:title>PNG artwork</dc:title></metadata>
  <manifest><item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
      [
        { path: 'OPS/chapter.xhtml', data: '<html><body><p>content</p></body></html>' },
        { path: 'iTunesArtwork', data: png },
      ],
    )

    const parsed = await parseEpubBuffer(buffer)

    expect(parsed.meta.cover).toEqual(png)
  })

  it('reports a corrupt archive as an invalid EPUB', async () => {
    await expect(parseEpubBuffer(Buffer.from('not a zip archive')))
      .rejects.toThrow('Invalid EPUB: corrupt ZIP archive')
  })
})
