import { describe, expect, it } from 'vitest'

import { applyEpubEditorTheme, epubEditorFrame, extractEpubVisibleText, locateEpubFragment, markEpubImplicitTableBodies, serializeVisibleBody, setEpubPresentationAttribute, syncEpubHeading } from './epub-document-adapter'

describe('EPUB document adapter', () => {
  it('applies and switches iframe themes without adding theme state to saved body markup', () => {
    const live = document.implementation.createHTMLDocument('')
    live.body.innerHTML = '<h1 style="color:#111">Heading</h1><p style="color:#0000ff">Blue</p><p style="border-color:#000">Border</p><p style="color:#111;background-color:#fff">Paired</p><div style="background:white"><span style="color:#111">Ancestor pair</span></div><a style="color:black">Link</a><p style="color:white">White text</p>'
    const originalBody = live.body.innerHTML

    applyEpubEditorTheme(live, true)
    const themeStyle = live.head.querySelector('style#bookdock-editor-theme')
    expect(themeStyle?.textContent).toContain('color-scheme:dark')
    expect(themeStyle?.textContent).toContain('background:#1c1917')
    expect(themeStyle?.textContent).toContain('html{background:#1c1917}')
    expect(themeStyle?.textContent).toContain('body [style="color:#111"]:not(a):not(a *):not([style*="background" i]):not([style*="background" i] *){color:#e7e5e4!important}')
    expect(themeStyle?.textContent).not.toContain('color:#0000ff')
    expect(themeStyle?.textContent).not.toContain('border-color:#000')
    expect(live.querySelector('span')!.matches('body [style="color:#111"]:not(a):not(a *):not([style*="background" i]):not([style*="background" i] *)')).toBe(false)
    expect(live.body.innerHTML).toBe(originalBody)
    const insertedPaired = live.createElement('p')
    insertedPaired.setAttribute('style', 'color:#111;background:white')
    insertedPaired.textContent = 'Inserted paired paragraph'
    live.body.insertBefore(insertedPaired, live.querySelector('h1'))
    const bodyWithInsertion = live.body.innerHTML
    applyEpubEditorTheme(live, true)
    expect(insertedPaired.matches('body [style="color:#111;background:white"]:not(a):not(a *):not([style*="background" i]):not([style*="background" i] *)')).toBe(false)
    expect(live.body.innerHTML).toBe(bodyWithInsertion)
    expect(getComputedStyle(live.querySelector('p[style*="0000ff"]')!).color).toBe('rgb(0, 0, 255)')
    expect(getComputedStyle(live.querySelector('p[style*="background-color"]')!).color).toBe('rgb(17, 17, 17)')
    expect(getComputedStyle(live.querySelector('span')!).color).toBe('rgb(17, 17, 17)')
    expect(getComputedStyle(live.querySelector('a')!).color).toBe('rgb(0, 0, 0)')

    applyEpubEditorTheme(live, false)
    expect(live.head.querySelectorAll('style#bookdock-editor-theme')).toHaveLength(1)
    expect(themeStyle?.textContent).toContain('color-scheme:light')
    expect(themeStyle?.textContent).toContain('body [style="color:white"]:not(a):not(a *):not([style*="background" i]):not([style*="background" i] *){color:#1c1917!important}')
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p style="color:#111">Text</p></body></html>'
    const sourceDocument = new DOMParser().parseFromString(source, 'text/html')
    expect(serializeVisibleBody(source, sourceDocument.body)).toBe(source)
  })

  it('renders the requested initial frame theme', () => {
    const darkFrame = epubEditorFrame('<html><body>Text</body></html>', true)
    const lightFrame = epubEditorFrame('<html><body>Text</body></html>')
    const escapedStyleValue = epubEditorFrame('<html><body><p style="color:#111;--label:&quot;&lt;/style&gt;&quot;">Text</p></body></html>', true)

    expect(darkFrame).toContain('color-scheme:dark')
    expect(lightFrame).toContain('color-scheme:light')
    expect([...escapedStyleValue.matchAll(/<\/style>/gi)]).toHaveLength(1)
    expect(lightFrame).toContain('max-width:min(100%,52rem)')
    expect(lightFrame).toContain('min-height:calc(100vh - 48px)')
    expect(lightFrame).toContain('margin-inline:auto!important')
    expect(lightFrame).not.toContain('body{color:#1c1917;background:')
  })

  it('preserves original XHTML when reverted edits leave the same canonical body tree', () => {
    const source = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body data-page="1"><p title="A &amp; B" class="copy">A &amp; B &lt;book&gt;</p><br/><img alt="Cover" src="cover.png"/></body></html>'
    const originalBody = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)![1]
    const live = new DOMParser().parseFromString(`<!doctype html><html><body>${originalBody}</body></html>`, 'text/html')
    const text = live.querySelector('p')!.firstChild!
    text.textContent = 'Temporary edit'
    text.textContent = 'A & B <book>'

    expect(serializeVisibleBody(source, live.body)).toBe(source)
  })

  it('does not introduce namespace changes when a saved draft edit is reverted', () => {
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Original</p></body></html>'
    const live = new DOMParser().parseFromString(source, 'text/html')
    live.querySelector('p')!.textContent = 'Changed'
    const changed = serializeVisibleBody(source, live.body)
    live.querySelector('p')!.textContent = 'Original'
    expect(serializeVisibleBody(changed, live.body)).toBe(source)
  })

  it('keeps structural formatting changes even when the visible text is unchanged', () => {
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p><strong>Word</strong></p></body></html>'
    const live = new DOMParser().parseFromString('<!doctype html><html><body><p><strong>Word</strong></p></body></html>', 'text/html')
    live.querySelector('strong')!.replaceWith(live.createTextNode('Word'))

    const updated = serializeVisibleBody(source, live.body)
    expect(updated).not.toBe(source)
    expect(new DOMParser().parseFromString(updated, 'application/xhtml+xml').querySelector('p')?.textContent).toBe('Word')
  })

  it('serializes visible body edits while preserving the source XHTML shell and references', () => {
    const source = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link href="style.css"/></head><body class="page"><h1 id="start">Title</h1><p><a href="next.xhtml">Text</a><img src="../image.png"/></p></body></html>'
    const live = new DOMParser().parseFromString(source, 'application/xhtml+xml')
    live.querySelector('a')!.textContent = 'Edited'
    const updated = serializeVisibleBody(source, live.querySelector('body')!)

    expect(updated).toContain('<head><link href="style.css"/></head>')
    expect(updated).toContain('<body class="page"><h1')
    expect(updated).toContain('<a href="next.xhtml">Edited</a>')
    expect(updated).toContain('<img src="../image.png"')
    expect(extractEpubVisibleText(updated)).toBe('Title\nEdited')
  })

  it('locates encoded fragments and synchronizes only an identified safe heading', () => {
    const source = { href: 'chapter.xhtml', content: '<html xmlns="http://www.w3.org/1999/xhtml"><body><h2 id="a b">Old</h2></body></html>' }
    const live = new DOMParser().parseFromString(source.content, 'application/xhtml+xml')
    expect(locateEpubFragment(live, 'a%20b')?.tagName.toLowerCase()).toBe('h2')
    const updated = syncEpubHeading(source, { href: 'chapter.xhtml#a%20b', title: 'New', level: 1 }, 0, live.body)
    expect(updated.content).toContain('id="a b">New</h2>')
    expect(source.content).toContain('Old')
  })

  it('retains XHTML namespaces nested inside SVG foreignObject after an edit', () => {
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Before</p><svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Inside</div></foreignObject></svg></body></html>'
    const live = new DOMParser().parseFromString(source, 'application/xhtml+xml')
    live.querySelector('p')!.textContent = 'After'

    const saved = new DOMParser().parseFromString(serializeVisibleBody(source, live.querySelector('body')!), 'application/xhtml+xml')
    expect(saved.querySelector('parsererror')).toBeNull()
    expect(saved.querySelector('svg')?.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(saved.querySelector('foreignObject div')?.namespaceURI).toBe('http://www.w3.org/1999/xhtml')
  })

  it('removes temporary resource URLs from edits without discarding original references', () => {
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Before<img src="../images/a.png" style="background:url(../images/b.png)"/></p><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../images/c.svg#part"/></svg></body></html>'
    const live = new DOMParser().parseFromString(source, 'text/html')
    setEpubPresentationAttribute(live.querySelector('img')!, 'src', 'blob:temporary-a')
    setEpubPresentationAttribute(live.querySelector('img')!, 'style', 'background:url(blob:temporary-b)')
    setEpubPresentationAttribute(live.querySelector('image')!, 'xlink:href', 'blob:temporary-c#part')
    expect(serializeVisibleBody(source, live.body)).toBe(source)
    live.querySelector('p')!.firstChild!.textContent = 'After'
    const saved = serializeVisibleBody(source, live.body)
    expect(saved).not.toContain('blob:')
    expect(saved).toContain('../images/a.png')
    expect(saved).toContain('../images/b.png')
    expect(saved).toContain('../images/c.svg#part')
  })

  it('preserves untouched XHTML table structure when HTML parsing inserts a tbody', () => {
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Before</p><table><tr><td>Cell</td></tr></table></body></html>'
    const live = new DOMParser().parseFromString(source, 'text/html')
    expect(live.querySelector('tbody')).not.toBeNull()
    live.querySelector('p')!.textContent = 'After'
    const saved = serializeVisibleBody(source, live.body)
    const parsed = new DOMParser().parseFromString(saved, 'application/xhtml+xml')
    expect(parsed.querySelector('tbody')).toBeNull()
    expect(parsed.querySelector('table > tr > td')?.textContent).toBe('Cell')
  })

  it('edits a table cell without saving the browser-inserted tbody', () => {
    const source = '<html xmlns="http://www.w3.org/1999/xhtml"><body><table><tr><td>Before</td></tr></table></body></html>'
    const live = new DOMParser().parseFromString(source, 'text/html')
    markEpubImplicitTableBodies(live, source)
    live.querySelector('td')!.textContent = 'After'
    const parsed = new DOMParser().parseFromString(serializeVisibleBody(source, live.body), 'application/xhtml+xml')
    expect(parsed.querySelector('tbody')).toBeNull()
    expect(parsed.querySelector('table > tr > td')?.textContent).toBe('After')
  })
})
