import { describe, expect, it } from 'vitest'

import {
  continuousScrollBackwardTarget,
  continuousScrollNeedsBuffer,
} from '../../../../../public/foliate-js/paginator.js'

describe('continuousScrollNeedsBuffer', () => {
  it('loads ahead when the requested screen would reach the rendered end', () => {
    expect(continuousScrollNeedsBuffer(920, 920)).toBe(true)
    expect(continuousScrollNeedsBuffer(922, 920)).toBe(true)
  })

  it('does not wait when the current buffer can satisfy the screen', () => {
    expect(continuousScrollNeedsBuffer(923, 920)).toBe(false)
  })

  it('rejects incomplete geometry', () => {
    expect(continuousScrollNeedsBuffer(Number.NaN, 920)).toBe(false)
    expect(continuousScrollNeedsBuffer(920, Number.NaN)).toBe(false)
  })
})

describe('continuousScrollBackwardTarget', () => {
  it('replays the requested wheel distance after prepending history', () => {
    expect(continuousScrollBackwardTarget(920, -120)).toBe(800)
    expect(continuousScrollBackwardTarget(80, -120)).toBe(0)
  })

  it('does not turn a forward or invalid wheel distance into a backward jump', () => {
    expect(continuousScrollBackwardTarget(920, 120)).toBe(920)
    expect(continuousScrollBackwardTarget(920, Number.NaN)).toBe(920)
  })
})
