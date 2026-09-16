import { describe, expect, it, vi } from 'vitest'

import {
  createZipEntryMap,
  FULL_DOWNLOAD_MAX_BYTES,
  FoliateReader,
  memoizeLoadBlob,
  memoizeLoadText,
  selectZipLoadStrategy,
  transformEpubStylesheet,
  transformEpubMarkup,
  normalizeEpubDocumentImages,
  buildAnnotationBuckets,
  cfiSpinePrefix,
  sectionSpinePrefix,
  convertTocLabels,
} from '../features/reader/renderers/FoliateReader'
import type { ReaderAnnotation } from '../features/reader/types'

function ann(cfiRange: string, type: ReaderAnnotation['type'] = 'highlight'): ReaderAnnotation {
  return { cfiRange, type, color: 'yellow', style: 'underline', note: null }
}

describe('cfiSpinePrefix / sectionSpinePrefix', () => {
  it('extracts the spine part of a standard EPUB CFI', () => {
    expect(cfiSpinePrefix('epubcfi(/6/24!/4/2:58)')).toBe('/6/24')
  })

  it('returns null for non-EPUB cfis', () => {
    expect(cfiSpinePrefix('txt:/42/100')).toBeNull()
    expect(cfiSpinePrefix('chapter:3:0.5')).toBeNull()
  })

  it('maps a section index to its expected spine prefix', () => {
    expect(sectionSpinePrefix(0)).toBe('/6/2')
    expect(sectionSpinePrefix(11)).toBe('/6/24')
  })
})

describe('buildAnnotationBuckets', () => {
  it('groups annotations by spine prefix, keeping the cfi|type value', () => {
    const { buckets, uncategorized } = buildAnnotationBuckets([
      ann('epubcfi(/6/2!/4/2:0)'),
      ann('epubcfi(/6/2!/4/5:1)', 'note'),
      ann('epubcfi(/6/4!/4/1:3)'),
    ])
    expect(buckets.get('/6/2')).toEqual(new Set(['epubcfi(/6/2!/4/2:0)|highlight', 'epubcfi(/6/2!/4/5:1)|note']))
    expect(buckets.get('/6/4')).toEqual(new Set(['epubcfi(/6/4!/4/1:3)|highlight']))
    expect(uncategorized.size).toBe(0)
  })

  it('sends non-EPUB cfis to the uncategorized fallback set', () => {
    const { buckets, uncategorized } = buildAnnotationBuckets([ann('txt:/12/30')])
    expect(buckets.size).toBe(0)
    expect(uncategorized).toEqual(new Set(['txt:/12/30|highlight']))
  })
})

describe('selectZipLoadStrategy', () => {
  it('downloads whole books at or below the threshold', () => {
    expect(selectZipLoadStrategy(1)).toBe('full')
    expect(selectZipLoadStrategy(FULL_DOWNLOAD_MAX_BYTES)).toBe('full')
  })

  it('keeps Range loading above the threshold', () => {
    expect(selectZipLoadStrategy(FULL_DOWNLOAD_MAX_BYTES + 1)).toBe('range')
  })

  it('defaults to Range when the size is unknown', () => {
    expect(selectZipLoadStrategy(null)).toBe('range')
  })
})

describe('createZipEntryMap', () => {
  it('resolves normalized, encoded, and case-mismatched EPUB paths', () => {
    const chapter = { filename: 'OPS/Text/Chapter 1.xhtml' }
    const entries = createZipEntryMap([chapter])

    expect(entries.get('OPS/Text/Chapter%201.xhtml')).toBe(chapter)
    expect(entries.get('ops/text/chapter 1.xhtml')).toBe(chapter)
    expect(entries.get('OPS/Text/./Chapter%201.xhtml')).toBe(chapter)
  })

  it('does not guess when case-insensitive paths are ambiguous', () => {
    const upper = { filename: 'OPS/Text/Chapter.xhtml' }
    const lower = { filename: 'OPS/Text/chapter.xhtml' }
    const entries = createZipEntryMap([upper, lower])

    expect(entries.get('OPS/Text/Chapter.xhtml')).toBe(upper)
    expect(entries.get('ops/text/CHAPTER.xhtml')).toBeUndefined()
  })
})

describe('transformEpubStylesheet', () => {
  it('clips oversized and nowrap book rules without touching safe rules', () => {
    const css = `
      body { width: 1400px; white-space: nowrap; }
      .page { page-break-after: always; }
      .bleed { duokan-bleed: left right; }
      .title { font-size: 24px; }
      .note { font-size: 12pt; }
      .small { font-size: small; }
      .generic { font-family: serif; color: black; user-select: none; }
      .sans { font-family: sans-serif; }
      .safe { width: 800px; }
      @font-face { font-family: Reader; src: url(font.woff2); }
    `

    const transformed = transformEpubStylesheet(css, 900)

    expect(transformed).toContain('width: 100%; max-width: var(--bd-available-width, 100%); box-sizing: border-box;')
    expect(transformed).toContain('overflow: clip !important;')
    expect(transformed).toContain('margin-bottom: var(--bd-page-break-margin, 100vh);')
    expect(transformed).toContain('margin-left: calc(-1 * var(--bd-page-margin-left, 0px)) !important;')
    expect(transformed).toContain('margin-right: calc(-1 * var(--bd-page-margin-right, 0px)) !important;')
    expect(transformed).toContain('.title { font-size: max(1.5rem, var(--bd-min-font-size, 8px)); }')
    expect(transformed).toContain('.note { font-size: max(1rem, var(--bd-min-font-size, 8px)); }')
    expect(transformed).toContain('.small { font-size: max(0.875rem, var(--bd-min-font-size, 8px)); }')
    expect(transformed).toContain('font-family: var(--bd-serif, serif); color: var(--bd-theme-text, black); user-select: unset;')
    expect(transformed).toContain('font-family: var(--bd-sans-serif, sans-serif);')
    expect(transformed).toContain('.safe { width: 800px; }')
    expect(transformed).toContain('@font-face { font-family: Reader; src: url(font.woff2); }')
  })

  it('transforms nested media rules without corrupting the at-rule', () => {
    const transformed = transformEpubStylesheet('@media (max-width: 900px) { .wide { width: 1200px; } }', 900)

    expect(transformed).toContain('@media (max-width: 900px) { .wide { width: 1200px; width: 100%;')
    expect(transformed).not.toContain('@media (max-width: 900px) .wide')
  })

  it('converts viewport units using the iframe viewport', () => {
    const transformed = transformEpubStylesheet('.hero { width: 100vw; min-height: 50vh; }', 800, 600)

    expect(transformed).toContain('width: 800px;')
    expect(transformed).toContain('min-height: 300px;')
  })

  it('removes EPUB vendor prefixes after stylesheet resolution', () => {
    const transformed = transformEpubStylesheet('p { -epub-hyphens: auto; -epub-text-emphasis: dot; }', 900)

    expect(transformed).not.toContain('-epub-')
    expect(transformed).toContain('hyphens: auto;')
    expect(transformed).toContain('text-emphasis: dot;')
    expect(transformEpubStylesheet('-epub-hyphens: auto;', 900)).toBe('hyphens: auto;')
 })

  it('rewrites light backgrounds and keeps the minimum font size after unit conversion', () => {
    const transformed = transformEpubStylesheet('.callout { background-color: #f5f5f5; font-size: 6px; }', 900)

    expect(transformed).toContain('background-color: var(--bd-theme-bg, #f5f5f5);')
    expect(transformed).toContain('font-size: max(0.375rem, var(--bd-min-font-size, 8px));')
  })

  it('still clips nowrap when the viewport width is unknown', () => {
    const css = 'body { width: 1400px; white-space: nowrap; }'

    expect(transformEpubStylesheet(css, 0)).toContain('overflow: clip !important;')
    expect(transformEpubStylesheet(css, 0)).not.toContain('max-width: 100%;')
  })

  it('transforms inline declaration styles', () => {
    const transformed = transformEpubStylesheet('white-space: nowrap; page-break-after: always;', 900)

    expect(transformed).toContain('overflow: clip !important;')
    expect(transformed).toContain('margin-bottom: var(--bd-page-break-margin, 100vh);')
  })

  it('transforms inline style attributes in chapter markup', () => {
    const transformed = transformEpubMarkup('<p style="white-space: nowrap; font-size: 24px">正文</p>', 900)

    expect(transformed).toContain('overflow: clip !important;')
    expect(transformed).toContain('font-size: max(1.5rem, var(--bd-min-font-size, 8px));')
  })
})

describe('FoliateReader book-style overrides', () => {
  it('emits the viewport-start coordinate used by progress seeking', () => {
    const reader = new FoliateReader('')
    const onRelocated = vi.fn()
    reader.on('relocated', onRelocated)

    ;(reader as any).handleRelocate({
      cfi: 'epubcfi(/6/2!/4/2)',
      fraction: 0.6,
      startFraction: 0.4,
      section: { current: 0, total: 1 },
      tocItem: { label: '第一章' },
      chapterLocation: { current: 1, total: 10 },
    })

    expect(onRelocated).toHaveBeenCalledWith(expect.objectContaining({
      anchorCfi: 'epubcfi(/6/2!/4/2)',
      fraction: 0.4,
      percent: 40,
    }))
  })

  it('emits a collapsed content anchor at the visible range start', () => {
    const reader = new FoliateReader('')
    const onRelocated = vi.fn()
    const collapse = vi.fn()
    const getCFI = vi.fn(() => 'epubcfi(/6/2!/4/2:17)')
    reader.on('relocated', onRelocated)
    ;(reader as any).view = { getCFI, renderer: undefined }

    ;(reader as any).handleRelocate({
      cfi: 'epubcfi(/6/2!/4/2:17,/4/4:42)',
      range: { cloneRange: () => ({ collapse }) },
      section: { current: 0, total: 1 },
      fraction: 0.4,
    })

    expect(collapse).toHaveBeenCalledWith(true)
    expect(getCFI).toHaveBeenCalledWith(0, expect.any(Object))
    expect(onRelocated).toHaveBeenCalledWith(expect.objectContaining({
      anchorCfi: 'epubcfi(/6/2!/4/2:17)',
    }))
  })

  it('starts a fallback bookmark snippet at the visible range start', () => {
    const reader = new FoliateReader('')
    const doc = document.implementation.createHTMLDocument()
    const paragraph = doc.createElement('p')
    paragraph.textContent = '视口上方的文字视口开始的文字以及后续内容'
    doc.body.append(paragraph)
    const text = paragraph.firstChild
    if (!text) throw new Error('test paragraph has no text node')
    const range = doc.createRange()
    range.setStart(text, 7)
    range.setEnd(text, text.textContent?.length ?? 0)
    ;(reader as any).lastRange = range

    expect(reader.getSnippet('chapter:0:0.5', 80)).toBe('视口开始的文字以及后续内容')
  })

  it('sets line-height directly on paragraphs when layout override is enabled', () => {
    const reader = new FoliateReader('')
    const setStyles = vi.fn()
    ;(reader as any).view = { renderer: { setStyles } }
    ;(reader as any).font = { ...(reader as any).font, lineHeight: 1.9, overrideBookFont: true }
    ;(reader as any).paragraph = { ...(reader as any).paragraph, overrideBookLayout: true }
    ;(reader as any).theme = { bg: '#202020', text: '#f8f8f8' }

    ;(reader as any).applyStyles()

    const css = String(setStyles.mock.calls[0]?.[0] ?? '')
    expect(css).toContain('p {')
    expect(css).toContain('line-height: 1.9 !important;')
    expect(css).toContain('body *:not(pre, code, kbd, .code):not(pre *, code *, kbd *, .code *)')
    expect(css).toContain('max-width: 100% !important;')
    expect(css).toContain('.duokan-image-gallery-cell')
    expect(css).toContain('p[width][height] > img:only-child')
    expect(css).toContain('.h5_mainbody')
    expect(css).toContain('hanging-punctuation: allow-end last;')
    expect(css).toContain('widows: 2;')
    expect(css).toContain(':lang(zh), :lang(ja), :lang(ko)')
    expect(css).toContain('div.left *, p.left *')
    expect(css).toContain(':is(hgroup, header) p')
    expect(css).toContain('p > font:only-child')
    expect(css).toContain('.nonindent, .noindent')
    expect(css).toContain('a::before')
    expect(css).toContain('.duokan-footnote img:not([class])')
    expect(css).toContain('figure.code')
    expect(css).toContain('mix-blend-mode: multiply;')
    expect(css).toContain('-webkit-hyphenate-limit-before: 3;')
    expect(css).toContain('a:any-link')
    expect(css).toContain('.vertical-writing img.pi')
    expect(css).toContain('body.paginated-mode td:has(img)')
    expect(css).toContain('color-mix(in srgb, var(--bd-theme-bg) 80%, #000)')
    expect(css).toContain('#pg-header *')
    expect(css).toContain('-webkit-touch-callout: none;')
  })

  it('keeps reader paragraph controls when book-style overrides are disabled', () => {
    const reader = new FoliateReader('')
    const setStyles = vi.fn()
    ;(reader as any).view = { renderer: { setStyles } }
    ;(reader as any).font = { ...(reader as any).font, overrideBookFont: false }
    ;(reader as any).paragraph = { ...(reader as any).paragraph, overrideBookLayout: false }

    ;(reader as any).applyStyles()

    const css = String(setStyles.mock.calls[0]?.[0] ?? '')
    expect(css).not.toContain('font-family: serif !important;')
    expect(css).toContain('line-height: 1.8 !important;')
    expect(css).toContain('text-indent: 2em !important;')
    expect(css).toContain('margin-bottom: 0.5em !important;')
    expect(css).not.toContain('body *:not(pre, code, kbd)')
  })

  it('uses the reader font as a fallback when the book does not declare a font', () => {
    const reader = new FoliateReader('')
    const setStyles = vi.fn()
    ;(reader as any).view = { renderer: { setStyles } }
    ;(reader as any).font = { ...(reader as any).font, overrideBookFont: false, fontStack: 'Test Font' }

    ;(reader as any).applyStyles()

    const css = String(setStyles.mock.calls[0]?.[0] ?? '')
    expect(css).toContain('html {\n        font-family: Test Font;\n      }')
    expect(css).not.toContain('font-family: Test Font !important;')
    expect(css).not.toContain('body *:not(pre, code, kbd, .code)')
  })

  it('maps each spine section to the label selected by Foliate TOC progress', () => {
    const reader = new FoliateReader('')
    ;(reader as any).book = { sections: [{}, {}] }
    ;(reader as any).view = {
      getProgressOf: (index: number) => ({ tocItem: { label: index === 0 ? '序章' : '第一章' } }),
    }

    expect(reader.getSectionTocLabels()).toEqual(['序章', '第一章'])
  })

  it('places imported reader fonts before ordinary stylesheet rules', () => {
    const reader = new FoliateReader('')
    const setStyles = vi.fn()
    ;(reader as any).view = { renderer: { setStyles } }
    ;(reader as any).font = { ...(reader as any).font, fontCss: '@import url("reader.css");' }

    ;(reader as any).applyStyles()

    const css = String(setStyles.mock.calls[0]?.[0] ?? '')
    expect(css.indexOf('@import url("reader.css");')).toBeLessThan(css.indexOf('--bd-font-size'))
  })

  it('applies the reading theme to fixed-layout HTML documents', () => {
    const reader = new FoliateReader('')
    const doc = document.implementation.createHTMLDocument('fixed')
    doc.body.innerHTML = '<img src="page.png">'
    ;(reader as any).view = { isFixedLayout: true }
    ;(reader as any).theme = { bg: '#202020', text: '#f8f8f8' }

    ;(reader as any).applyFixedLayoutDocumentStyles(doc)

    expect(doc.documentElement.style.getPropertyValue('background-color')).toBe('rgb(32, 32, 32)')
    expect(doc.body.style.getPropertyValue('background-color')).toBe('rgb(32, 32, 32)')
    expect(doc.body.style.position).toBe('relative')
  })
})

describe('FoliateReader auto-scroll boundary', () => {
  it('turns to the next section when a snap-mode scroll is clamped at chapter end', async () => {
    const reader = new FoliateReader('')
    let position = 900
    const next = vi.fn(async () => undefined)
    const renderer = {
      scrollProp: 'scrollTop',
      get containerPosition() { return position },
      set containerPosition(value: number) { position = Math.min(900, value) },
      hasAttribute: (name: string) => name === 'snap-turn',
      start: 900,
      size: 100,
      viewSize: 1000,
      atEnd: false,
      atStart: false,
      next,
      prev: vi.fn(),
    }
    ;(reader as any).view = { renderer }
    ;(reader as any).readingMode = 'scroll'

    await reader.scrollByPixels(40)

    expect(next).toHaveBeenCalledWith(0)
  })

  it('does not cross a chapter boundary in closed scroll mode', async () => {
    const reader = new FoliateReader('')
    let position = 900
    const next = vi.fn(async () => undefined)
    const renderer = {
      scrollProp: 'scrollTop',
      get containerPosition() { return position },
      set containerPosition(value: number) { position = Math.min(900, value) },
      hasAttribute: () => false,
      start: 900,
      size: 100,
      viewSize: 1000,
      atEnd: false,
      atStart: false,
      next,
      prev: vi.fn(),
    }
    ;(reader as any).view = { renderer }
    ;(reader as any).readingMode = 'scroll'

    await expect(reader.scrollByPixels(40)).resolves.toBe(false)

    expect(next).not.toHaveBeenCalled()
  })

  it('keeps snap-turn enabled while smooth auto reading owns the scroll loop', () => {
    const reader = new FoliateReader('')
    const renderer = {
      hasAttribute: (name: string) => name === 'snap-turn',
      removeAttribute: vi.fn(),
      setAttribute: vi.fn(),
    }
    ;(reader as any).view = { renderer }
    ;(reader as any).readingMode = 'scroll'
    ;(reader as any).continuousScroll = 'snap'

    reader.setAutoReadingActive(true)

    expect(renderer.removeAttribute).not.toHaveBeenCalledWith('snap-turn')
    reader.setAutoReadingActive(false)
    expect(renderer.setAttribute).toHaveBeenCalledWith('snap-turn', '')
  })
})

describe('normalizeEpubDocumentImages', () => {
  it('normalizes percentage dimensions and marks inline images', () => {
    document.body.innerHTML = '<p>前<img src="icon.png" width="25%" height="10vh">后</p>'
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })

    normalizeEpubDocumentImages(document)

    const image = document.querySelector('img') as HTMLImageElement
    expect(image.style.width).toBe('200px')
    expect(image.style.height).toBe('60px')
    expect(image.getAttribute('width')).toBeNull()
    expect(image.getAttribute('height')).toBeNull()
    expect(image.classList.contains('has-text-siblings')).toBe(true)
    expect(image.classList.contains('has-text-siblings-baseline')).toBe(true)
  })

  it('marks horizontal rules with a background image without touching plain rules', () => {
    document.body.innerHTML = '<hr id="image" style="background-image: url(rule.png)"><hr id="plain">'

    normalizeEpubDocumentImages(document)

    expect(document.querySelector('#image')?.classList.contains('background-img')).toBe(true)
    expect(document.querySelector('#plain')?.classList.contains('background-img')).toBe(false)
  })

  it('marks inline images in vertical writing mode for width-based sizing', () => {
    document.body.innerHTML = '<p>前<img src="icon.png">后</p>'
    document.body.style.writingMode = 'vertical-rl'

    normalizeEpubDocumentImages(document)

    expect(document.querySelector('img')?.classList.contains('has-text-siblings-vertical')).toBe(true)
    expect(document.documentElement.classList.contains('vertical-writing')).toBe(true)
  })

  it('accepts fixed-layout SVG documents without a body element', () => {
    const svg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><image href="cover.png"/></svg>', 'image/svg+xml')

    expect(() => normalizeEpubDocumentImages(svg)).not.toThrow()
  })
})

describe('memoizeLoadText', () => {
  it('dedupes concurrent loads of the same href', async () => {
    let calls = 0
    const loadText = memoizeLoadText(async (name: string) => {
      calls++
      return `text:${name}`
    })
    const [a, b] = await Promise.all([loadText('a.xhtml'), loadText('a.xhtml')])
    expect(a).toBe('text:a.xhtml')
    expect(b).toBe('text:a.xhtml')
    expect(calls).toBe(1)
  })

  it('serves repeated loads from the memo without re-invoking the source', async () => {
    let calls = 0
    const loadText = memoizeLoadText(async (name: string) => {
      calls++
      return `text:${name}`
    })
    await loadText('a.xhtml')
    await loadText('a.xhtml')
    expect(calls).toBe(1)
    expect(await loadText('b.xhtml')).toBe('text:b.xhtml')
    expect(calls).toBe(2)
  })

  it('evicts the least recently used href beyond 20 entries', async () => {
    const calls = new Map<string, number>()
    const loadText = memoizeLoadText(async (name: string) => {
      calls.set(name, (calls.get(name) ?? 0) + 1)
      return name
    })
    for (let i = 0; i < 20; i++) await loadText(`s${i}`)
    // touch s0 so it becomes most recently used
    await loadText('s0')
    // insert a 21st entry — evicts s1 (now the oldest), not s0
    await loadText('s20')
    await loadText('s0')
    await loadText('s1')
    expect(calls.get('s0')).toBe(1)
    expect(calls.get('s1')).toBe(2)
  })

  it('evicts rejected loads so the next request retries', async () => {
    let calls = 0
    const loadText = memoizeLoadText(async (_name: string) => {
      calls++
      if (calls === 1) throw new Error('boom')
      return 'ok'
    })
    await expect(loadText('a.xhtml')).rejects.toThrow('boom')
    expect(await loadText('a.xhtml')).toBe('ok')
    expect(calls).toBe(2)
  })

  it('passes through null for missing entries', async () => {
    const loadText = memoizeLoadText((_name: string) => null)
    expect(await loadText('missing.xhtml')).toBeNull()
  })

  it('has() reports warmth only after successful resolution', async () => {
    const loadText = memoizeLoadText(async (name: string) => {
      if (name === 'fail.xhtml') throw new Error('boom')
      return name
    })
    expect(loadText.has('a.xhtml')).toBe(false)
    await loadText('a.xhtml')
    expect(loadText.has('a.xhtml')).toBe(true)
    await expect(loadText('fail.xhtml')).rejects.toThrow('boom')
    expect(loadText.has('fail.xhtml')).toBe(false)
  })

  it('does not report an in-flight or missing load as warm', async () => {
    let resolveText!: (value: string) => void
    const pending = new Promise<string>((resolve) => { resolveText = resolve })
    const loadText = memoizeLoadText(() => pending)
    const request = loadText('pending.xhtml')

    expect(loadText.has('pending.xhtml')).toBe(false)
    resolveText('ready')
    await request
    expect(loadText.has('pending.xhtml')).toBe(true)

    const missing = memoizeLoadText(() => null)
    await expect(missing('missing.xhtml')).resolves.toBeNull()
    expect(missing.has('missing.xhtml')).toBe(false)
  })
})

describe('memoizeLoadBlob', () => {
  it('dedupes concurrent resource loads and serves later reads from the cache', async () => {
    let calls = 0
    const loadBlob = memoizeLoadBlob('book-v1', async (name: string) => {
      calls++
      return new Blob([`blob:${name}`])
    })

    const [a, b] = await Promise.all([loadBlob('image.jpg'), loadBlob('image.jpg')])
    expect(await a?.text()).toBe('blob:image.jpg')
    expect(await b?.text()).toBe('blob:image.jpg')
    expect(calls).toBe(1)
    await loadBlob('image.jpg')
    expect(calls).toBe(1)
  })
})

describe('convertTocLabels', () => {
  it('converts nested TOC labels from the original text', async () => {
    const source = [{
      label: '第一章 內容',
      href: 'chapter-1.xhtml',
      subitems: [{ label: '閱讀設定', href: 'chapter-1.xhtml#settings' }],
    }]

    const simplified = await convertTocLabels(source, 'simplified')
    expect(simplified).toEqual([{
      label: '第一章 内容',
      href: 'chapter-1.xhtml',
      subitems: [{ label: '阅读设定', href: 'chapter-1.xhtml#settings' }],
    }])
    expect(source[0]?.label).toBe('第一章 內容')
    expect(source[0]?.subitems?.[0]?.label).toBe('閱讀設定')

    const traditional = await convertTocLabels(source, 'traditional')
    expect(traditional[0]?.label).toBe('第一章 內容')
    expect(traditional[0]?.subitems?.[0]?.label).toBe('閱讀設定')
  })
})
