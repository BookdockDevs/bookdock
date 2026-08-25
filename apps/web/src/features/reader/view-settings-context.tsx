import { createContext, useContext } from 'react'

import type { ViewSettings } from '@bookdock/shared'

import type { EffectiveViewSettings, PerBookSettingKey } from './lib/view-settings'

// Per-book reading-settings layer (F1). Provided by Reader.tsx; consumed by
// SettingsPanel (display + writes) and the "仅本书" toggle. useReaderRenderer
// receives the effective values as a prop instead, keeping it context-free.
export interface ViewSettingsContextValue {
  effective: EffectiveViewSettings
  /** Whether changes to the supported settings apply to this book only */
  perBookActive: boolean
  setPerBookActive: (active: boolean) => void
  updateSetting: (key: PerBookSettingKey, value: number) => void
  /**
   * Raw per-book override diff (book.meta.viewSettings). Preset creation
   * overlays it onto the snapshot so a preset made while 仅本书 is on captures
   * the effective (WYSIWYG) values.
   */
  perBookDiff?: ViewSettings
  /** Reading preset bound to this book (book.meta.boundPresetId); null when unbound */
  boundPresetId: string | null
  /** Bind/unbind a reading preset to this book (PATCH books.meta.boundPresetId) */
  setBoundPreset: (presetId: string | null) => void
}

export const ViewSettingsContext = createContext<ViewSettingsContextValue | null>(null)

export function useViewSettings(): ViewSettingsContextValue | null {
  return useContext(ViewSettingsContext)
}
