import { describe, expect, it, vi } from 'vitest'

import { FoliateReader, keepEpubTextAlignment } from '../features/reader/renderers/FoliateReader'

function appliedReaderStyles(configure?: (reader: FoliateReader) => void, format: 'epub' | 'txt' = 'epub'): string {
  const reader = new FoliateReader('', '', undefined, format)
  const setStyles = vi.fn()
  ;(reader as any).view = { renderer: { setStyles } }
  configure?.(reader)
  ;(reader as any).applyStyles()
  return String(setStyles.mock.calls[0]?.[0] ?? '')
}

function computedStyleWithReaderCss(
  bookCss: string,
  markup: string,
  readerCss: string,
  beforeReaderCss?: (doc: Document) => void,
): Pick<CSSStyleDeclaration, 'fontFamily' | 'textAlign'> {
  const doc = document
  const host = doc.createElement('div')
  host.hidden = true
  const bookStyle = doc.createElement('style')
  bookStyle.textContent = bookCss
  const readerStyle = doc.createElement('style')
  readerStyle.textContent = readerCss
  host.innerHTML = markup
  doc.head.append(bookStyle)
  doc.body.append(host)
  beforeReaderCss?.(doc)
  doc.head.append(readerStyle)
  const element = host.firstElementChild
  if (!element) throw new Error('test markup has no element')
  const computed = getComputedStyle(element)
  const result = { fontFamily: computed.fontFamily, textAlign: computed.textAlign }
  readerStyle.remove()
  bookStyle.remove()
  host.remove()
  return result
}

describe('FoliateReader computed-style cascade compatibility', () => {
  it('lets an EPUB html font declaration win when font override is disabled', () => {
    const css = appliedReaderStyles((reader) => {
      ;(reader as any).font = {
        ...(reader as any).font,
        fontStack: '"Bookdock Font", sans-serif',
        overrideBookFont: false,
      }
    })

    const style = computedStyleWithReaderCss(
      'html { font-family: "EPUB Font", serif; }',
      '<p>正文</p>',
      css,
    )

    expect(style.fontFamily).toContain('EPUB Font')
  })

  it('lets an EPUB pre font declaration win when font override is disabled', () => {
    const css = appliedReaderStyles((reader) => {
      ;(reader as any).font = {
        ...(reader as any).font,
        fontStack: '"Bookdock Font", sans-serif',
        overrideBookFont: false,
      }
    })

    const style = computedStyleWithReaderCss(
      'pre { font-family: "EPUB Code Font", monospace; }',
      '<pre>code</pre>',
      css,
    )

    expect(style.fontFamily).toContain('EPUB Code Font')
  })

  it('raises the reader font and code rules only when explicit overrides are enabled', () => {
    const css = appliedReaderStyles((reader) => {
      ;(reader as any).font = {
        ...(reader as any).font,
        fontStack: '"Bookdock Font", sans-serif',
        overrideBookFont: true,
      }
    })

    expect(css).toContain('html body {\n        font-family: "Bookdock Font", sans-serif !important;')
    expect(css).toContain('html body :is(pre, code, kbd) {')
    expect(css).toContain('font-family: var(--bd-monospace, ui-monospace, SFMono-Regular, Consolas, monospace) !important;')
    expect(css).not.toContain(':where(pre, code, kbd) {')
  })

  it('normalizes body-copy font sizes only when font override is enabled', () => {
    const disabledCss = appliedReaderStyles()
    const enabledCss = appliedReaderStyles((reader) => {
      ;(reader as any).font = {
        ...(reader as any).font,
        overrideBookFont: true,
      }
    })

    expect(disabledCss).not.toContain('p, li, div, pre, dd {\n        font-size: max(1rem, var(--bd-min-font-size, 8px)) !important;')
    expect(enabledCss).toContain('p, li, div, pre, dd {\n        font-size: max(1rem, var(--bd-min-font-size, 8px)) !important;')
  })

  it('preserves an authored centered paragraph when layout override is enabled', () => {
    const css = appliedReaderStyles((reader) => {
      ;(reader as any).paragraph = {
        ...(reader as any).paragraph,
        overrideBookLayout: true,
        textAlignJustify: false,
      }
    })

    const style = computedStyleWithReaderCss(
      '.chapter-title { text-align: center; }',
      '<p class="chapter-title">章节标题</p>',
      css,
      keepEpubTextAlignment,
    )

    expect(style.textAlign).toBe('center')
  })

  it('always applies the reader layout to TXT books', () => {
    const css = appliedReaderStyles((reader) => {
      ;(reader as any).paragraph = {
        ...(reader as any).paragraph,
        overrideBookLayout: false,
      }
    }, 'txt')

    expect(css).toContain('line-height: 1.8 !important;')
    expect(css).toContain('text-indent: 2em !important;')
    expect(css).toContain('margin-bottom: 0.5em !important;')
    expect(css).toContain('body > h1:first-child {')
    expect(css).toContain('padding-top: 1.5rem !important;')
    expect(css).toContain('margin-bottom: 2.25rem !important;')
  })

  it('applies title controls to identified EPUB headings only under layout override', () => {
    const bookCss = appliedReaderStyles()
    expect(bookCss).not.toContain('[data-bd-chapter-title] {')

    const css = appliedReaderStyles((reader) => {
      ;(reader as any).paragraph = {
        ...(reader as any).paragraph,
        overrideBookLayout: true,
        chapterTitleAlign: 'end',
        chapterTitleSize: 1.8,
        chapterTitleTopSpacing: 2,
        chapterTitleBottomSpacing: 1,
      }
    })
    expect(css).toContain('[data-bd-chapter-title] {')
    expect(css).toContain('text-align: end !important;')
    expect(css).toContain('font-size: 1.8rem !important;')
    expect(css).toContain('padding-top: 2rem !important;')
    expect(css).toContain('margin-bottom: 1rem !important;')
  })

  it('identifies only an EPUB heading that matches the section TOC title', () => {
    const reader = new FoliateReader('', '', undefined, 'epub')
    const doc = document.implementation.createHTMLDocument('chapter')
    doc.body.innerHTML = '<h2>Chapter One</h2><p>Body text</p><h2>Other heading</h2>'
    ;(reader as any).view = {
      renderer: { getContents: () => [{ doc, index: 0 }] },
      getProgressOf: () => ({ tocItem: { label: 'Chapter One' } }),
    }
    ;(reader as any).syncDoc()
    expect(doc.querySelector('h2')?.hasAttribute('data-bd-chapter-title')).toBe(true)
    expect(doc.querySelectorAll('[data-bd-chapter-title]')).toHaveLength(1)
  })
})
