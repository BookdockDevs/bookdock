import { describe, expect, it } from 'vitest'

import { resolveEffectiveReadingThemeId } from '../lib/reading-theme'

describe('resolveEffectiveReadingThemeId', () => {
  it('uses the remembered light theme when the system is light', () => {
    expect(resolveEffectiveReadingThemeId('system', 'light', 'cream')).toBe('cream')
  })

  it('uses night when the system is dark', () => {
    expect(resolveEffectiveReadingThemeId('system', 'dark', 'cream')).toBe('night')
  })

  it('keeps manual light and dark modes independent from the system', () => {
    expect(resolveEffectiveReadingThemeId('light', 'dark', 'sepia')).toBe('sepia')
    expect(resolveEffectiveReadingThemeId('dark', 'light', 'sepia')).toBe('night')
  })
})
