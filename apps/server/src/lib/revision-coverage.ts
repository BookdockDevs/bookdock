export interface RevisionCoverageSection {
  spineHref: string
  size: number
  textLength: number
  title?: string
}

export interface RevisionCoverageRange {
  spineHref: string
  start: number
  end: number
  sourceSpineHref?: string
  sourceOffset?: number
}

export interface RevisionCoverageSegment {
  sourceSpineHref?: string
  targetSpineHref?: string
  sourceStart: number
  sourceEnd: number
  targetStart: number
  targetEnd: number
}

export function projectRevisionCoverage(
  intervals: readonly [number, number][],
  sourceSections: readonly RevisionCoverageSection[],
  targetSections: readonly RevisionCoverageSection[],
  segments: readonly RevisionCoverageSegment[],
  structuralRanges: readonly RevisionCoverageRange[] = [],
): [number, number][] {
  if (!intervals.length) return []
  const sourceTotal = sourceSections.reduce((sum, section) => sum + Math.max(0, section.size), 0)
  const targetTotal = targetSections.reduce((sum, section) => sum + Math.max(0, section.size), 0)
  if (sourceTotal <= 0 || targetTotal <= 0) return []
  const sourceStarts = new Map<string, number>()
  const targetStarts = new Map<string, number>()
  let sourceCursor = 0
  for (const section of sourceSections) {
    sourceStarts.set(section.spineHref, sourceCursor)
    sourceCursor += Math.max(0, section.size)
  }
  let targetCursor = 0
  for (const section of targetSections) {
    targetStarts.set(section.spineHref, targetCursor)
    targetCursor += Math.max(0, section.size)
  }

  const projected: [number, number][] = []
  for (const [rawStart, rawEnd] of intervals) {
    const intervalStart = Math.max(0, Math.min(rawStart, rawEnd, 1))
    const intervalEnd = Math.max(0, Math.min(Math.max(rawStart, rawEnd), 1))
    if (intervalEnd <= intervalStart) continue
    for (const segment of segments) {
      if (!segment.sourceSpineHref || !segment.targetSpineHref) continue
      const source = sourceSections.find((section) => section.spineHref === segment.sourceSpineHref)
      const target = targetSections.find((section) => section.spineHref === segment.targetSpineHref)
      const sourceStartBytes = sourceStarts.get(segment.sourceSpineHref)
      const targetStartBytes = targetStarts.get(segment.targetSpineHref)
      if (!source || !target || sourceStartBytes === undefined || targetStartBytes === undefined
        || source.size <= 0 || target.size <= 0 || source.textLength <= 0 || target.textLength <= 0) continue
      const segmentStart = (sourceStartBytes + (segment.sourceStart / source.textLength) * source.size) / sourceTotal
      const segmentEnd = (sourceStartBytes + (segment.sourceEnd / source.textLength) * source.size) / sourceTotal
      const overlapStart = Math.max(intervalStart, segmentStart)
      const overlapEnd = Math.min(intervalEnd, segmentEnd)
      if (overlapEnd <= overlapStart || segmentEnd <= segmentStart) continue
      const sourceStart = ((overlapStart * sourceTotal - sourceStartBytes) / source.size) * source.textLength
      const sourceEnd = ((overlapEnd * sourceTotal - sourceStartBytes) / source.size) * source.textLength
      const mappedStart = segment.targetStart + sourceStart - segment.sourceStart
      const mappedEnd = segment.targetStart + sourceEnd - segment.sourceStart
      const targetStart = (targetStartBytes + (mappedStart / target.textLength) * target.size) / targetTotal
      const targetEnd = (targetStartBytes + (mappedEnd / target.textLength) * target.size) / targetTotal
      projected.push([Math.max(0, targetStart), Math.min(1, targetEnd)])
    }
  }
  for (const range of structuralRanges) {
    if (!range.sourceSpineHref || range.sourceOffset === undefined) continue
    const source = sourceSections.find((section) => section.spineHref === range.sourceSpineHref)
    const sourceStartBytes = sourceStarts.get(range.sourceSpineHref)
    if (!source || sourceStartBytes === undefined || source.size <= 0 || source.textLength <= 0) continue
    const sourcePosition = (sourceStartBytes + (range.sourceOffset / source.textLength) * source.size) / sourceTotal
    const inherited = intervals.some(([start, end]) => sourcePosition >= Math.min(start, end) && sourcePosition <= Math.max(start, end))
    if (!inherited) continue
    const target = targetSections.find((section) => section.spineHref === range.spineHref)
    const targetStartBytes = targetStarts.get(range.spineHref)
    if (!target || targetStartBytes === undefined || target.size <= 0 || target.textLength <= 0) continue
    projected.push([
      Math.max(0, (targetStartBytes + (range.start / target.textLength) * target.size) / targetTotal),
      Math.min(1, (targetStartBytes + (range.end / target.textLength) * target.size) / targetTotal),
    ])
  }
  projected.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: [number, number][] = []
  for (const interval of projected) {
    if (interval[1] <= interval[0]) continue
    const previous = merged.at(-1)
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1])
    else merged.push([...interval])
  }
  return merged
}
