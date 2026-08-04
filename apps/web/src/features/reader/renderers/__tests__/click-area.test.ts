import { describe, expect, it } from 'vitest'

import { resolveClickDirection } from '../FoliateReader'

// container spans x = 100..700 (width 600)
function dir(x: number, mode: 'standard' | 'fullscreen' | 'swap' | 'none' = 'standard') {
  return resolveClickDirection(x, 100, 600, mode)
}

describe('resolveClickDirection', () => {
  it('standard: left prev, right next, middle null', () => {
    expect(dir(110)).toBe('prev')
    expect(dir(250)).toBe('prev')
    expect(dir(300)).toBe(null)
    expect(dir(499)).toBe(null)
    expect(dir(510)).toBe('next')
    expect(dir(690)).toBe('next')
  })

  it('fullscreen: both sides turn next', () => {
    expect(dir(110, 'fullscreen')).toBe('next')
    expect(dir(690, 'fullscreen')).toBe('next')
    expect(dir(300, 'fullscreen')).toBe(null)
  })

  it('swap swaps left and right', () => {
    expect(dir(110, 'swap')).toBe('next')
    expect(dir(690, 'swap')).toBe('prev')
    expect(dir(300, 'swap')).toBe(null)
  })

  it('none disables everything', () => {
    expect(dir(110, 'none')).toBe(null)
    expect(dir(690, 'none')).toBe(null)
    expect(dir(300, 'fullscreen')).toBe(null)
  })

  it('clicks outside the container or zero-width are ignored', () => {
    expect(resolveClickDirection(50, 100, 600, 'standard')).toBe(null)
    expect(resolveClickDirection(200, 100, 0, 'standard')).toBe(null)
  })
})
