import { describe, it, expect } from 'vitest'

import { createSegmentTracker, trackPosition, JUMP_THRESHOLD } from '../features/reader/stats/reading-segments'

describe('reading segment tracker', () => {
  it('starts the first segment at the first position', () => {
    const tracker = createSegmentTracker()
    expect(trackPosition(tracker, 0.35)).toBe(0.35)
  })

  it('keeps the segment start while paging continuously', () => {
    const tracker = createSegmentTracker()
    expect(trackPosition(tracker, 0.10)).toBe(0.10)
    expect(trackPosition(tracker, 0.11)).toBe(0.10)
    expect(trackPosition(tracker, 0.12)).toBe(0.10)
    expect(trackPosition(tracker, 0.115)).toBe(0.10)
  })

  it('closes the segment on a forward jump', () => {
    const tracker = createSegmentTracker()
    trackPosition(tracker, 0.10)
    trackPosition(tracker, 0.11)
    expect(trackPosition(tracker, 0.50)).toBe(0.50)
    expect(trackPosition(tracker, 0.51)).toBe(0.50)
  })

  it('closes the segment on a backward jump', () => {
    const tracker = createSegmentTracker()
    trackPosition(tracker, 0.50)
    expect(trackPosition(tracker, 0.20)).toBe(0.20)
    expect(trackPosition(tracker, 0.21)).toBe(0.20)
  })

  it('resets on every jump when bouncing back and forth', () => {
    const tracker = createSegmentTracker()
    trackPosition(tracker, 0.10)
    expect(trackPosition(tracker, 0.50)).toBe(0.50)
    expect(trackPosition(tracker, 0.10)).toBe(0.10)
    expect(trackPosition(tracker, 0.50)).toBe(0.50)
  })

  it('treats a displacement just below the threshold as continuous', () => {
    const tracker = createSegmentTracker()
    trackPosition(tracker, 0.10)
    expect(trackPosition(tracker, 0.10 + JUMP_THRESHOLD / 2)).toBe(0.10)
  })
})
