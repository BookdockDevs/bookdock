export interface RevisionMapSegment {
  sourceSpineHref?: string
  targetSpineHref?: string
  sourceStart: number
  sourceEnd: number
  targetStart: number
  targetEnd: number
}

export interface RevisionSectionPosition {
  spineHref: string
  size: number
  textLength: number
  title?: string
}

export interface RevisionTextRange {
  spineHref: string
  start: number
  end: number
  sourceSpineHref?: string
  sourceOffset?: number
}

const ANCHOR_SIZE = 64

function nonOverlapping(segments: readonly RevisionMapSegment[], start: 'sourceStart' | 'targetStart', end: 'sourceEnd' | 'targetEnd') {
  const spineKey = start === 'sourceStart' ? 'sourceSpineHref' : 'targetSpineHref'
  const ordered = [...segments].sort((a, b) => (a[spineKey] ?? '').localeCompare(b[spineKey] ?? '')
    || a[start] - b[start] || a[end] - b[end])
  const accepted: RevisionMapSegment[] = []
  const acceptedEnds = new Map<string, number>()
  for (const segment of ordered) {
    const group = segment[spineKey] ?? ''
    if (!acceptedEnds.has(group) || segment[start] >= acceptedEnds.get(group)!) {
      accepted.push(segment)
      acceptedEnds.set(group, segment[end])
    }
  }
  return accepted
}

function hashWindow(text: string, start: number, windowSize: number): number {
  let hash = 0
  for (let index = start; index < start + windowSize; index += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) >>> 0
  return hash
}

function indexTargetWindows(text: string, windowSize: number): Map<number, { start: number; duplicate: boolean }> {
  const windows = new Map<number, { start: number; duplicate: boolean }>()
  if (text.length < windowSize) return windows
  let hash = hashWindow(text, 0, windowSize)
  let power = 1
  for (let index = 1; index < windowSize; index += 1) power = Math.imul(power, 31) >>> 0
  for (let start = 0; start + windowSize <= text.length; start += 1) {
    if (start > 0) {
      hash = (Math.imul((hash - Math.imul(text.charCodeAt(start - 1), power)) >>> 0, 31) + text.charCodeAt(start + windowSize - 1)) >>> 0
    }
    const prior = windows.get(hash)
    if (prior) prior.duplicate = true
    else windows.set(hash, { start, duplicate: false })
  }
  return windows
}

export function createRevisionMap(source: string, target: string): RevisionMapSegment[] {
  if (source === target && source.length > 0) return [{ sourceStart: 0, sourceEnd: source.length, targetStart: 0, targetEnd: target.length }]
  if (source.length > 0 && target.startsWith(source) && target.indexOf(source, 1) < 0) {
    return [{ sourceStart: 0, sourceEnd: source.length, targetStart: 0, targetEnd: source.length }]
  }
  const shortestText = Math.min(source.length, target.length)
  const windowSize = Math.min(ANCHOR_SIZE, shortestText, Math.max(8, Math.floor(shortestText / 4)))
  if (windowSize === 0) return []
  const sourceWindows = new Map<number, { start: number; duplicate: boolean }>()
  const sampleStep = Math.max(1, Math.floor(windowSize / 2))
  for (let start = 0; start + windowSize <= source.length; start += sampleStep) {
    const hash = hashWindow(source, start, windowSize)
    const prior = sourceWindows.get(hash)
    if (prior) prior.duplicate = true
    else sourceWindows.set(hash, { start, duplicate: false })
  }
  const targetWindows = indexTargetWindows(target, windowSize)
  const anchors: RevisionMapSegment[] = []

  for (const [hash, sourceWindow] of sourceWindows) {
    const sourceStart = sourceWindow.start
    const text = source.slice(sourceStart, sourceStart + windowSize)
    const targetWindow = targetWindows.get(hash)
    if (sourceWindow.duplicate || !targetWindow || targetWindow.duplicate || target.slice(targetWindow.start, targetWindow.start + windowSize) !== text) continue
    anchors.push({
      sourceStart,
      sourceEnd: sourceStart + windowSize,
      targetStart: targetWindow.start,
      targetEnd: targetWindow.start + windowSize,
    })
  }

  const sourceOrdered = nonOverlapping(anchors, 'sourceStart', 'sourceEnd')
  const targetOrdered = nonOverlapping(sourceOrdered, 'targetStart', 'targetEnd')
  const accepted = new Set(targetOrdered)

  const result: RevisionMapSegment[] = []
  const append = (sourceStart: number, sourceEnd: number, targetStart: number, targetEnd: number) => {
    if (sourceEnd <= sourceStart || targetEnd <= targetStart) return
    const previous = result.at(-1)
    if (previous?.sourceEnd === sourceStart && previous.targetEnd === targetStart) {
      previous.sourceEnd = sourceEnd
      previous.targetEnd = targetEnd
    } else result.push({ sourceStart, sourceEnd, targetStart, targetEnd })
  }
  let previousSourceEnd = 0
  let previousTargetEnd = 0
  let hasPreviousAnchor = false
  for (const anchor of sourceOrdered) {
    if (!accepted.has(anchor)) continue
    const sourceGap = source.slice(previousSourceEnd, anchor.sourceStart)
    const targetGap = target.slice(previousTargetEnd, anchor.targetStart)
    if (hasPreviousAnchor && anchor.targetStart >= previousTargetEnd
      && sourceGap.length > 0 && sourceGap.length === targetGap.length && sourceGap === targetGap) {
      append(previousSourceEnd, anchor.sourceStart, previousTargetEnd, anchor.targetStart)
    }
    append(anchor.sourceStart, anchor.sourceEnd, anchor.targetStart, anchor.targetEnd)
    previousSourceEnd = anchor.sourceEnd
    previousTargetEnd = anchor.targetEnd
    hasPreviousAnchor = true
  }
  for (let index = 0; index < result.length; index += 1) {
    const segment = result[index]!
    const previous = result[index - 1]
    const next = result[index + 1]
    while (segment.sourceStart > (previous?.sourceEnd ?? 0)
      && segment.targetStart > (previous?.targetEnd ?? 0)
      && source[segment.sourceStart - 1] === target[segment.targetStart - 1]) {
      segment.sourceStart -= 1
      segment.targetStart -= 1
    }
    while (segment.sourceEnd < (next?.sourceStart ?? source.length)
      && segment.targetEnd < (next?.targetStart ?? target.length)
      && source[segment.sourceEnd] === target[segment.targetEnd]) {
      segment.sourceEnd += 1
      segment.targetEnd += 1
    }
  }
  return result
}

export function composeRevisionMaps(
  first: readonly RevisionMapSegment[],
  second: readonly RevisionMapSegment[],
): RevisionMapSegment[] {
  const composed: RevisionMapSegment[] = []
  const firstBySpine = new Map<string, RevisionMapSegment[]>()
  const secondBySpine = new Map<string, RevisionMapSegment[]>()
  for (const segment of first) {
    const spineHref = segment.targetSpineHref ?? ''
    const group = firstBySpine.get(spineHref) ?? []
    group.push(segment)
    firstBySpine.set(spineHref, group)
  }
  for (const segment of second) {
    const spineHref = segment.sourceSpineHref ?? ''
    const group = secondBySpine.get(spineHref) ?? []
    group.push(segment)
    secondBySpine.set(spineHref, group)
  }
  for (const [spineHref, firstSegments] of firstBySpine) {
    const secondSegments = secondBySpine.get(spineHref)
    if (!secondSegments) continue
    const leftSegments = [...firstSegments].sort((a, b) => a.targetStart - b.targetStart)
    const rightSegments = [...secondSegments].sort((a, b) => a.sourceStart - b.sourceStart)
    let leftIndex = 0
    let rightIndex = 0
    while (leftIndex < leftSegments.length && rightIndex < rightSegments.length) {
      const left = leftSegments[leftIndex]!
      const right = rightSegments[rightIndex]!
      const middleStart = Math.max(left.targetStart, right.sourceStart)
      const middleEnd = Math.min(left.targetEnd, right.sourceEnd)
      if (middleEnd > middleStart) composed.push({
        ...(left.sourceSpineHref ? { sourceSpineHref: left.sourceSpineHref } : {}),
        ...(right.targetSpineHref ? { targetSpineHref: right.targetSpineHref } : {}),
        sourceStart: left.sourceStart + middleStart - left.targetStart,
        sourceEnd: left.sourceStart + middleEnd - left.targetStart,
        targetStart: right.targetStart + middleStart - right.sourceStart,
        targetEnd: right.targetStart + middleEnd - right.sourceStart,
      })
      if (left.targetEnd <= right.sourceEnd) leftIndex += 1
      else rightIndex += 1
    }
  }
  return nonOverlapping(nonOverlapping(composed, 'sourceStart', 'sourceEnd'), 'targetStart', 'targetEnd')
}

export function mapRevisionOffset(segments: readonly RevisionMapSegment[], offset: number, sourceSpineHref?: string): number | null {
  const matches = segments.filter((segment) => (segment.sourceSpineHref ?? undefined) === sourceSpineHref
    && offset >= segment.sourceStart && offset < segment.sourceEnd)
  if (matches.length !== 1) return null
  const segment = matches[0]!
  return segment.targetStart + offset - segment.sourceStart
}

export { projectRevisionCoverage } from '../../lib/revision-coverage'

export function mapRevisionFraction(
  fraction: number,
  sourceSections: readonly RevisionSectionPosition[],
  targetSections: readonly RevisionSectionPosition[],
  segments: readonly RevisionMapSegment[],
): { fraction: number; spineHref: string; chapterIndex: number; title?: string } | null {
  if (!Number.isFinite(fraction)) return null
  const sourceTotal = sourceSections.reduce((sum, section) => sum + Math.max(0, section.size), 0)
  const targetTotal = targetSections.reduce((sum, section) => sum + Math.max(0, section.size), 0)
  if (sourceTotal <= 0 || targetTotal <= 0) return null
  const sourcePosition = Math.max(0, Math.min(fraction, 1)) * sourceTotal
  let sourceStart = 0
  let source: RevisionSectionPosition | undefined
  for (let index = 0; index < sourceSections.length; index += 1) {
    const section = sourceSections[index]!
    const end = sourceStart + Math.max(0, section.size)
    if (sourcePosition <= end && section.size > 0) {
      source = section
      break
    }
    sourceStart = end
  }
  if (!source || source.textLength <= 0) return null
  const sourceOffset = ((sourcePosition - sourceStart) / source.size) * source.textLength
  const candidates = segments.filter((segment) => segment.sourceSpineHref === source.spineHref
    && sourceOffset >= segment.sourceStart && sourceOffset <= segment.sourceEnd)
  if (candidates.length !== 1) return null
  const segment = candidates[0]!
  const targetIndex = targetSections.findIndex((section) => section.spineHref === segment.targetSpineHref)
  const target = targetSections[targetIndex]
  if (!target || target.textLength <= 0 || targetIndex < 0) return null
  const targetOffset = segment.targetStart + sourceOffset - segment.sourceStart
  let targetStart = 0
  for (let index = 0; index < targetIndex; index += 1) targetStart += Math.max(0, targetSections[index]!.size)
  const targetPosition = targetStart + (targetOffset / target.textLength) * target.size
  return {
    fraction: targetPosition / targetTotal,
    spineHref: target.spineHref,
    chapterIndex: targetIndex,
    ...(target.title ? { title: target.title } : {}),
  }
}

export function mapRevisionTextPosition(
  spineHref: string,
  textOffset: number,
  targetSections: readonly RevisionSectionPosition[],
  segments: readonly RevisionMapSegment[],
): { fraction: number; spineHref: string; textOffset: number; chapterIndex: number; title?: string } | null {
  if (!Number.isFinite(textOffset) || textOffset < 0) return null
  const candidates = segments.filter((segment) => segment.sourceSpineHref === spineHref
    && textOffset >= segment.sourceStart && textOffset <= segment.sourceEnd)
  if (candidates.length !== 1) return null
  const segment = candidates[0]!
  const targetIndex = targetSections.findIndex((section) => section.spineHref === segment.targetSpineHref)
  const target = targetSections[targetIndex]
  if (!target || targetIndex < 0 || target.textLength <= 0) return null
  const mappedOffset = segment.targetStart + textOffset - segment.sourceStart
  const totalSize = targetSections.reduce((sum, section) => sum + Math.max(0, section.size), 0)
  if (totalSize <= 0) return null
  let before = 0
  for (let index = 0; index < targetIndex; index += 1) before += Math.max(0, targetSections[index]!.size)
  const fraction = (before + mappedOffset / target.textLength * target.size) / totalSize
  return {
    fraction,
    spineHref: target.spineHref,
    textOffset: mappedOffset,
    chapterIndex: targetIndex,
    ...(target.title ? { title: target.title } : {}),
  }
}
