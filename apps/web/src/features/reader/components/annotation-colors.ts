import type { AnnotationStyle } from '@bookdock/shared'

import type { PopupRect, SelectionGeometry } from '../types'

export interface HighlightColor {
  name: string
  hex: string
}

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { name: 'red', hex: '#ef4444' },
  { name: 'purple', hex: '#a855f7' },
  { name: 'blue', hex: '#3b82f6' },
  { name: 'green', hex: '#22c55e' },
  { name: 'yellow', hex: '#eab308' },
]

export const HIGHLIGHT_STYLES: AnnotationStyle[] = ['highlight', 'underline', 'squiggly']

export const STYLE_LABEL_KEYS: Record<AnnotationStyle, string> = {
  highlight: 'annotation.styleHighlight',
  underline: 'annotation.styleUnderline',
  squiggly: 'annotation.styleSquiggly',
}

export const COLOR_LABEL_KEYS: Record<string, string> = {
  red: 'annotation.colorRed',
  purple: 'annotation.colorPurple',
  blue: 'annotation.colorBlue',
  green: 'annotation.colorGreen',
  yellow: 'annotation.colorYellow',
}

export function highlightHex(name: string): string | undefined {
  return HIGHLIGHT_COLORS.find((c) => c.name === name)?.hex
}

export const DEFAULT_HIGHLIGHT_COLOR = 'yellow'
export const DEFAULT_IDEA_COLOR = 'amber'
export const DEFAULT_HIGHLIGHT_STYLE: AnnotationStyle = 'underline'

const LAST_STYLE_KEY = 'bd-reader-highlight-style'

/** Persisted shape: each style remembers its own last-used color */
interface StyleMemory {
  style: AnnotationStyle
  colors: Record<AnnotationStyle, string>
}

function defaultColors(): Record<AnnotationStyle, string> {
  return { highlight: DEFAULT_HIGHLIGHT_COLOR, underline: DEFAULT_HIGHLIGHT_COLOR, squiggly: DEFAULT_HIGHLIGHT_COLOR }
}

function readMemory(): StyleMemory {
  try {
    const raw = window.localStorage.getItem(LAST_STYLE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const style: AnnotationStyle = HIGHLIGHT_STYLES.includes(parsed?.style) ? parsed.style : DEFAULT_HIGHLIGHT_STYLE
      const colors = defaultColors()
      if (parsed?.colors && typeof parsed.colors === 'object') {
        for (const s of HIGHLIGHT_STYLES) {
          if (HIGHLIGHT_COLORS.some((c) => c.name === parsed.colors[s])) colors[s] = parsed.colors[s]
        }
      }
      return { style, colors }
    }
  } catch {
    // ignore storage errors
  }
  return { style: DEFAULT_HIGHLIGHT_STYLE, colors: defaultColors() }
}

export function getLastHighlightStyle(): { color: string; style: AnnotationStyle } {
  const memory = readMemory()
  return { color: memory.colors[memory.style], style: memory.style }
}

export function getStyleColor(style: AnnotationStyle): string {
  return readMemory().colors[style]
}

export function setLastHighlightStyle(color: string, style: AnnotationStyle) {
  try {
    const memory = readMemory()
    memory.style = style
    memory.colors[style] = color
    window.localStorage.setItem(LAST_STYLE_KEY, JSON.stringify(memory))
  } catch {
    // ignore storage errors
  }
}

/** Keep the complete toolbar group visible while minimizing selected-text overlap. */
export function popupPosition(
  rect: PopupRect | undefined,
  popupWidth: number,
  popupHeight: number,
  extraHeight = 0,
  geometry?: SelectionGeometry,
  styleWidth = popupWidth,
) {
  const gap = 10
  const visual = window.visualViewport
  const screenLeft = visual?.offsetLeft ?? 0
  const screenTop = visual?.offsetTop ?? 0
  const screenRight = screenLeft + (visual?.width ?? window.innerWidth)
  const screenBottom = screenTop + (visual?.height ?? window.innerHeight)
  const reading = geometry?.bounds
  let bounds = {
    left: Math.max(screenLeft, reading?.left ?? screenLeft),
    top: Math.max(screenTop, reading?.top ?? screenTop),
    right: Math.min(screenRight, reading ? reading.left + reading.width : screenRight),
    bottom: Math.min(screenBottom, reading ? reading.top + reading.height : screenBottom),
  }
  const column = geometry?.columnBounds
  const naturalWidth = Math.max(popupWidth, extraHeight ? styleWidth : 0)
  if (column && naturalWidth <= column.width - 16) {
    bounds = { ...bounds, left: Math.max(bounds.left, column.left), right: Math.min(bounds.right, column.left + column.width) }
  }
  const width = Math.min(popupWidth, Math.max(0, bounds.right - bounds.left - 16))
  const effectiveStyleWidth = Math.min(styleWidth, Math.max(0, bounds.right - bounds.left - 16))
  const groupWidth = Math.max(width, extraHeight ? effectiveStyleWidth : 0)
  const totalHeight = popupHeight + extraHeight
  const anchor = rect ?? { left: (bounds.left + bounds.right) / 2, top: bounds.top + 80 + popupHeight + gap, width: 0, height: 0 }
  const multiline = geometry?.rects.some(r => Math.abs(r.top - anchor.top) > Math.min(r.height, anchor.height) / 2) ?? false
  const preferred = multiline && !geometry?.backward ? 'below' : 'above'
  const center = geometry && anchor.width > width / 2 ? geometry.focusX : anchor.left + anchor.width / 2
  const selectedTop = geometry?.rects.reduce((value, r) => Math.min(value, r.top), anchor.top) ?? anchor.top
  const selectedBottom = geometry?.rects.reduce((value, r) => Math.max(value, r.top + r.height), anchor.top + anchor.height) ?? anchor.top + anchor.height
  const candidates = []
  for (const dir of [preferred, preferred === 'above' ? 'below' : 'above'] as const) {
    const idealTop = dir === 'above' ? anchor.top - totalHeight - gap : anchor.top + anchor.height + gap
    // At a viewport edge, the other end of a short selection may be the only clear space.
    const boundaryTop = dir === 'above' ? selectedTop - totalHeight - gap : selectedBottom + gap
    const centers = geometry ? [center, anchor.left - gap - groupWidth / 2, anchor.left + anchor.width + gap + groupWidth / 2] : [center]
    for (const y of new Set([idealTop, boundaryTop])) {
      const groupTop = Math.min(Math.max(bounds.top + 8, y), Math.max(bounds.top + 8, bounds.bottom - totalHeight - 8))
      for (const x of centers) {
        const groupLeft = Math.min(Math.max(bounds.left + 8, x - groupWidth / 2), Math.max(bounds.left + 8, bounds.right - groupWidth - 8))
        const left = groupLeft + (groupWidth - width) / 2
        const top = groupTop + (dir === 'above' ? extraHeight : 0)
        const styleLeft = groupLeft + (groupWidth - effectiveStyleWidth) / 2
        const styleTop = dir === 'above' ? groupTop : top + popupHeight + 8
        const boxes = [{ left, top, width, height: popupHeight }]
        if (extraHeight) boxes.push({ left: styleLeft, top: styleTop, width: effectiveStyleWidth, height: extraHeight - 8 })
        let overlap = 0
        for (const selected of geometry?.rects ?? []) {
          for (const box of boxes) {
            overlap += Math.max(0, Math.min(box.left + box.width, selected.left + selected.width) - Math.max(box.left, selected.left))
              * Math.max(0, Math.min(box.top + box.height, selected.top + selected.height) - Math.max(box.top, selected.top))
          }
        }
        candidates.push({ left, top, styleLeft, styleTop, width, styleWidth: effectiveStyleWidth, dir,
          overlap, displacement: Math.abs(groupTop - idealTop) + Math.abs(groupLeft + groupWidth / 2 - center) })
      }
    }
  }
  candidates.sort((a, b) => a.overlap - b.overlap || a.displacement - b.displacement)
  const best = candidates[0]!
  const caretLeft = Math.min(Math.max(16, center - best.left), Math.max(16, width - 16))
  return { ...best, caretLeft }
}
