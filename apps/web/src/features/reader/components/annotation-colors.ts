import type { AnnotationStyle } from '@bookdock/shared'

export interface HighlightColor {
  name: string
  hex: string
}

export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { name: 'yellow', hex: '#eab308' },
  { name: 'red', hex: '#ef4444' },
  { name: 'purple', hex: '#a855f7' },
  { name: 'blue', hex: '#3b82f6' },
  { name: 'green', hex: '#22c55e' },
]

export const HIGHLIGHT_STYLES: AnnotationStyle[] = ['underline', 'squiggly', 'highlight']

export const DEFAULT_HIGHLIGHT_COLOR = 'yellow'

const LAST_STYLE_KEY = 'bd-reader-highlight-style'

export function getLastHighlightStyle(): { color: string; style: AnnotationStyle } {
  try {
    const raw = window.localStorage.getItem(LAST_STYLE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (HIGHLIGHT_COLORS.some((c) => c.name === parsed.color) && HIGHLIGHT_STYLES.includes(parsed.style)) {
        return parsed
      }
    }
  } catch {
    // ignore storage errors
  }
  return { color: DEFAULT_HIGHLIGHT_COLOR, style: 'underline' }
}

export function setLastHighlightStyle(color: string, style: AnnotationStyle) {
  try {
    window.localStorage.setItem(LAST_STYLE_KEY, JSON.stringify({ color, style }))
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
    return { left: Math.max(8, (vw - popupWidth) / 2), top: 80, caretLeft: popupWidth / 2 }
  }
  const center = rect.left + rect.width / 2
  const left = Math.min(Math.max(8, center - popupWidth / 2), Math.max(8, vw - popupWidth - 8))
  const above = rect.top - popupHeight - gap
  const top = above >= 56 ? above : Math.min(rect.top + rect.height + gap, Math.max(56, vh - popupHeight - 8))
  const caretLeft = Math.min(Math.max(16, center - left), popupWidth - 16)
  return { left, top, caretLeft }
}
