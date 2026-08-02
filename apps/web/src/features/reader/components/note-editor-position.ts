import type { PopupRect, ReadingMode } from '../types'

export type NotePlacement = 'above' | 'below' | 'left' | 'right'

export interface NoteEditorPosition {
  left: number
  top: number
  /** Where the bubble sits relative to the selection */
  placement: NotePlacement
  /** Arrow-center offset along the bubble edge facing the selection; null hides the arrow */
  arrowOffset: number | null
  /** Constrained bubble height when viewport space is tight */
  maxHeight: number | null
}

export interface Size {
  width: number
  height: number
}

const VIEWPORT_MARGIN = 12
const SELECTION_GAP = 14
/** Keeps the arrow clear of the bubble's rounded corners */
const ARROW_EDGE_INSET = 24
const MIN_BUBBLE_HEIGHT = 180

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Position the note editor bubble around a selection rect.
 * Scroll mode stacks the bubble above/below the selection; page mode pops it
 * out to the side with more room and falls back to stacking on narrow screens.
 */
export function noteEditorPosition(
  rect: PopupRect | undefined,
  mode: ReadingMode,
  bubble: Size,
  viewport: Size,
): NoteEditorPosition {
  const { width: vw, height: vh } = viewport
  if (!rect) {
    return {
      left: clamp((vw - bubble.width) / 2, VIEWPORT_MARGIN, vw - bubble.width - VIEWPORT_MARGIN),
      top: clamp((vh - bubble.height) / 2, VIEWPORT_MARGIN, vh - bubble.height - VIEWPORT_MARGIN),
      placement: mode === 'page' ? 'right' : 'below',
      arrowOffset: null,
      maxHeight: null,
    }
  }

  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2

  if (mode === 'page') {
    const spaceRight = vw - VIEWPORT_MARGIN - (rect.left + rect.width)
    const spaceLeft = rect.left - VIEWPORT_MARGIN
    const fitsRight = spaceRight >= bubble.width + SELECTION_GAP
    const fitsLeft = spaceLeft >= bubble.width + SELECTION_GAP
    if (fitsRight || fitsLeft) {
      const placement: NotePlacement =
        fitsRight && fitsLeft ? (spaceRight >= spaceLeft ? 'right' : 'left') : fitsRight ? 'right' : 'left'
      const left =
        placement === 'right' ? rect.left + rect.width + SELECTION_GAP : rect.left - SELECTION_GAP - bubble.width
      const maxHeight =
        bubble.height > vh - 2 * VIEWPORT_MARGIN ? Math.max(MIN_BUBBLE_HEIGHT, vh - 2 * VIEWPORT_MARGIN) : null
      const height = maxHeight ?? bubble.height
      const top = clamp(centerY - height / 2, VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN)
      return {
        left,
        top,
        placement,
        arrowOffset: clamp(centerY - top, ARROW_EDGE_INSET, height - ARROW_EDGE_INSET),
        maxHeight,
      }
    }
    // Neither side fits — fall through to stacked placement
  }

  const spaceBelow = vh - VIEWPORT_MARGIN - (rect.top + rect.height)
  const spaceAbove = rect.top - VIEWPORT_MARGIN
  const placement: NotePlacement =
    spaceBelow >= bubble.height + SELECTION_GAP || spaceBelow >= spaceAbove ? 'below' : 'above'
  const space = placement === 'below' ? spaceBelow : spaceAbove
  const maxHeight =
    space < bubble.height + SELECTION_GAP ? Math.max(MIN_BUBBLE_HEIGHT, space - SELECTION_GAP) : null
  const height = maxHeight ?? bubble.height
  const left = clamp(centerX - bubble.width / 2, VIEWPORT_MARGIN, vw - bubble.width - VIEWPORT_MARGIN)
  const top = placement === 'below' ? rect.top + rect.height + SELECTION_GAP : rect.top - SELECTION_GAP - height
  return {
    left,
    top: clamp(top, VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN),
    placement,
    arrowOffset: clamp(centerX - left, ARROW_EDGE_INSET, bubble.width - ARROW_EDGE_INSET),
    maxHeight,
  }
}
