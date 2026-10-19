import { describe, expect, it, vi } from 'vitest'

import { FoliateReader } from '../features/reader/renderers/FoliateReader'

const APP_STYLE_MARKER = '--bd-app-style'

function readerWithStyles(): { reader: FoliateReader; setStyles: ReturnType<typeof vi.fn> } {
  const reader = new FoliateReader('', '', undefined, 'txt')
  const setStyles = vi.fn()
  ;(reader as any).view = { renderer: { setStyles } }
  ;(reader as any).applyStyles()
  return { reader, setStyles }
}

function bareChapter(): Document {
  const doc = document.implementation.createHTMLDocument('chapter')
  doc.body.innerHTML = '<h1>Chapter</h1><p>Body text</p>'
  return doc
}

describe('reader stylesheet injection', () => {
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
