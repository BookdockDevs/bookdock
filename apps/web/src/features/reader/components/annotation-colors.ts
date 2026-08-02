import type { AnnotationStyle } from '@bookdock/shared'

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
      } else if (HIGHLIGHT_COLORS.some((c) => c.name === parsed?.color)) {
        // Legacy shape { color, style }: seed the remembered color for that style
        colors[style] = parsed.color
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

/** Position a popup above (or below, when near the viewport top) a content rect */
export function popupPosition(
  rect: { left: number; top: number; width: number; height: number } | undefined,
  popupWidth: number,
  popupHeight: number,
) {
  const gap = 10
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!rect) {
    return { left: Math.max(8, (vw - popupWidth) / 2), top: 80, caretLeft: popupWidth / 2, dir: 'above' as const }
  }
  const center = rect.left + rect.width / 2
  const left = Math.min(Math.max(8, center - popupWidth / 2), Math.max(8, vw - popupWidth - 8))
  const above = rect.top - popupHeight - gap
  const isAbove = above >= 56
  const top = isAbove ? above : Math.min(rect.top + rect.height + gap, Math.max(56, vh - popupHeight - 8))
  const caretLeft = Math.min(Math.max(16, center - left), popupWidth - 16)
  return { left, top, caretLeft, dir: isAbove ? 'above' as const : 'below' as const }
}
