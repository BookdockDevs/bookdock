import { describe, expect, it } from 'vitest'

import { resolveClickDirection, shouldArmPending, turnsCrossChapter } from '../FoliateReader'

// container spans x = 100..700 (width 600)
function dir(x: number, mode: 'standard' | 'fullscreen' | 'swap' | 'none' = 'standard') {
  return resolveClickDirection(x, 100, 600, mode)
}

describe('resolveClickDirection', () => {
  it('standard: left prev, right next, middle toggles chrome', () => {
    expect(dir(110)).toBe('prev')
    expect(dir(250)).toBe('prev')
    expect(dir(300)).toBe('toggle')
    expect(dir(499)).toBe('toggle')
    expect(dir(510)).toBe('next')
    expect(dir(690)).toBe('next')
  })

  it('fullscreen: both sides turn next, middle toggles chrome', () => {
    expect(dir(110, 'fullscreen')).toBe('next')
    expect(dir(690, 'fullscreen')).toBe('next')
    expect(dir(300, 'fullscreen')).toBe('toggle')
  })

  it('swap swaps left and right, middle toggles chrome', () => {
    expect(dir(110, 'swap')).toBe('next')
    expect(dir(690, 'swap')).toBe('prev')
    expect(dir(300, 'swap')).toBe('toggle')
  })

  it('none disables turning but keeps the middle chrome toggle', () => {
    expect(dir(110, 'none')).toBe(null)
    expect(dir(690, 'none')).toBe(null)
    expect(dir(300, 'none')).toBe('toggle')
  })

  it('clicks outside the container or zero-width are ignored', () => {
    expect(resolveClickDirection(50, 100, 600, 'standard')).toBe(null)
    expect(resolveClickDirection(200, 100, 0, 'standard')).toBe(null)
  })
})

describe('turnsCrossChapter', () => {
  it('next crosses only from the section\'s last page', () => {
    // pages 6 → pages - 2 = 4 (paginator's own crossing math)
    expect(turnsCrossChapter(1, 1, 6)).toBe(false)
    expect(turnsCrossChapter(1, 4, 6)).toBe(true)
    expect(turnsCrossChapter(1, 5, 6)).toBe(true)
  })

  it('prev crosses only from the first page', () => {
    expect(turnsCrossChapter(-1, 1, 6)).toBe(true)
    expect(turnsCrossChapter(-1, 2, 6)).toBe(false)
    expect(turnsCrossChapter(-1, 5, 6)).toBe(false)
  })

  it('unknown page geometry defaults to crossing', () => {
    expect(turnsCrossChapter(1, undefined, 6)).toBe(true)
    expect(turnsCrossChapter(-1, 3, undefined)).toBe(true)
  })
})

describe('shouldArmPending', () => {
  const warm = new Set(['ch1.xhtml', 'ch2.xhtml'])

  const book = {
    sections: [
      { id: 'ch1.xhtml' },
      { id: 'ch2.xhtml' },
      { id: 'ch3.xhtml', linear: 'no' },
      { id: 'ch4.xhtml' },
      { id: 'ch5.xhtml' },
    ],
    loadSectionText: { has: (id: string) => warm.has(id) },
  }

  it('warm adjacent target does not arm (prefetched text)', () => {
    expect(shouldArmPending(1, book, 0)).toBe(false)
    expect(shouldArmPending(-1, book, 1)).toBe(false)
  })

  it('cold adjacent target arms (prefetch miss)', () => {
    expect(shouldArmPending(1, book, 3)).toBe(true)
  })

  it('missing target never arms (book start/end)', () => {
    expect(shouldArmPending(-1, book, 0)).toBe(false)
    expect(shouldArmPending(1, book, 4)).toBe(false)
  })

  it('non-linear target never arms (cannot be turned into)', () => {
    expect(shouldArmPending(1, book, 1)).toBe(false)
  })

  it('no book or no warmth API defaults to arming', () => {
    expect(shouldArmPending(1, null, 0)).toBe(false)
    expect(shouldArmPending(1, { sections: [{ id: 'a.xhtml' }, { id: 'b.xhtml' }] }, 0)).toBe(true)
  })
})
