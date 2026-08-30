import { describe, expect, it } from 'vitest'

import { resolveClickDirection, shouldArmPending, ttsHighlightColor, turnsCrossChapter, ttsViewportAction } from '../FoliateReader'

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

describe('ttsViewportAction', () => {
  const viewport = { top: 100, bottom: 900, height: 800 }

  it('keeps sentences that are comfortably visible', () => {
    expect(ttsViewportAction({ top: 180, bottom: 700 }, viewport)).toBe('stay')
  })

  it('turns when the next sentence reaches the bottom safe zone', () => {
    expect(ttsViewportAction({ top: 760, bottom: 820 }, viewport)).toBe('advance')
    expect(ttsViewportAction({ top: 920, bottom: 980 }, viewport)).toBe('advance')
  })

  it('uses the first line instead of the full bounding box for long sentences', () => {
    expect(ttsViewportAction(
      { top: 180, bottom: 1120 },
      viewport,
      { top: 180, bottom: 220 },
    )).toBe('stay')
  })

  it('turns when the first line itself reaches the bottom safe zone', () => {
    expect(ttsViewportAction(
      { top: 760, bottom: 1120 },
      viewport,
      { top: 760, bottom: 820 },
    )).toBe('advance')
  })

  it('does not turn again for a long sentence already at the top', () => {
    expect(ttsViewportAction({ top: 102, bottom: 1100 }, viewport)).toBe('stay')
  })

  it('returns to a sentence that is fully above the viewport', () => {
    expect(ttsViewportAction({ top: -120, bottom: 80 }, viewport)).toBe('return')
  })
})

describe('ttsHighlightColor', () => {
  it('derives the highlight from the active theme instead of a fixed color', () => {
    expect(ttsHighlightColor({ bg: '#ffffff', text: '#000000', primary: '#336699' })).toBe('#668cb3')
    expect(ttsHighlightColor({ bg: '#202020', text: '#ffffff', primary: '#d97706' })).toBe('#ab610d')
  })

  it('falls back to the theme text when a primary color is unavailable', () => {
    expect(ttsHighlightColor({ bg: '#ffffff', text: '#000000' })).toBe('#404040')
  })
})
