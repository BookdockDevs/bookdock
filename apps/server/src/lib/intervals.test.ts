import { describe, it, expect } from 'vitest'

import { mergeInterval, unionLength } from './intervals'

describe('mergeInterval', () => {
  it('inserts a disjoint interval in order', () => {
    expect(mergeInterval([[0.5, 0.6]], [0.1, 0.2])).toEqual([[0.1, 0.2], [0.5, 0.6]])
  })

  it('merges overlapping intervals', () => {
    expect(mergeInterval([[0.1, 0.4]], [0.3, 0.6])).toEqual([[0.1, 0.6]])
  })

  it('merges adjacent (touching) intervals', () => {
    expect(mergeInterval([[0.1, 0.3]], [0.3, 0.5])).toEqual([[0.1, 0.5]])
  })

  it('drops a new interval fully contained in an existing one', () => {
    expect(mergeInterval([[0.1, 0.6]], [0.2, 0.4])).toEqual([[0.1, 0.6]])
  })

  it('swallows existing intervals contained in the new one', () => {
    expect(mergeInterval([[0.2, 0.3], [0.5, 0.6]], [0.1, 0.7])).toEqual([[0.1, 0.7]])
  })

  it('bridges multiple existing intervals', () => {
    expect(mergeInterval([[0.1, 0.2], [0.3, 0.4], [0.8, 0.9]], [0.15, 0.35])).toEqual([[0.1, 0.4], [0.8, 0.9]])
  })

  it('handles unordered existing intervals', () => {
    expect(mergeInterval([[0.8, 0.9], [0.1, 0.2]], [0.5, 0.6])).toEqual([[0.1, 0.2], [0.5, 0.6], [0.8, 0.9]])
  })

  it('drops degenerate zero-length intervals', () => {
    expect(mergeInterval([[0, 0]], [0.1, 0.2])).toEqual([[0.1, 0.2]])
  })
})

describe('unionLength', () => {
  it('sums disjoint lengths', () => {
    expect(unionLength([[0.1, 0.2], [0.5, 0.9]])).toBeCloseTo(0.5)
  })

  it('counts overlaps only once', () => {
    expect(unionLength([[0.1, 0.5], [0.4, 0.6]])).toBeCloseTo(0.5)
  })

  it('returns 0 for no intervals', () => {
    expect(unionLength([])).toBe(0)
  })
})
