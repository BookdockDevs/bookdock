import { describe, expect, it } from 'vitest'

import { toolbarScrollOffset, translateSelection } from '../features/reader/components/selection-toolbar-scroll'
import type { SelectionInfo } from '../features/reader/types'

describe('selection toolbar scroll following', () => {
  it('follows continuously and reverses immediately after clamping at either edge', () => {
    expect(toolbarScrollOffset(-1, 200, 300, 8, 792)).toBe(-1)
    expect(toolbarScrollOffset(-500, 200, 300, 8, 792)).toBe(-192)
    expect(toolbarScrollOffset(-191, 200, 300, 8, 792)).toBe(-191)
    expect(toolbarScrollOffset(800, 200, 300, 8, 792)).toBe(492)
    expect(toolbarScrollOffset(491, 200, 300, 8, 792)).toBe(491)
  })

  it('keeps an oversized group aligned with the upper safety boundary', () => {
    expect(toolbarScrollOffset(40, 20, 200, 8, 100)).toBe(-12)
  })

  it('captures actual text displacement for popup handoff without moving reading bounds', () => {
    const rect = { left: 200, top: 300, width: 400, height: 24 }
    const bounds = { left: 100, top: 0, width: 800, height: 600 }
    const original: SelectionInfo = {
      cfiRange: 'range', text: 'text', rect,
      geometry: { rects: [rect], bounds, backward: false, focusX: 600 },
    }
    const moved = translateSelection(original, -280, true)
    expect(moved.rect).toEqual({ ...rect, top: 20 })
    expect(moved.geometry?.rects).toEqual([{ ...rect, top: 20 }])
    expect(moved.geometry?.bounds).toBe(bounds)
    expect(original.rect?.top).toBe(300)
    expect(translateSelection(original, -800, false).visible).toBe(false)
  })
})
