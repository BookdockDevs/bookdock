import type { CSSProperties } from 'react'

import type { ReadingTheme } from '@/lib/reading-theme'

export function readerPanelVars(theme: ReadingTheme): CSSProperties {
  return {
    '--slider-accent': blendColors(theme.bg, theme.text, 0.65),
    '--slider-track': blendColors(theme.bg, theme.text, 0.15),
    '--toggle-on-bg': blendColors(theme.bg, theme.text, 0.65),
    '--toggle-off-bg': blendColors(theme.bg, theme.text, 0.20),
  } as CSSProperties
}

import { blendColors } from '@/lib/utils'
