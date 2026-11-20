import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FoliateReader } from '../features/reader/renderers/FoliateReader'

const APP_STYLE_MARKER = '--bd-app-style'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function readerWithStyles(): { reader: FoliateReader; setStyles: ReturnType<typeof vi.fn> } {
  const reader = new FoliateReader('', '', undefined, 'txt')
  const setStyles = vi.fn()
  ;(reader as any).view = { renderer: Object.assign(document.createElement('div'), { setStyles }) }
  ;(reader as any).applyStyles()
  return { reader, setStyles }
}

function bareChapter(): Document {
  const doc = document.implementation.createHTMLDocument('chapter')
  doc.body.innerHTML = '<h1>Chapter</h1><p>Body text</p>'
  return doc
}

describe('reader stylesheet injection', () => {
  it('rejects an unapplied marker in a live document even when the CSS text contains it', () => {
    const { reader } = readerWithStyles()
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const doc = frame.contentDocument!
    const style = doc.createElement('style')
    style.textContent = `html { ${APP_STYLE_MARKER}: 1; }`
    doc.head.appendChild(style)
    const computed = vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '',
    } as unknown as CSSStyleDeclaration)
    try {
      expect((reader as any).documentHasAppStyles(doc)).toBe(false)
    } finally {
      computed.mockRestore()
      frame.remove()
    }
  })

  it('does not finish startup while the visible chapter lacks applied core styles', async () => {
    const { reader } = readerWithStyles()
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const doc = frame.contentDocument!
    ;(reader as any).view.renderer.getContents = () => [{ doc, index: 0 }]
    const computed = vi.spyOn(doc.defaultView!, 'getComputedStyle').mockReturnValue({
      getPropertyValue: () => '',
    } as unknown as CSSStyleDeclaration)
    try {
      await expect((reader as any).prepareVisibleContents()).rejects.toThrow('Reader styles are not ready')
    } finally {
      computed.mockRestore()
      frame.remove()
    }
  })

  it('prepares the final chapter and font settings when they change during startup', async () => {
    const { reader } = readerWithStyles()
    const first = bareChapter()
    const second = bareChapter()
    let doc = first
    ;(reader as any).view.renderer.getContents = () => [{ doc, index: 0 }]
    reader.applyFont({ ...(reader as any).font, overrideBookFont: true })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      if (doc === first) {
        doc = second
        reader.applyFont({ ...(reader as any).font, fontCss: '@font-face { font-family: Test; src: url("test.woff2"); }', overrideBookFont: true })
      }
      callback(0)
      return 1
    })

    const prepared = await (reader as any).prepareVisibleContents()
    expect(prepared.doc).toBe(second)
    expect(prepared.fontCss).toContain('@font-face')
    expect((reader as any).documentHasAppStyles(second)).toBe(true)
    expect(second.querySelector('style[data-bd-reader-fonts]')?.textContent).toBe(prepared.fontCss)
  })

  it('silently allows a font timeout only with the core reader settings already applied', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const { reader } = readerWithStyles()
    const doc = bareChapter()
    Object.defineProperty(doc, 'fonts', { value: { load: vi.fn() } })
    ;(reader as any).view.renderer.getContents = () => [{ doc, index: 0 }]
    reader.applyFont({ ...(reader as any).font, fontCss: '@import url("https://example.com/fonts.css");', overrideBookFont: true })
    const wait = (reader as any).prepareVisibleContents()
    await vi.advanceTimersByTimeAsync(8000)
    expect((await wait).doc).toBe(doc)
    expect((reader as any).documentHasAppStyles(doc)).toBe(true)
    expect(doc.querySelector('style[data-bd-app-style]')?.textContent).not.toContain('@import')
  })

  it('does not wait for book-owned fonts when override is disabled', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const { reader } = readerWithStyles()
    const doc = bareChapter()
    Object.defineProperty(doc, 'fonts', { value: { load: vi.fn(() => new Promise<FontFace[]>(() => {})) } })
    ;(reader as any).view.renderer.getContents = () => [{ doc, index: 0 }]
    reader.applyFont({ ...(reader as any).font, fontCss: '@import url("https://example.com/fonts.css");', overrideBookFont: false })
    const prepared = await (reader as any).prepareVisibleContents()

    expect(prepared.doc).toBe(doc)
    expect(doc.fonts.load).not.toHaveBeenCalled()
  })

  it('applies core settings while a separate font import is pending and retains the font node on layout changes', () => {
    const { reader, setStyles } = readerWithStyles()
    const doc = bareChapter()
    ;(reader as any).view.renderer.getContents = () => [{ doc, index: 0 }]
    reader.applyFont({ ...(reader as any).font, fontCss: '@import url("https://example.com/fonts.css");' })
    const fontStyle = doc.querySelector('style[data-bd-reader-fonts]') as HTMLStyleElement

    expect(fontStyle.dataset.loadState).toBe('loading')
    expect((reader as any).documentHasAppStyles(doc)).toBe(true)
    expect(String(setStyles.mock.lastCall?.[0])).not.toContain('@import')
    const originalText = fontStyle.textContent
    reader.applyParagraphStyle({ ...(reader as any).paragraph, paragraphSpacing: 2 })
    expect(doc.querySelector('style[data-bd-reader-fonts]')).toBe(fontStyle)
    expect(fontStyle.textContent).toBe(originalText)

    reader.applyFont({ ...(reader as any).font, fontCss: '@import url("https://example.com/other.css");' })
    const nextStyle = doc.querySelector('style[data-bd-reader-fonts]') as HTMLStyleElement
    expect(nextStyle).not.toBe(fontStyle)
    fontStyle.dispatchEvent(new Event('load'))
    expect(nextStyle.dataset.loadState).toBe('loading')
    nextStyle.dispatchEvent(new Event('load'))
    expect(nextStyle.dataset.loadState).toBe('loaded')
    reader.applyFont({ ...(reader as any).font, fontCss: '' })
    expect(doc.querySelector('style[data-bd-reader-fonts]')).toBeNull()
  })

  it('marks the injected stylesheet so a styled section can be recognized', () => {
    const { setStyles } = readerWithStyles()
    const css = String(setStyles.mock.calls[0]?.[0] ?? '')
    expect(css).toContain(`${APP_STYLE_MARKER}: 1;`)
  })

  it('styles a section document the paginator never wrote the sheet into', () => {
    const { reader } = readerWithStyles()
    const doc = bareChapter()

    expect((reader as any).documentHasAppStyles(doc)).toBe(false)
    expect((reader as any).ensureDocumentStyles(doc)).toBe(true)
    expect((reader as any).documentHasAppStyles(doc)).toBe(true)
    expect(doc.querySelectorAll('style[data-bd-app-style="repaired"]')).toHaveLength(1)
  })

  it('leaves an already styled section document untouched', () => {
    const { reader } = readerWithStyles()
    const doc = bareChapter()
    const injected = doc.createElement('style')
    injected.textContent = `html { ${APP_STYLE_MARKER}: 1; }`
    doc.head.appendChild(injected)

    expect((reader as any).ensureDocumentStyles(doc)).toBe(true)
    expect(doc.querySelectorAll('style[data-bd-app-style="repaired"]')).toHaveLength(0)
  })

  it('repairs a bare section while syncing the loaded documents', () => {
    const { reader } = readerWithStyles()
    const doc = bareChapter()
    ;(reader as any).view = {
      renderer: { getContents: () => [{ doc, index: 0 }] },
      getProgressOf: () => ({ tocItem: { label: 'Chapter' } }),
    }

    ;(reader as any).syncDoc()

    expect((reader as any).documentHasAppStyles(doc)).toBe(true)
  })

  it('keeps a repaired section in sync with later settings changes', () => {
    const { reader, setStyles } = readerWithStyles()
    const doc = bareChapter()
    ;(reader as any).ensureDocumentStyles(doc)
    const repaired = doc.querySelector('style[data-bd-app-style="repaired"]') as HTMLStyleElement
    const firstSheet = repaired.textContent

    ;(reader as any).theme = { bg: '#101010', text: '#f0f0f0', primary: '#f0f0f0' }
    ;(reader as any).applyStyles()

    expect(setStyles.mock.calls.length).toBeGreaterThan(1)
    expect(repaired.textContent).not.toBe(firstSheet)
    expect(repaired.textContent).toContain('#101010')
  })

  it('reports a view rebuild to the host so the reading area can be covered again', async () => {
    const reader = new FoliateReader('', '', undefined, 'txt')
    const events: boolean[] = []
    reader.on('viewRebuilding', (e: { pending: boolean }) => events.push(e.pending))
    const renderer = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      toggleAttribute: vi.fn(),
      getAttribute: vi.fn(() => null),
      setStyles: vi.fn(),
      getContents: vi.fn(() => []),
      style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    }
    ;(reader as any).view = {
      close: vi.fn(),
      open: vi.fn(async () => {}),
      renderer,
    }
    ;(reader as any).book = { sections: [] }
    ;(reader as any).conversion = 'off'
    ;(reader as any).display = vi.fn(async () => {})

    await (reader as any).reloadViewForConversion()

    expect(events).toEqual([true, false])
  })
})

describe('phase-5 theme font references', () => {
  function themeFontSheet(doc: Document): HTMLStyleElement | null {
    return doc.querySelector('style[data-bd-theme-fonts]')
  }

  function sources(faces: Record<string, string>, stacks: Record<string, string>) {
    return { stacks: new Map(Object.entries(stacks)), faces: new Map(Object.entries(faces)) }
  }

  it('rewrites the reference and injects the referenced faces into one sheet', () => {
    const { reader } = readerWithStyles()
    reader.applyFont({ fontFamily: 'serif', size: 18, lineHeight: 1.8, fontWeight: 400, overrideBookFont: true })
    const doc = bareChapter()
    ;(reader as any).activeDocs = new Set([doc])
    ;(reader as any).ensureDocumentStyles(doc)

    reader.applyUserContentCss(
      '[data-bd-chapter-title] { font-family: "bd-font:lxgw-wenkai", serif }',
      undefined,
      sources({ 'lxgw-wenkai': '@import url("https://cdn.example/lxgw.css");' }, { 'lxgw-wenkai': '"LXGW WenKai"' }),
    )

    const content = doc.querySelector('style[data-bd-user-theme-css="content"]')!
    expect(content.textContent).toContain('font-family: "LXGW WenKai", serif;')
    expect(content.textContent).toContain('--bd-theme-content-font-family: "LXGW WenKai", serif;')
    expect(doc.querySelector('style[data-bd-app-style="repaired"]')!.textContent)
      .toContain('font-family: var(--bd-theme-content-font-family,')
    expect(content.textContent).not.toContain('bd-font:lxgw-wenkai')
    expect(themeFontSheet(doc)!.textContent).toBe('@import url("https://cdn.example/lxgw.css");')
  })

  it('re-injects when a device face URL arrives although the CSS text is unchanged', () => {
    const { reader } = readerWithStyles()
    const doc = bareChapter()
    ;(reader as any).activeDocs = new Set([doc])
    ;(reader as any).ensureDocumentStyles(doc)
    const css = 'p { font-family: "bd-font:device-abc", serif }'
    const stacks = { 'device-abc': '"bd-font-device-abc"' }

    reader.applyUserContentCss(css, undefined, sources({}, {}))
    expect(themeFontSheet(doc)).toBeNull()

    reader.applyUserContentCss(css, undefined, sources({ 'device-abc': '@font-face { font-family: "bd-font-device-abc"; src: url("blob:http://localhost/font"); }' }, stacks))
    expect(themeFontSheet(doc)!.textContent).toContain('blob:http://localhost/font')
  })

  it('leaves an unresolvable reference as an unknown family and still injects the sheet', () => {
    const { reader } = readerWithStyles()
    const doc = bareChapter()
    ;(reader as any).activeDocs = new Set([doc])
    ;(reader as any).ensureDocumentStyles(doc)

    reader.applyUserContentCss('p { font-family: "bd-font:gone", serif }', undefined, sources({}, {}))

    expect(doc.querySelector('style[data-bd-user-theme-css="content"]')!.textContent).toContain('"bd-font:gone"')
    expect(themeFontSheet(doc)).toBeNull()
  })

  it('removes the faces with the stylesheet', () => {
    const { reader } = readerWithStyles()
    const doc = bareChapter()
    ;(reader as any).activeDocs = new Set([doc])
    ;(reader as any).ensureDocumentStyles(doc)
    const fontSources = sources({ 'lxgw-wenkai': '@import url("https://cdn.example/lxgw.css");' }, { 'lxgw-wenkai': '"LXGW WenKai"' })

    reader.applyUserContentCss('p { font-family: "bd-font:lxgw-wenkai" }', undefined, fontSources)
    expect(themeFontSheet(doc)).not.toBeNull()

    reader.applyUserContentCss('', undefined, fontSources)
    expect(themeFontSheet(doc)).toBeNull()
  })
})

describe('phase-2 user CSS injection', () => {
  function chapterWithReaderStyles(reader: FoliateReader): Document {
    const doc = bareChapter()
    ;(reader as any).ensureDocumentStyles(doc)
    return doc
  }

  function userSheet(doc: Document, kind: string): HTMLStyleElement | null {
    return doc.querySelector(`style[data-bd-user-theme-css="${kind}"]`)
  }

  it('injects the content sheet into section documents after the reader stylesheet', () => {
    const { reader } = readerWithStyles()
    const doc = chapterWithReaderStyles(reader)
    ;(reader as any).activeDocs = new Set([doc])

    reader.applyUserContentCss('p { text-indent: 2em }')

    const sheet = userSheet(doc, 'content')
    expect(sheet).not.toBeNull()
    expect(sheet!.textContent).toBe('p:where(body *) { text-indent: 2em; }')
    // always appended last, so user rules keep winning ties against the reader sheet
    expect(doc.head!.lastElementChild).toBe(sheet)
  })

  it('re-applies the stored sheets to newly loaded sections and keeps their order', () => {
    const { reader } = readerWithStyles()
    reader.applyUserContentCss('p { color: red }')
    reader.applyUserUiOutsideCss('[data-bd-ui="outside"] { border: 1px solid teal }')

    const doc = bareChapter()
    ;(reader as any).ensureDocumentStyles(doc)

    expect(userSheet(doc, 'content')!.textContent).toBe('p:where(body *) { color: red; }')
    expect(userSheet(doc, 'ui-outside')!.textContent).toBe('[data-bd-ui="outside"] { border: 1px solid teal; }')
    expect(doc.head!.lastElementChild).toBe(userSheet(doc, 'ui-outside'))
  })

  it('updates live decoration when a local image resolves and clears it on theme change', () => {
    const { reader } = readerWithStyles()
    const doc = chapterWithReaderStyles(reader)
    const renderer = (reader as any).view.renderer
    renderer.setOutsideDecoration = vi.fn()
    const css = '[data-bd-ui="outside"] { background-image: url("bd-asset:figure") }'
    reader.applyUserUiOutsideCss(css, () => null)
    expect(renderer.setOutsideDecoration).not.toHaveBeenCalled()
    reader.applyUserUiOutsideCss(css, () => 'blob:http://localhost/figure')
    expect(renderer.setOutsideDecoration).toHaveBeenLastCalledWith('#decoration { background-image: url("blob:http://localhost/figure"); }')
    expect(userSheet(doc, 'ui-outside')).toBeNull()
    reader.applyUserUiOutsideCss('')
    expect(renderer.setOutsideDecoration).toHaveBeenLastCalledWith('')
  })

  it('removes the sheets when the CSS is cleared (off, trial stop, restore follow)', () => {
    const { reader } = readerWithStyles()
    const doc = chapterWithReaderStyles(reader)
    reader.applyUserContentCss('p { color: red }')
    reader.applyUserUiOutsideCss('[data-bd-ui="outside"] { border: none }')

    reader.applyUserContentCss('')
    reader.applyUserUiOutsideCss('')

    expect(userSheet(doc, 'content')).toBeNull()
    expect(userSheet(doc, 'ui-outside')).toBeNull()
  })

  it('re-validates at the renderer boundary so a corrupted payload cannot inject', () => {
    const { reader } = readerWithStyles()
    const doc = chapterWithReaderStyles(reader)

    reader.applyUserContentCss('html { display: none } body { background: url(https://x.example/a.png) }')
    reader.applyUserUiOutsideCss('[data-bd-ui="header"] { color: red } [data-bd-ui="outside"] { color: red }')

    expect(userSheet(doc, 'content')).toBeNull()
    expect(userSheet(doc, 'ui-outside')).toBeNull()
  })

  it('never injects user sheets into fixed-layout documents', () => {
    const reader = new FoliateReader('', '', undefined, 'epub')
    ;(reader as any).view = { isFixedLayout: true, renderer: document.createElement('div') }
    const doc = bareChapter()

    reader.applyUserContentCss('p { color: red }')

    expect(userSheet(doc, 'content')).toBeNull()
  })

  it('exposes the unified chapter-title and outside targets on section documents', () => {
    const { reader } = readerWithStyles()
    const doc = bareChapter()
    ;(reader as any).view = {
      renderer: Object.assign(document.createElement('div'), { getContents: () => [{ doc, index: 0 }] }),
      getProgressOf: () => ({ tocItem: { label: 'Chapter' } }),
    }
    ;(reader as any).syncDoc()

    // TXT joins EPUB on the same [data-bd-chapter-title] target
    expect(doc.body.querySelector('h1')?.hasAttribute('data-bd-chapter-title')).toBe(true)
    // the section canvas carries the outside UI target
    expect(doc.documentElement.getAttribute('data-bd-ui')).toBe('outside')
  })

  it('styles chapter titles through the unified target for TXT', () => {
    const { setStyles } = readerWithStyles()
    const css = String(setStyles.mock.calls[0]?.[0] ?? '')
    expect(css).toContain('[data-bd-chapter-title] {')
    expect(css).not.toContain('body > h1:first-child')
  })
})
