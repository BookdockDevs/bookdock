import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SHARE_CARD_PREFS,
  cardColors,
  loadShareCardPrefs,
  nextBrand,
  saveShareCardPrefs,
} from '../features/reader/components/share/card-prefs'

describe('loadShareCardPrefs', () => {
  beforeEach(() => localStorage.clear())

  it('returns defaults when nothing is stored', () => {
    expect(loadShareCardPrefs()).toEqual(DEFAULT_SHARE_CARD_PREFS)
  })

  it('round-trips saved prefs', () => {
    saveShareCardPrefs({ template: 'ink', font: 'kaiti', background: 'navy', brand: 'zh' })
    expect(loadShareCardPrefs()).toEqual({ template: 'ink', font: 'kaiti', background: 'navy', brand: 'zh' })
  })

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('bd-share-card-prefs', '{oops')
    expect(loadShareCardPrefs()).toEqual(DEFAULT_SHARE_CARD_PREFS)
  })

  it('falls back per-field on unknown values', () => {
    localStorage.setItem(
      'bd-share-card-prefs',
      JSON.stringify({ template: 'hologram', font: 'kaiti', background: 'plaid', brand: 'hologram' }),
    )
    expect(loadShareCardPrefs()).toEqual({
      template: DEFAULT_SHARE_CARD_PREFS.template,
      font: 'kaiti',
      background: DEFAULT_SHARE_CARD_PREFS.background,
      brand: DEFAULT_SHARE_CARD_PREFS.brand,
    })
  })

  it('keeps any non-empty font id (builtin/uploaded registry ids)', () => {
    saveShareCardPrefs({ template: 'ink', font: 'lxgw-wenkai', background: 'navy', brand: 'zh' })
    expect(loadShareCardPrefs().font).toBe('lxgw-wenkai')
    saveShareCardPrefs({ template: 'ink', font: 'some-uploaded-id', background: 'navy', brand: 'zh' })
    expect(loadShareCardPrefs().font).toBe('some-uploaded-id')
  })

  it('falls back to the default font on empty or non-string values', () => {
    localStorage.setItem('bd-share-card-prefs', JSON.stringify({ font: '' }))
    expect(loadShareCardPrefs().font).toBe(DEFAULT_SHARE_CARD_PREFS.font)
    localStorage.setItem('bd-share-card-prefs', JSON.stringify({ font: 42 }))
    expect(loadShareCardPrefs().font).toBe(DEFAULT_SHARE_CARD_PREFS.font)
  })

  it('defaults brand for prefs saved before the brand field existed', () => {
    localStorage.setItem('bd-share-card-prefs', JSON.stringify({ template: 'ink', font: 'kaiti', background: 'navy' }))
    expect(loadShareCardPrefs().brand).toBe(DEFAULT_SHARE_CARD_PREFS.brand)
  })
})

describe('nextBrand', () => {
  it('cycles off → en → zh → off', () => {
    expect(nextBrand('off')).toBe('en')
    expect(nextBrand('en')).toBe('zh')
    expect(nextBrand('zh')).toBe('off')
  })
})

describe('cardColors', () => {
  it('inverts text on dark backgrounds', () => {
    expect(cardColors('cream').text).toBe('#1c1917')
    expect(cardColors('black').text).toBe('#f5f5f4')
    expect(cardColors('navy').bg).toBe('#1f2a52')
  })
})
