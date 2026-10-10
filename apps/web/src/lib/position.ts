export const PADDING = 8

export interface AnchorRect {
  left: number
  top: number
  width: number
  height: number
}

export interface SmartPosition {
  left: number
  top: number
  dir: 'down' | 'up'
}

export function computeFromAnchor(
  anchor: AnchorRect,
  menuW: number,
  menuH: number,
): SmartPosition {
  const { innerWidth: vw, innerHeight: vh } = window
  const defaultTop = anchor.top + anchor.height + PADDING
  const dir: 'down' | 'up' = defaultTop + menuH + PADDING <= vh ? 'down' : 'up'
  const top = dir === 'down' ? defaultTop : Math.max(PADDING, anchor.top - menuH - PADDING)
  const fitsRight = anchor.left + anchor.width + menuW + PADDING <= vw
  const left = fitsRight
    ? anchor.left + anchor.width
    : Math.max(PADDING, anchor.left + anchor.width - menuW)
  return { left, top, dir }
}

export function computeAtPoint(
  point: { x: number; y: number },
  menuW: number,
  menuH: number,
): SmartPosition {
  const { innerWidth: vw, innerHeight: vh } = window
  const left = Math.max(PADDING, Math.min(point.x, vw - menuW - PADDING))
  const top = Math.max(PADDING, Math.min(point.y, vh - menuH - PADDING))
  return { left, top, dir: point.y + menuH + PADDING <= vh ? 'down' : 'up' }
}

/**
 * Dropdown-select placement: directly below the trigger, left-aligned and
 * clamped into the viewport (flips above when there is no room below).
 * Unlike computeFromAnchor (which prefers the side, for context menus),
 * this keeps the menu visually attached to its trigger.
 */
export function computeDropdownPosition(
  anchor: AnchorRect,
  menuW: number,
  menuH: number,
): SmartPosition {
  const { innerWidth: vw, innerHeight: vh } = window
  const below = anchor.top + anchor.height + 6
  const dir: 'down' | 'up' = below + menuH + PADDING <= vh ? 'down' : 'up'
  return {
    left: Math.max(PADDING, Math.min(anchor.left, vw - menuW - PADDING)),
    top: dir === 'down' ? below : Math.max(PADDING, anchor.top - menuH - 6),
    dir,
  }
}
