import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { loadEpubSpineMarkup } from '../../formats/epub'
import { convertTxtToEpub } from '../../lib/txt-to-epub'
import { patchEpubPackage, readEpubEditorPackage } from './epub-editor-package'

describe('EPUB package editor', () => {
  it('leaves navigation and package metadata untouched when only body text changes', async () => {
    const base = await convertTxtToEpub({ title: 'Book', id: 'book' }, [{ id: 'one', title: 'One', level: 0 }], () => 'Body')
    const zip = await JSZip.loadAsync(base)
    const originalNcx = (await zip.file('OEBPS/toc.ncx')!.async('string')).replace('id="navpoint-1"', 'id="original-id" class="custom"')
    zip.file('OEBPS/toc.ncx', originalNcx)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    zip.file('OEBPS/content.opf', opf.replace('</manifest>', '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>'))
    const originalNav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li class="volume"><span>Volume</span><ol><li><a href="chapter-0001.xhtml">One</a></li></ol></li></ol></nav></body></html>'
    zip.file('OEBPS/nav.xhtml', originalNav)
    const source = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
    const originalOpf = await (await JSZip.loadAsync(source)).file('OEBPS/content.opf')!.async('string')
    const draft = await readEpubEditorPackage(source)
    const saved = await patchEpubPackage(source, {
      baseRevisionId: 'rev', documents: [{ ...draft.documents[0]!, content: draft.documents[0]!.content.replace('Body', 'Body edited') }],
      tocEntries: draft.tocEntries, spineOrder: draft.spineOrder,
    })
    const result = await JSZip.loadAsync(saved)
    expect(await result.file('OEBPS/toc.ncx')!.async('string')).toBe(originalNcx)
    expect(await result.file('OEBPS/nav.xhtml')!.async('string')).toBe(originalNav)
    expect(await result.file('OEBPS/content.opf')!.async('string')).toBe(originalOpf)
  })

  it('preserves an image cover target in the TOC when saving another edit', async () => {
    const source = await convertTxtToEpub({ title: 'Book', id: 'book' }, [{ id: 'one', title: 'One', level: 0 }], () => 'Body')
    const zip = await JSZip.loadAsync(source)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    zip.file('OEBPS/content.opf', opf.replace('</manifest>', '<item id="cover-svg" href="images/cover.svg" media-type="image/svg+xml"/></manifest>'))
    zip.file('OEBPS/images/cover.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const ncx = await zip.file('OEBPS/toc.ncx')!.async('string')
    zip.file('OEBPS/toc.ncx', ncx.replace('</navMap>', '<navPoint id="cover"><navLabel><text>Cover</text></navLabel><content src="images/cover.svg#view"/></navPoint></navMap>'))
    const prepared = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
    const draft = await readEpubEditorPackage(prepared)
    expect(draft.tocEntries.some((entry) => entry.href === 'OEBPS/images/cover.svg#view')).toBe(true)
    const saved = await patchEpubPackage(prepared, { baseRevisionId: 'rev', documents: [], tocEntries: draft.tocEntries, spineOrder: draft.spineOrder })
    const reopened = await readEpubEditorPackage(saved)
    expect(reopened.tocEntries).toEqual(draft.tocEntries)
    expect(await (await JSZip.loadAsync(saved)).file('OEBPS/images/cover.svg')!.async('string')).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>')
  })

  it('patches selected XHTML while keeping package resources and separating TOC from spine order', async () => {
    const source = await convertTxtToEpub({ title: 'Book', id: 'book' }, [
      { id: 'one', title: 'One', level: 0 },
      { id: 'two', title: 'Two', level: 0 },
    ], (index) => `Body ${index + 1}`)
    const original = await JSZip.loadAsync(source)
    const resource = Buffer.from([0, 1, 2, 3, 254, 255])
    original.file('OEBPS/picture.bin', resource)
    const preparedSource = Buffer.from(await original.generateAsync({ type: 'uint8array' }))
    const chapters = await loadEpubSpineMarkup(preparedSource)
    const [first, second] = chapters
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    const draft = await readEpubEditorPackage(preparedSource)
    expect(draft.documents.map((document) => document.href)).toEqual([first!.href, second!.href])
    expect(draft.documents[0]?.content).toContain('<body')
    expect(draft.tocEntries.map((entry) => entry.title)).toEqual(['One', 'Two'])
    expect(draft.spineOrder).toEqual([first!.href, second!.href])

    const result = await patchEpubPackage(preparedSource, {
      baseRevisionId: 'rev-1',
      documents: [{ href: first!.href, content: first!.markup.replace('Body 1', 'Edited body') }],
      tocEntries: [
        { href: `${second!.href}#top`, title: 'Renamed two', level: 1 },
        { href: first!.href, title: 'One', level: 1 },
      ],
      spineOrder: [second!.href, first!.href],
    })

    const updatedChapters = await loadEpubSpineMarkup(result)
    expect(updatedChapters.map((chapter) => chapter.href)).toEqual([second!.href, first!.href])
    expect(updatedChapters[1]?.markup).toContain('Edited body')
    const updated = await JSZip.loadAsync(result)
    expect(await updated.file('OEBPS/picture.bin')!.async('nodebuffer')).toEqual(resource)
    const ncx = await updated.file('OEBPS/toc.ncx')!.async('string')
    expect(ncx.indexOf('Renamed two')).toBeLessThan(ncx.indexOf('One'))
    expect(ncx.indexOf(`${second!.href.split('/').pop()}#top`)).toBeLessThan(ncx.indexOf(first!.href.split('/').pop()!))
  })

  it('replaces the EPUB 3 TOC tree without changing the XHTML document structure', async () => {
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    zip.file('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    zip.file('OEBPS/package.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier>book</dc:identifier><dc:title>Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="image" href="picture.bin" media-type="image/png"/></manifest><spine toc="ncx"><itemref idref="one"/><itemref idref="two"/></spine></package>')
    zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="one.xhtml">One</a></li><li><a href="two.xhtml">Two</a></li></ol></nav></body></html>')
    zip.file('OEBPS/toc.ncx', '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="one" playOrder="1"><navLabel><text>One</text></navLabel><content src="one.xhtml"/></navPoint><navPoint id="two" playOrder="2"><navLabel><text>Two</text></navLabel><content src="two.xhtml"/></navPoint></navMap></ncx>')
    zip.file('OEBPS/one.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"/></head><body><p id="start"><a href="#note">note</a><a href="two.xhtml#next"><ruby>One<rt>uno</rt></ruby></a><img src="picture.bin"/><img src="images/figure.svg#part"/></p><table><tr><td><em>Cell</em></td></tr></table><aside id="note">Footnote</aside></body></html>')
    zip.file('OEBPS/two.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Two</p></body></html>')
    zip.file('OEBPS/picture.bin', Buffer.from([0, 1, 2]))
    zip.file('OEBPS/style.css', 'p { color: red; background: url(images/background.png); }')
    zip.file('OEBPS/images/figure.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect id="part" width="10" height="10"/></svg>')
    zip.file('OEBPS/images/background.png', Buffer.from([1, 2, 3]))
    const source = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
    const draft = await readEpubEditorPackage(source)
    const first = draft.documents.find((document) => document.href.endsWith('/one.xhtml'))!
    const result = await patchEpubPackage(source, {
      baseRevisionId: 'rev-1',
      documents: [{ href: first.href, content: first.content.replace('One<rt>', 'Edited<rt>') }],
      tocEntries: [
        { href: draft.spineOrder[1]!, title: 'Second', level: 1 },
        { href: draft.spineOrder[0]!, title: 'First', level: 2 },
      ],
      spineOrder: [...draft.spineOrder].reverse(),
    })
    expect(result.readUInt32LE(0)).toBe(0x04034b50)
    expect(result.readUInt16LE(8)).toBe(0)
    const saved = await readEpubEditorPackage(result)
    const updatedBody = saved.documents.find((document) => document.href === first.href)!.content
    expect(saved.tocEntries).toEqual([
      { href: draft.spineOrder[1], title: 'Second', level: 1 },
      { href: draft.spineOrder[0], title: 'First', level: 2 },
    ])
    expect(updatedBody).toContain('<link rel="stylesheet" href="style.css"/>')
    expect(updatedBody).toContain('<a href="two.xhtml#next"><ruby>Edited<rt>uno</rt></ruby></a><img src="picture.bin"/><img src="images/figure.svg#part"/>')
    expect(updatedBody).toContain('<a href="#note">note</a>')
    expect(updatedBody).toContain('<table><tr><td><em>Cell</em></td></tr></table><aside id="note">Footnote</aside>')
    const output = await JSZip.loadAsync(result)
    expect(await output.file('OEBPS/picture.bin')!.async('nodebuffer')).toEqual(Buffer.from([0, 1, 2]))
    expect(await output.file('OEBPS/style.css')!.async('string')).toBe('p { color: red; background: url(images/background.png); }')
    expect(await output.file('OEBPS/images/background.png')!.async('nodebuffer')).toEqual(Buffer.from([1, 2, 3]))
    expect(await output.file('OEBPS/images/figure.svg')!.async('string')).toContain('id="part"')
    const ncx = await output.file('OEBPS/toc.ncx')!.async('string')
    expect(ncx.indexOf('Second')).toBeLessThan(ncx.indexOf('First'))
    expect(ncx.indexOf('two.xhtml')).toBeLessThan(ncx.indexOf('one.xhtml'))
  })

  it('writes nav and NCX links relative to their own locations', async () => {
    const base = await convertTxtToEpub({ title: 'Nested nav', id: 'nested-nav' }, [
      { id: 'one', title: 'One', level: 0 }, { id: 'two', title: 'Two', level: 0 },
    ], (index) => `Body ${index + 1}`)
    const zip = await JSZip.loadAsync(base)
    const packageFile = zip.file('OEBPS/content.opf')!
    const packageXml = await packageFile.async('string')
    zip.file('OEBPS/content.opf', packageXml.replace('</manifest>', '<item id="nav" href="Navigation/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>'))
    zip.file('OEBPS/Navigation/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="../chapter-0001.xhtml">One</a></li><li><a href="../chapter-0002.xhtml">Two</a></li></ol></nav></body></html>')
    const source = Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
    const draft = await readEpubEditorPackage(source)
    const result = await patchEpubPackage(source, {
      baseRevisionId: 'rev-1', documents: [],
      tocEntries: draft.tocEntries.map((entry, index) => ({ ...entry, title: `Updated ${index + 1}` })),
      spineOrder: draft.spineOrder,
    })
    const saved = await JSZip.loadAsync(result)
    const nav = await saved.file('OEBPS/Navigation/nav.xhtml')!.async('string')
    const ncx = await saved.file('OEBPS/toc.ncx')!.async('string')

    expect(nav).toContain('href="../chapter-0001.xhtml"')
    expect(ncx).toContain('src="chapter-0001.xhtml"')
  })
})
