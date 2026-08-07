import { describe, it, expect } from 'vitest'

import {
  createSegmentTracker,
  trackPosition,
  closeSegment,
  jumpThresholdOf,
  JUMP_THRESHOLD,
} from '../features/reader/stats/reading-segments'

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

  it('scales the threshold down for many-chapter books (2 chapter widths)', () => {
    // 2% of 774 chapters is ~15 chapters — far too coarse for jump detection
    const tracker = createSegmentTracker(774)
    expect(jumpThresholdOf(tracker)).toBeCloseTo(2 / 774)
    trackPosition(tracker, 0.10)
    // a ~1.5-chapter move stays continuous
    expect(trackPosition(tracker, 0.10 + 1.5 / 774)).toBeCloseTo(0.10)
    // a 3-chapter move closes the segment
    expect(trackPosition(tracker, 0.10 + 3 / 774)).toBeCloseTo(0.10 + 3 / 774)
  })

  it('keeps the plain 2% threshold for small books', () => {
    const tracker = createSegmentTracker(10)
    expect(jumpThresholdOf(tracker)).toBe(JUMP_THRESHOLD)
  })

  it('closeSegment makes the next position start a fresh segment (jump stretch excluded)', () => {
    const tracker = createSegmentTracker()
    trackPosition(tracker, 0.10)
    trackPosition(tracker, 0.12)
    closeSegment(tracker)
    // the jump to 0.50 never joins the previous segment
    expect(trackPosition(tracker, 0.50)).toBe(0.50)
    expect(trackPosition(tracker, 0.51)).toBe(0.50)
  })
})
