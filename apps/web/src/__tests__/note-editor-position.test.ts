import { describe, expect, it } from 'vitest'

import { noteEditorPosition } from '../features/reader/components/note-editor-position'

const VIEWPORT = { width: 1280, height: 800 }
const SCROLL_SIZE = { width: 560, height: 300 }
const PAGE_SIZE = { width: 400, height: 340 }
const MARGIN = 12
const GAP = 14

describe('noteEditorPosition — scroll mode (stacked)', () => {
  it('places the bubble below the selection when there is room', () => {
    const rect = { left: 360, top: 120, width: 200, height: 40 }
    const pos = noteEditorPosition(rect, 'scroll', SCROLL_SIZE, VIEWPORT)
    expect(pos.placement).toBe('below')
    expect(pos.top).toBe(rect.top + rect.height + GAP)
    expect(pos.left).toBe(rect.left + rect.width / 2 - SCROLL_SIZE.width / 2)
    expect(pos.maxHeight).toBeNull()
    expect(pos.arrowOffset).toBe(rect.left + rect.width / 2 - pos.left)
  })

  it('flips above the selection when space below is tight', () => {
    const rect = { left: 360, top: 700, width: 200, height: 40 }
    const pos = noteEditorPosition(rect, 'scroll', SCROLL_SIZE, VIEWPORT)
    expect(pos.placement).toBe('above')
    expect(pos.top).toBe(rect.top - GAP - SCROLL_SIZE.height)
  })

  it('clamps horizontally and keeps the arrow on the selection near the left edge', () => {
    const rect = { left: 20, top: 120, width: 60, height: 40 }
    const pos = noteEditorPosition(rect, 'scroll', SCROLL_SIZE, VIEWPORT)
    expect(pos.left).toBe(MARGIN)
    expect(pos.arrowOffset).toBe(20 + 30 - MARGIN)
  })

  it('clamps horizontally and keeps the arrow inside the bubble near the right edge', () => {
    const rect = { left: 1200, top: 120, width: 60, height: 40 }
    const pos = noteEditorPosition(rect, 'scroll', SCROLL_SIZE, VIEWPORT)
    expect(pos.left).toBe(VIEWPORT.width - SCROLL_SIZE.width - MARGIN)
    expect(pos.arrowOffset).toBe(1230 - pos.left)
    expect(pos.arrowOffset!).toBeLessThanOrEqual(SCROLL_SIZE.width - 24)
  })

  it('shrinks the bubble when neither side fully fits', () => {
    const rect = { left: 360, top: 100, width: 200, height: 40 }
    const pos = noteEditorPosition(rect, 'scroll', SCROLL_SIZE, { width: 1280, height: 400 })
    expect(pos.placement).toBe('below')
    expect(pos.maxHeight).toBe(400 - MARGIN - (rect.top + rect.height) - GAP)
    expect(pos.top + pos.maxHeight!).toBeLessThanOrEqual(400 - MARGIN)
  })
})

describe('noteEditorPosition — page mode (sideways)', () => {
  it('pops out to the right when the right side has room', () => {
    const rect = { left: 100, top: 300, width: 200, height: 40 }
    const pos = noteEditorPosition(rect, 'page', PAGE_SIZE, VIEWPORT)
    expect(pos.placement).toBe('right')
    expect(pos.left).toBe(rect.left + rect.width + GAP)
    expect(pos.top).toBe(rect.top + rect.height / 2 - PAGE_SIZE.height / 2)
    expect(pos.arrowOffset).toBe(rect.top + rect.height / 2 - pos.top)
  })

  it('pops out to the left when the left side has more room', () => {
    const rect = { left: 980, top: 300, width: 200, height: 40 }
    const pos = noteEditorPosition(rect, 'page', PAGE_SIZE, VIEWPORT)
    expect(pos.placement).toBe('left')
    expect(pos.left).toBe(rect.left - GAP - PAGE_SIZE.width)
  })

  it('centers vertically with clamping and adapts the arrow near the viewport top', () => {
    const rect = { left: 100, top: 20, width: 200, height: 30 }
    const pos = noteEditorPosition(rect, 'page', PAGE_SIZE, VIEWPORT)
    expect(pos.placement).toBe('right')
    expect(pos.top).toBe(MARGIN)
    // Arrow still points at the selection center, clamped inside the bubble edge
    expect(pos.arrowOffset).toBe(24)
  })

  it('clamps the arrow inside the bubble bottom near the viewport bottom', () => {
    const rect = { left: 100, top: 760, width: 200, height: 30 }
    const pos = noteEditorPosition(rect, 'page', PAGE_SIZE, VIEWPORT)
    expect(pos.placement).toBe('right')
    expect(pos.top + PAGE_SIZE.height).toBeLessThanOrEqual(VIEWPORT.height - MARGIN)
    expect(pos.arrowOffset).toBe(PAGE_SIZE.height - 24)
  })

  it('falls back to stacked placement when neither side fits', () => {
    const rect = { left: 300, top: 300, width: 680, height: 40 }
    const pos = noteEditorPosition(rect, 'page', PAGE_SIZE, VIEWPORT)
    expect(pos.placement).toBe('below')
    expect(pos.top).toBe(rect.top + rect.height + GAP)
  })

  it('constrains height on short viewports', () => {
    const rect = { left: 100, top: 100, width: 200, height: 40 }
    const pos = noteEditorPosition(rect, 'page', PAGE_SIZE, { width: 1280, height: 300 })
    expect(pos.placement).toBe('right')
    expect(pos.maxHeight).toBe(300 - 2 * MARGIN)
    expect(pos.top).toBe(MARGIN)
  })
})

describe('noteEditorPosition — without a rect', () => {
  it('centers the bubble and hides the arrow', () => {
    const pos = noteEditorPosition(undefined, 'scroll', SCROLL_SIZE, VIEWPORT)
    expect(pos.left).toBe((VIEWPORT.width - SCROLL_SIZE.width) / 2)
    expect(pos.top).toBe((VIEWPORT.height - SCROLL_SIZE.height) / 2)
    expect(pos.arrowOffset).toBeNull()
  })
})
