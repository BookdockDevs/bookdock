import { PADDING, computeAtPoint, computeDropdownPosition, computeFromAnchor, type SmartPosition } from '@/lib/position'

/**
 * What a floating menu is attached to. Placement is derived from the anchor
 * every time the layout moves, so the anchor must be an element (plus an offset
 * inside it for pointer menus) - never a viewport point frozen at open time.
 */
export type MenuAnchor =
  | { kind: 'pointer'; el: Element; dx: number; dy: number }
  | { kind: 'element'; el: Element; placement: MenuPlacement; align?: 'start' | 'end'; gap?: number }

export type MenuPlacement =
  /** Context menus and row menus: prefer the side of the anchor. */
  | 'side'
  /** Selects and dropdowns: directly below the trigger. */
  | 'below'
  /** Popovers that grow upwards from the trigger (e.g. the translation picker). */
  | 'above'

export interface MenuSize {
  width: number
  height: number
}

export interface ClipAncestor {
  el: Element
  clipX: boolean
  clipY: boolean
}

interface Edges {
  left: number
  top: number
  right: number
  bottom: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}

/**
 * Pointer anchor from a viewport point and the element it landed on. The offset
 * is what makes the menu travel with its element: a bare viewport point cannot
 * be re-derived once anything scrolls.
 */
export function pointerAnchor(el: Element, point: { x: number; y: number }): MenuAnchor {
  const rect = el.getBoundingClientRect()
  return { kind: 'pointer', el, dx: point.x - rect.left, dy: point.y - rect.top }
}

function toEdges(rect: { left: number; top: number; width: number; height: number }): Edges {
  return { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height }
}

function intersect(a: Edges, b: Edges): Edges | null {
  const edges: Edges = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  }
  return edges.right > edges.left && edges.bottom > edges.top ? edges : null
}

function viewportEdges(): Edges {
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
}

/**
 * `above` keeps the popover growing away from the bottom of the screen: it
 * opens upwards and only flips down when there is no room left above.
 */
function computeAbove(anchor: Edges, size: MenuSize, align: 'start' | 'end', gap: number): SmartPosition {
  const above = anchor.top - gap - size.height
  const dir = above >= PADDING ? 'up' : 'down'
  const left = align === 'end' ? anchor.right - size.width : anchor.left
  return { left, top: dir === 'up' ? above : anchor.bottom + gap, dir }
}

/**
 * The single source of truth for where a menu goes. Placement is chosen from
 * the *real* size (direction included), then the result is clamped into the
 * viewport - computing a placement without that last clamp lets a wide anchor
 * push the menu off the right edge.
 *
 * Returns null when the anchor is gone; callers close on null.
 */
export function resolveMenuAnchor(anchor: MenuAnchor, size: MenuSize): SmartPosition | null {
  const el = anchor.el
  if (!el.isConnected) return null

  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxLeft = Math.max(PADDING, vw - size.width - PADDING)
  const maxTop = Math.max(PADDING, vh - size.height - PADDING)

  let candidate: SmartPosition
  if (anchor.kind === 'pointer') {
    candidate = computeAtPoint(
      { x: rect.left + anchor.dx, y: rect.top + anchor.dy },
      size.width,
      size.height,
    )
  } else if (anchor.placement === 'below') {
    candidate = computeDropdownPosition(
      rect,
      size.width,
      size.height,
      anchor.align ?? 'start',
      anchor.gap ?? 6,
    )
  } else if (anchor.placement === 'above') {
    candidate = computeAbove(toEdges(rect), size, anchor.align ?? 'start', anchor.gap ?? 6)
  } else {
    candidate = computeFromAnchor(rect, size.width, size.height)
    // Menus that pin their right edge to the trigger's right edge (sort and
    // filter buttons that sit at the end of a toolbar).
    if (anchor.align === 'end') candidate = { ...candidate, left: rect.right - size.width }
  }

  return {
    left: clamp(candidate.left, PADDING, maxLeft),
    top: clamp(candidate.top, PADDING, maxTop),
    dir: candidate.dir,
  }
}

/**
 * Ancestors that can clip the anchor. Cached per anchor element by the caller
 * and rebuilt whenever the anchor changes: an element moved to another parent,
 * or an ancestor gaining `overflow: hidden`, invalidates the cached chain.
 */
export function collectClipAncestors(el: Element): ClipAncestor[] {
  const ancestors: ClipAncestor[] = []
  let node = el.parentElement
  while (node && node !== document.documentElement) {
    const style = window.getComputedStyle(node)
    const clipX = style.overflowX !== 'visible'
    const clipY = style.overflowY !== 'visible'
    if (clipX || clipY) ancestors.push({ el: node, clipX, clipY })
    node = node.parentElement
  }
  return ancestors
}

function clipEdges(node: ClipAncestor): Edges {
  const rect = node.el.getBoundingClientRect()
  // The scroll container's visible area starts inside its border, not at it.
  const left = rect.left + node.el.clientLeft
  const top = rect.top + node.el.clientTop
  return {
    left: node.clipX ? left : Number.NEGATIVE_INFINITY,
    top: node.clipY ? top : Number.NEGATIVE_INFINITY,
    right: node.clipX ? left + node.el.clientWidth : Number.POSITIVE_INFINITY,
    bottom: node.clipY ? top + node.el.clientHeight : Number.POSITIVE_INFINITY,
  }
}

/**
 * Whether the anchor is actually visible: inside the viewport *and* inside
 * every clipping ancestor. A row scrolled out of the sidebar keeps its viewport
 * rect, so the viewport check alone would leave the menu floating over other
 * rows - the exact mis-click this change exists to remove.
 */
export function isAnchorReachable(el: Element, clips: ClipAncestor[]): boolean {
  if (!el.isConnected) return false

  // A zero-sized anchor (an inline wrapper, or an element jsdom never laid out)
  // still has an origin; treat it as a 1px box there rather than as invisible.
  const raw = el.getBoundingClientRect()
  let visible = intersect(
    {
      left: raw.left,
      top: raw.top,
      right: raw.left + Math.max(raw.width, 1),
      bottom: raw.top + Math.max(raw.height, 1),
    },
    viewportEdges(),
  )
  if (!visible) return false

  for (const node of clips) {
    if (!node.el.isConnected) continue
    visible = intersect(visible, clipEdges(node))
    if (!visible) return false
  }
  return true
}
