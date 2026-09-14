import { describe, expect, it } from 'vitest'

import {
  captureScrollModeAnchor,
  computePaginatedScroll,
  computeSpreadInlineMargins,
  computeSpreadSpineOverlap,
  planScrollModePages,
  restoreScrollModeAnchor,
  scrollGapToCss,
} from '../../public/foliate-js/fixed-layout.js'

describe('foliate fixed-layout compatibility helpers', () => {
  it('captures and restores a scroll-mode page anchor', () => {
    const pages = [
      { index: 3, top: 0, height: 800 },
      { index: 4, top: 820, height: 1000 },
    ]
    const anchor = captureScrollModeAnchor(pages, 1_020)

    expect(anchor).toEqual({ index: 4, fraction: 0.2, scrollTop: 1020 })
    expect(restoreScrollModeAnchor(pages, anchor, 1_500)).toBe(1_020)
  })

  it('prioritizes nearby visible pages and evicts distant idle pages', () => {
    const result = planScrollModePages({
      currentIndex: 4,
      maxLoaded: 2,
      maxConcurrent: 2,
      loadingCount: 0,
      pages: [
        { index: 3, visible: true, state: 'idle' },
        { index: 5, visible: true, state: 'idle' },
        { index: 8, visible: false, state: 'loaded' },
        { index: 9, visible: false, state: 'loaded' },
        { index: 4, visible: true, state: 'loaded' },
      ],
    })

    expect(result.load).toEqual([3, 5])
    expect(result.evict).toEqual([9])
  })

  it('keeps fixed-layout spread geometry stable at page boundaries', () => {
    expect(computePaginatedScroll({
      elementWidth: 1_200,
      containerWidth: 1_000,
      scrollTop: 40,
      pageTurn: true,
    })).toEqual({ scrollLeft: 100, scrollTop: 0 })
    expect(computeSpreadSpineOverlap({ devicePixelRatio: 2 })).toBe(-0.5)
    expect(computeSpreadSpineOverlap({ portrait: true, devicePixelRatio: 2 })).toBe(0)
    expect(computeSpreadInlineMargins(true).left).toEqual({
      marginInlineStart: 'auto',
      marginInlineEnd: 'auto',
    })
  })

  it('normalizes scroll gap values without creating invalid CSS', () => {
    expect(scrollGapToCss('12')).toBe('12px')
    expect(scrollGapToCss('-1')).toBeNull()
    expect(scrollGapToCss('invalid')).toBeNull()
  })
})
