import type { PopupRect, SelectionGeometry } from '../types'

export function getSelectionGeometry(
  doc: Document,
  range: Range,
  selection: Selection,
  viewport: PopupRect,
  columnCount = 1,
): SelectionGeometry | undefined {
  const frame = doc.defaultView?.frameElement as HTMLElement | null
  if (!frame) return undefined
  const frameRect = frame.getBoundingClientRect()
  const scaleX = frame.offsetWidth > 0 ? frameRect.width / frame.offsetWidth : 1
  const scaleY = frame.offsetHeight > 0 ? frameRect.height / frame.offsetHeight : 1
  const left = Math.max(0, viewport.left)
  const top = Math.max(0, viewport.top)
  const right = Math.min(window.innerWidth, viewport.left + viewport.width)
  const bottom = Math.min(window.innerHeight, viewport.top + viewport.height)
  if (right <= left || bottom <= top) return undefined
  const bounds = { left, top, width: right - left, height: bottom - top }
  const rects: PopupRect[] = []
  for (const rect of range.getClientRects()) {
    // Visibility and placement must use the same transformed coordinates.
    const x = Math.max(left, frameRect.left, frameRect.left + rect.left * scaleX)
    const y = Math.max(top, frameRect.top, frameRect.top + rect.top * scaleY)
    const r = Math.min(right, frameRect.right, frameRect.left + rect.right * scaleX)
    const b = Math.min(bottom, frameRect.bottom, frameRect.top + rect.bottom * scaleY)
    if (r > x && b > y) rects.push({ left: x, top: y, width: r - x, height: b - y })
  }
  if (!rects.length || !selection.focusNode) return undefined
  const focus = doc.createRange()
  focus.setStart(selection.focusNode, selection.focusOffset)
  focus.collapse(true)
  const backward = focus.compareBoundaryPoints(Range.START_TO_START, range) === 0
  const anchor = backward ? rects[0]! : rects.at(-1)!
  const caret = focus.getClientRects()[0]
  const rtl = doc.defaultView?.getComputedStyle(doc.documentElement).direction === 'rtl'
  const endpointX = caret && caret.height > 0
    ? frameRect.left + caret.left * scaleX
    : anchor.left + ((backward !== rtl) ? 0 : anchor.width)
  const focusX = Math.min(Math.max(anchor.left, endpointX), anchor.left + anchor.width)
  const vertical = doc.defaultView?.getComputedStyle(doc.documentElement).writingMode.startsWith('vertical')
  let columnBounds: PopupRect | undefined
  if (columnCount > 1 && !vertical) {
    // Use the paginator's resolved column count, not the user's maximum.
    const columnWidth = viewport.width / columnCount
    const column = Math.min(columnCount - 1, Math.max(0, Math.floor((focusX - viewport.left) / columnWidth)))
    const columnLeft = Math.max(left, viewport.left + column * columnWidth)
    const columnRight = Math.min(right, viewport.left + (column + 1) * columnWidth)
    columnBounds = { left: columnLeft, top, width: columnRight - columnLeft, height: bottom - top }
  }
  return { rects, bounds, columnBounds, backward, focusX }
}
