import type { SelectionInfo } from '../types'

export function toolbarScrollOffset(deltaY: number, top: number, bottom: number, boundsTop: number, boundsBottom: number) {
  return Math.max(boundsTop - top, Math.min(deltaY, Math.max(boundsTop - top, boundsBottom - bottom)))
}

export function translateSelection(selection: SelectionInfo, deltaY: number, visible: boolean): SelectionInfo {
  const rect = selection.rect ? { ...selection.rect, top: selection.rect.top + deltaY } : undefined
  const geometry = selection.geometry ? {
    ...selection.geometry,
    rects: selection.geometry.rects.map(fragment => ({ ...fragment, top: fragment.top + deltaY })),
  } : undefined
  return { ...selection, rect, geometry, visible }
}
