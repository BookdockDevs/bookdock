import { describe, expect, it } from 'vitest'

import { readerBookSettingsSchema } from '@bookdock/shared'
import { themeSelectionForSlot, writeThemeSelectionForSlot } from '@/features/reading-theme/theme-library'

const cream = { mode: 'theme', themeId: 'cream' } as const
const night = { mode: 'theme', themeId: 'night' } as const

describe('per-tone theme selection', () => {
  it('keeps the other tone when one side is picked', () => {
    const onlyDay = writeThemeSelectionForSlot(null, 'light', cream)
    const both = writeThemeSelectionForSlot(onlyDay, 'dark', night)
    expect(both).toEqual({ mode: 'slots', light: cream, dark: night })
    expect(themeSelectionForSlot(both, 'light')).toEqual(cream)
    expect(themeSelectionForSlot(both, 'dark')).toEqual(night)
  })

  it('leaves the untouched tone on the chain when only one side is pinned', () => {
    const onlyDay = writeThemeSelectionForSlot(null, 'light', cream)
    expect(themeSelectionForSlot(onlyDay, 'dark')).toBeNull()
  })

  it('applies a legacy single selection to both tones until the first write splits it', () => {
    expect(themeSelectionForSlot(cream, 'light')).toEqual(cream)
    expect(themeSelectionForSlot(cream, 'dark')).toEqual(cream)
    // Splitting must not silently drop the legacy scheme from the other tone.
    expect(writeThemeSelectionForSlot(cream, 'dark', night)).toEqual({ mode: 'slots', light: cream, dark: night })
  })

  it('clears the current slot and removes the override when both slots are empty', () => {
    const both = { mode: 'slots', light: cream, dark: night } as const
    const followDay = writeThemeSelectionForSlot(both, 'light', null)
    expect(themeSelectionForSlot(followDay, 'light')).toBeNull()
    expect(themeSelectionForSlot(followDay, 'dark')).toEqual(night)
    expect(writeThemeSelectionForSlot(followDay, 'dark', null)).toBeNull()
    expect(writeThemeSelectionForSlot(cream, 'light', null)).toEqual({ mode: 'slots', light: null, dark: cream })
  })

  it('accepts both the legacy and the per-tone shape on the wire', () => {
    expect(readerBookSettingsSchema.safeParse({ themeSelection: cream }).success).toBe(true)
    expect(readerBookSettingsSchema.safeParse({ themeSelection: { mode: 'slots', light: cream, dark: null } }).success).toBe(true)
    expect(readerBookSettingsSchema.safeParse({ themeSelection: { mode: 'slots' } }).success).toBe(true)
    expect(readerBookSettingsSchema.safeParse({ themeSelection: { mode: 'nope' } }).success).toBe(false)
  })
})
