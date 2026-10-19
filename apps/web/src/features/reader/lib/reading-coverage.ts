export function addReadingCoverage(coverage: Array<[number, number]>, from: number, to: number): Array<[number, number]> {
  if (from === to) return coverage
  const sorted = [...coverage, [Math.min(from, to), Math.max(from, to)] as [number, number]]
    .sort((left, right) => left[0] - right[0])
  const merged: Array<[number, number]> = []
  for (const interval of sorted) {
    const previous = merged.at(-1)
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1])
    else merged.push([...interval])
  }
  return merged
}
