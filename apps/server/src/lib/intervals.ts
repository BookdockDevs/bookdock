export type FractionInterval = [number, number]

function normalize(all: FractionInterval[]): FractionInterval[] {
  const sorted = [...all].sort((a, b) => a[0] - b[0])
  const merged: FractionInterval[] = []
  for (const [s, e] of sorted) {
    if (e <= s) continue
    const last = merged[merged.length - 1]
    // Touching intervals (s === last end) merge: segmented tracking closes a
    // segment exactly where the next one begins, so gaps would be artificial.
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e)
    } else {
      merged.push([s, e])
    }
  }
  return merged
}

export function mergeInterval(intervals: FractionInterval[], interval: FractionInterval): FractionInterval[] {
  return normalize([...intervals, interval])
}

export function unionLength(intervals: FractionInterval[]): number {
  return normalize(intervals).reduce((total, [s, e]) => total + (e - s), 0)
}
