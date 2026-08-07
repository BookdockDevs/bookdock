// A relocate displacement larger than this means the user navigated (TOC, seek
// bar, search) instead of reading through, so the current segment closes.
// Scaled by chapter count: 2% of a 774-chapter book is ~15 chapters, so big
// books cap the threshold at two chapter widths. Explicit user jumps (display,
// scrollToPercent, scroll-mode next/prev) call closeSegment() directly and
// never rely on this heuristic; it only backstops unexplicit ones (fast fling
// scrolls, paginator-internal wheel snap-turns).
export const JUMP_THRESHOLD = 0.02
export const JUMP_CHAPTERS = 2

export interface SegmentTracker {
  segmentStart: number | null
  lastPosition: number | null
  /** Book chapter count; the displacement threshold scales with it */
  chapterCount: number
}

export function createSegmentTracker(chapterCount = 0): SegmentTracker {
  return { segmentStart: null, lastPosition: null, chapterCount }
}

export function jumpThresholdOf(tracker: SegmentTracker): number {
  if (tracker.chapterCount <= 0) return JUMP_THRESHOLD
  return Math.min(JUMP_THRESHOLD, JUMP_CHAPTERS / tracker.chapterCount)
}

export function trackPosition(tracker: SegmentTracker, fraction: number): number {
  if (tracker.segmentStart === null || tracker.lastPosition === null) {
    tracker.segmentStart = fraction
  } else if (Math.abs(fraction - tracker.lastPosition) > jumpThresholdOf(tracker)) {
    tracker.segmentStart = fraction
  }
  tracker.lastPosition = fraction
  return tracker.segmentStart
}

// Explicit user navigation (TOC click, progress seek, search/bookmark jump,
// scroll-mode next/prev chapter switch): close the segment so the jump stretch
// never joins the read-union. The next relocate starts a fresh segment at the
// target. Page turns that merely cross a chapter boundary must NOT close —
// that page was actually read.
export function closeSegment(tracker: SegmentTracker) {
  tracker.segmentStart = null
}
