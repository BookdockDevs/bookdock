import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'

import { parseEpubBuffer } from '../formats/epub'

async function buildEpubWithNcx(): Promise<Buffer> {
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
  <metadata><dc:title>T</dc:title></metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`,
  )
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="n1"><navLabel><text>第一章 起</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>第一章 续</text></navLabel><content src="ch1.xhtml#sec2"/></navPoint>
    <navPoint id="n3"><navLabel><text>第二章</text></navLabel><content src="ch2.xhtml"/></navPoint>
  </navMap>
</ncx>`,
  )
  zip.file(
    'OEBPS/ch1.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml"><body>
      <p>天地玄黄宇宙洪荒</p>
      <p>hello world &amp; foo</p>
    </body></html>`,
  )
  zip.file(
    'OEBPS/ch2.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>日月盈昃</p></body></html>',
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('epub chapter word counts', () => {
  it('counts chapter text via DOM textContent and dedupes shared files', async () => {
    const parsed = await parseEpubBuffer(await buildEpubWithNcx())
    expect(parsed.chapters).toHaveLength(3)

    // ch1: 8 CJK chars + 3 latin runs (hello/world/foo);
    // &amp; resolves to '&' and is not counted
    const ch1 = parsed.chapters[0]
    expect(ch1.title).toBe('第一章 起')
    expect(ch1.wordCount).toBe(11)

    // ch1.xhtml#sec2 shares the file: counted once, second entry gets 0
    expect(parsed.chapters[1].wordCount).toBe(0)

    expect(parsed.chapters[2].wordCount).toBe(4)
  })
})
