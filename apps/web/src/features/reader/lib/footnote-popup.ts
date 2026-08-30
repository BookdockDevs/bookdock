import type { PopupRect } from '../types'

export interface FootnotePopupSize {
  width: number
  height: number
}

export interface FootnoteViewport {
  width: number
  height: number
}

export interface FootnotePopupPosition {
  left: number
  top: number
  placement: 'above' | 'below'
}

const VIEWPORT_MARGIN = 12
const ANCHOR_GAP = 8

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function footnotePopupMaxHeight(viewportHeight: number) {
  return Math.max(120, Math.min(520, viewportHeight * 0.6))
}

export function footnotePopupPosition(
  anchor: PopupRect | undefined,
  size: FootnotePopupSize,
  viewport: FootnoteViewport,
): FootnotePopupPosition {
  const left = clamp(
    anchor ? anchor.left + (anchor.width - size.width) / 2 : (viewport.width - size.width) / 2,
    VIEWPORT_MARGIN,
    viewport.width - size.width - VIEWPORT_MARGIN,
  )
  const below = anchor ? anchor.top + anchor.height + ANCHOR_GAP : (viewport.height - size.height) / 2
  const above = anchor ? anchor.top - size.height - ANCHOR_GAP : below
  const fitsBelow = below + size.height <= viewport.height - VIEWPORT_MARGIN
  const top = clamp(
    fitsBelow || !anchor ? below : above,
    VIEWPORT_MARGIN,
    viewport.height - size.height - VIEWPORT_MARGIN,
  )
  return { left, top, placement: fitsBelow || !anchor ? 'below' : 'above' }
}
