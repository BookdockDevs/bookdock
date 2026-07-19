import { describe, it, expect } from 'vitest'

import {
  parseHex,
  toHex,
  hexToHsl,
  hslToHex,
  mix,
  lighten,
  darken,
  relativeLuminance,
  isDark,
} from '../lib/color'

describe('color utils', () => {
  it('parseHex supports 6- and 3-digit forms', () => {
    expect(parseHex('#aabbcc')).toEqual([170, 187, 204])
    expect(parseHex('#abc')).toEqual([170, 187, 204])
    expect(parseHex('aabbcc')).toEqual([170, 187, 204])
  })

  it('parseHex rejects invalid input', () => {
    expect(() => parseHex('#12')).toThrow()
    expect(() => parseHex('nope')).toThrow()
  })

  it('toHex clamps and pads channels', () => {
    expect(toHex(255, 0, 16)).toBe('#ff0010')
    expect(toHex(300, -5, 127.5)).toBe('#ff0080')
  })

  it('hsl round-trips a saturated color', () => {
    const { h, s, l } = hexToHsl('#3b82f6')
    expect(hslToHex(h, s, l)).toBe('#3b82f6')
  })

  it('hexToHsl treats gray as achromatic', () => {
    const { h, s } = hexToHsl('#808080')
    expect(h).toBe(0)
    expect(s).toBe(0)
  })

  it('mix interpolates linearly by weight', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('lighten/darken move toward white/black', () => {
    expect(lighten('#000000', 50)).toBe('#808080')
    expect(darken('#ffffff', 50)).toBe('#808080')
    expect(lighten('#123456', 0)).toBe('#123456')
    expect(darken('#123456', 0)).toBe('#123456')
  })

  it('relativeLuminance matches WCAG anchors', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(relativeLuminance('#000000')).toBe(0)
  })

  it('isDark classifies extremes', () => {
    expect(isDark('#000000')).toBe(true)
    expect(isDark('#ffffff')).toBe(false)
    expect(isDark('#111111')).toBe(true)
    expect(isDark('#F4F4F4')).toBe(false)
  })
})
