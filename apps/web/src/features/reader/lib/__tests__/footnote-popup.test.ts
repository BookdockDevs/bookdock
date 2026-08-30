import { describe, expect, it } from 'vitest'

import { footnotePopupMaxHeight, footnotePopupPosition } from '../footnote-popup'

describe('footnote popup layout', () => {
  it('keeps an anchored popup inside the viewport and flips above when needed', () => {
    const position = footnotePopupPosition(
      { left: 320, top: 560, width: 20, height: 20 },
      { width: 400, height: 300 },
      { width: 800, height: 640 },
    )

    expect(position.placement).toBe('above')
    expect(position.left).toBe(130)
    expect(position.top).toBe(252)
  })

  it('caps desktop height and retains a usable minimum on short viewports', () => {
    expect(footnotePopupMaxHeight(1000)).toBe(520)
    expect(footnotePopupMaxHeight(300)).toBe(180)
    expect(footnotePopupMaxHeight(100)).toBe(120)
  })
})
