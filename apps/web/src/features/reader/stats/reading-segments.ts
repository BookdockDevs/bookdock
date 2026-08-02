// A relocate jump larger than this means the user navigated (TOC, seek bar,
// search) instead of reading through, so the current segment closes.
export const JUMP_THRESHOLD = 0.02

export interface SegmentTracker {
  segmentStart: number | null
  lastPosition: number | null
}

export function createSegmentTracker(): SegmentTracker {
  return { segmentStart: null, lastPosition: null }
}

export function trackPosition(tracker: SegmentTracker, fraction: number): number {
  if (tracker.segmentStart === null || tracker.lastPosition === null) {
    tracker.segmentStart = fraction
  } else if (Math.abs(fraction - tracker.lastPosition) > JUMP_THRESHOLD) {
    tracker.segmentStart = fraction
  }
  tracker.lastPosition = fraction
  return tracker.segmentStart
}
