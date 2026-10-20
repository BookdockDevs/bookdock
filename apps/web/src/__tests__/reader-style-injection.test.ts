import { afterEach, describe, expect, it, vi } from 'vitest'

import { FoliateReader } from '../features/reader/renderers/FoliateReader'

const APP_STYLE_MARKER = '--bd-app-style'

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
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      if (doc === first) {
        doc = second
        reader.applyFont({ ...(reader as any).font, fontCss: '@font-face { font-family: Test; src: url("test.woff2"); }' })
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

  it('allows a font timeout only with the core reader settings already applied', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const { reader } = readerWithStyles()
    const doc = bareChapter()
    Object.defineProperty(doc, 'fonts', { value: { load: vi.fn() } })
    ;(reader as any).view.renderer.getContents = () => [{ doc, index: 0 }]
    reader.applyFont({ ...(reader as any).font, fontCss: '@import url("https://example.com/fonts.css");' })
    const fallback = vi.fn()
    reader.on('fontFallback', fallback)

    const wait = (reader as any).prepareVisibleContents()
    await vi.advanceTimersByTimeAsync(8000)
    expect((await wait).doc).toBe(doc)
    expect(fallback).toHaveBeenCalledOnce()
    expect((reader as any).documentHasAppStyles(doc)).toBe(true)
    expect(doc.querySelector('style[data-bd-app-style]')?.textContent).not.toContain('@import')
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
      style: { setProperty: vi.fn() },
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
