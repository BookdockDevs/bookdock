import { describe, expect, it } from 'vitest'

import { popupPosition } from '../features/reader/components/annotation-colors'
import type { PopupRect, SelectionGeometry } from '../features/reader/types'

const bounds = { left: 200, top: 20, width: 800, height: 680 }
const rects = [
  { left: 300, top: 220, width: 400, height: 24 },
  { left: 300, top: 260, width: 400, height: 24 },
  { left: 300, top: 300, width: 240, height: 24 },
]
function geometry(backward = false): SelectionGeometry {
  return { rects, bounds, backward, focusX: backward ? 300 : 540 }
}
function overlaps(a: PopupRect, b: PopupRect) {
  return a.left < b.left + b.width && a.left + a.width > b.left
    && a.top < b.top + b.height && a.top + a.height > b.top
}

describe('selection toolbar placement', () => {
  it('preserves the default position for an annotation without a measured anchor', () => {
    expect(popupPosition(undefined, 356, 44).top).toBe(80)
  })
  it.each([false, true])('places multiline selections outside the selected text (backward=%s)', backward => {
    const info = geometry(backward)
    const anchor = backward ? rects[0]! : rects.at(-1)!
    const position = popupPosition(anchor, 356, 44, 0, info)
    expect(position.dir).toBe(backward ? 'above' : 'below')
    expect(rects.some(rect => overlaps(rect, { ...position, height: 44 }))).toBe(false)
  })

  it('keeps short single-line selections centered above', () => {
    const rect = { left: 480, top: 300, width: 40, height: 24 }
    const position = popupPosition(rect, 356, 44, 0, { ...geometry(), rects: [rect], focusX: 520 })
    expect(position.dir).toBe('above')
    expect(position.left).toBe(322)
    expect(position.top).toBe(246)
  })

  it('uses the opposite selection boundary when a backward selection starts at the top edge', () => {
    const lines = rects.map(rect => ({ ...rect, top: rect.top - 200 }))
    const position = popupPosition(lines[0], 356, 44, 48, { ...geometry(true), rects: lines }, 236)
    expect(position.dir).toBe('below')
    expect(position.top).toBe(134)
    expect(lines.some(rect => overlaps(rect, { ...position, height: 44 }))).toBe(false)
  })

  it('keeps a long line close to its focus rather than its midpoint', () => {
    const rect = { left: 240, top: 300, width: 700, height: 24 }
    const position = popupPosition(rect, 356, 44, 0, { ...geometry(), rects: [rect], focusX: 900 })
    expect(position.left).toBe(636)
  })

  it('keeps both measured bars inside the reading region', () => {
    const info = geometry()
    const position = popupPosition(rects.at(-1), 358, 46, 50, info, 240)
    expect(position.top).toBe(334)
    expect(position.styleTop).toBe(388)
    expect(position.styleLeft).toBe(position.left + 59)
    expect(position.styleTop + 42).toBeLessThanOrEqual(bounds.top + bounds.height - 8)
  })

  it('prefers the active column and uses the reader when the group is too wide', () => {
    const info = { ...geometry(), columnBounds: { left: 600, top: 20, width: 400, height: 680 }, focusX: 640 }
    const rect = { left: 620, top: 300, width: 100, height: 24 }
    const position = popupPosition(rect, 356, 44, 0, { ...info, rects: [rect] })
    expect(position.left).toBeGreaterThanOrEqual(608)
    expect(position.left + position.width).toBeLessThanOrEqual(992)
    const wide = popupPosition(rect, 500, 44, 0, { ...info, rects: [rect] })
    expect(wide.width).toBe(500)
    expect(wide.left).toBeGreaterThanOrEqual(208)
  })

  it('uses the constrained width to center a narrow-screen bar', () => {
    const rect = { left: 160, top: 200, width: 0, height: 24 }
    const position = popupPosition(rect, 356, 44, 0, {
      rects: [rect], bounds: { left: 0, top: 0, width: 320, height: 600 }, backward: false, focusX: 160,
    })
    expect(position.width).toBe(304)
    expect(position.left).toBe(8)
  })

  it('shifts horizontally to avoid text when neither side has vertical space', () => {
    const rect = { left: 240, top: 50, width: 30, height: 24 }
    const position = popupPosition(rect, 356, 44, 48, {
      rects: [rect], bounds: { left: 200, top: 20, width: 800, height: 120 }, backward: false, focusX: 270,
    }, 236)
    expect(overlaps(rect, { ...position, height: 44 })).toBe(false)
    expect(overlaps(rect, { left: position.styleLeft, top: position.styleTop, width: position.styleWidth, height: 40 })).toBe(false)
    expect(position.styleTop).toBeGreaterThanOrEqual(28)
    expect(Math.max(position.styleTop + 40, position.top + 44)).toBeLessThanOrEqual(132)
  })

  it.each([false, true])('keeps a full-screen selection accessible at the edge (backward=%s)', backward => {
    const lines = Array.from({ length: 17 }, (_, index) => ({ left: 200, top: 20 + index * 40, width: 800, height: 35 }))
    const info = { ...geometry(backward), rects: lines }
    const position = popupPosition(backward ? lines[0] : lines.at(-1), 356, 44, 48, info, 236)
    expect(position.left).toBeGreaterThanOrEqual(208)
    expect(position.top).toBeGreaterThanOrEqual(28)
    expect(Math.max(position.top + 44, position.styleTop + 40)).toBeLessThanOrEqual(692)
  })
})
