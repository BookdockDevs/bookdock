import { createContext, useContext } from 'react'

import type { ReaderBookThemeSettings, ReaderBookSlotTheme } from '@bookdock/shared'

import type { BookSettingGroups, EffectiveReadingSettings, BookSettingsGroup } from './lib/view-settings'
import type { ResolvedAppearance } from '@/features/reading-theme/appearance'
import type { BookDeviceFontSelection } from './lib/book-device-fonts'

// Per-book reader settings layer. Provided by Reader.tsx; consumed by
// SettingsPanel (display + writes), the theme tab and useReaderRenderer
// (which receives the effective values as a prop instead).
export interface ViewSettingsContextValue {
  /** Fully merged effective values for every group field. */
  effective: EffectiveReadingSettings
  /** The book's stored groups; a group's presence is its enablement. */
  groups: BookSettingGroups
  /** Enable (captures edits into the group) or disable + clear a group. */
  setGroupEnabled: (group: BookSettingsGroup | 'theme', enabled: boolean) => void
  /** Write one field: into the book's group when enabled, else the shared chain. */
  updateField: (key: string, value: number | boolean | string) => void
  /** This device's per-book font picks (undefined = none); writes stay local. */
  bookDeviceFonts?: BookDeviceFontSelection
  setBookDeviceFont: (slot: 'primary' | 'cjk', fontId: string | null) => void
  /** Reading preset bound to this book; null when unbound. */
  boundPresetId: string | null
  /** Bind/unbind a reading preset to this book. */
  setBoundPreset: (presetId: string | null) => void
  /** Per-book theme group state (absent = theme edits go global). */
  bookTheme?: ReaderBookThemeSettings
  /** Resolved appearance for the current reading slot (global + book layers). */
  appearance: ResolvedAppearance
  /** Theme tab writes, routed by the theme group's enablement. */
  pickTheme: (themeId: string) => void
  pickPalette: (paletteId: string) => void
  setCss: (mode: 'off' | 'card', cssId?: string | null) => void
  toggleHighlight: (ruleId: string) => void
}

export const ViewSettingsContext = createContext<ViewSettingsContextValue | null>(null)

export function useViewSettings(): ViewSettingsContextValue | null {
  return useContext(ViewSettingsContext)
}

export type { ReaderBookSlotTheme }
