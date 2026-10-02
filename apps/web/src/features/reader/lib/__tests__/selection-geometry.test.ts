import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSelectionGeometry } from '../selection-geometry'

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren() })

function setup(backward = false, scale = 1) {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const doc = frame.contentDocument!
  doc.body.textContent = 'selected text'
  const text = doc.body.firstChild!
  const range = doc.createRange()
  range.selectNodeContents(text)
  const selection = doc.getSelection()!
  selection.setBaseAndExtent(text, backward ? 13 : 0, text, backward ? 0 : 13)
  Object.defineProperties(frame, { offsetWidth: { value: 800 }, offsetHeight: { value: 800 } })
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, -100, 800 * scale, 800 * scale))
  Object.defineProperty(range, 'getClientRects', { value: () => [
    new DOMRect(10, 20, 100, 20),
    new DOMRect(10, 110, 100, 40),
    new DOMRect(30, 260, 100, 20),
    new DOMRect(900, 300, 100, 20),
  ] })
  Object.defineProperty(doc.defaultView!.Range.prototype, 'getClientRects', { configurable: true, value: () => [] })
  return { doc, range, selection }
}

describe('visible selection geometry', () => {
  it('clips fragments on all edges and discards offscreen pages', () => {
    const { doc, range, selection } = setup()
    const geometry = getSelectionGeometry(doc, range, selection, { left: 200, top: 30, width: 800, height: 140 })!
    expect(geometry.rects).toEqual([
      { left: 210, top: 30, width: 100, height: 20 },
      { left: 230, top: 160, width: 100, height: 10 },
    ])
    expect(geometry.backward).toBe(false)
    expect(geometry.focusX).toBe(330)
  })

  it('transforms fragments before testing their visibility', () => {
    const { doc, range, selection } = setup(false, 0.5)
    const geometry = getSelectionGeometry(doc, range, selection, { left: 200, top: 0, width: 400, height: 200 })!
    expect(geometry.rects).toEqual([
      { left: 215, top: 30, width: 50, height: 10 },
    ])
    expect(geometry.focusX).toBe(265)
  })

  it('allows popup placement in reading margins outside the chapter iframe', () => {
    const { doc, range, selection } = setup(false, 0.5)
    const geometry = getSelectionGeometry(doc, range, selection, { left: 100, top: 0, width: 800, height: 500 })!
    expect(geometry.bounds).toEqual({ left: 100, top: 0, width: 800, height: 500 })
    expect(geometry.rects.every(rect => rect.left >= 200 && rect.left + rect.width <= 600)).toBe(true)
  })

  it('keeps the first visible fragment as the backward focus', () => {
    const { doc, range, selection } = setup(true)
    const geometry = getSelectionGeometry(doc, range, selection, { left: 200, top: 30, width: 800, height: 140 }, 2)!
    expect(geometry.backward).toBe(true)
    expect(geometry.focusX).toBe(210)
    expect(geometry.columnBounds).toEqual({ left: 200, top: 30, width: 400, height: 140 })
  })

  it('does not manufacture a popup anchor for an entirely hidden selection', () => {
    const { doc, range, selection } = setup()
    expect(getSelectionGeometry(doc, range, selection, { left: 200, top: 400, width: 800, height: 100 })).toBeUndefined()
  })
})
