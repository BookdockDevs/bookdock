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
// Gap refinement: interior gaps between order-consistent reliable segments are
// proven correspondences, so a bounded local diff can recover precise offsets
// for anchors that fall inside them (typically an edited region with a typo
// fix). The size cap bounds the per-character optimality DP; larger gaps stay
// unmapped. Ambiguous character correspondences stay unmapped.
const GAP_REFINEMENT_MAX_CHARS = 512
const GAP_REFINEMENT_EDIT_BUDGET = 256

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
  const refined = refinedInteriorGapSegments(source, target, result)
  if (!refined.length) return result
  const output: RevisionMapSegment[] = []
  for (let index = 0; index < result.length; index += 1) {
    output.push(result[index]!)
    if (index < refined.length) output.push(...refined[index]!)
  }
  return output
}

interface GapEqualRun { aStart: number; bStart: number; length: number }

/**
 * Bounded Myers diff over a small gap pair; returns the diagonal (equal) runs
 * in gap-local coordinates, or null when the edit distance exceeds the budget.
 */
function boundedGapEqualRuns(a: string, b: string, editBudget: number): GapEqualRun[] | null {
  if (Math.abs(a.length - b.length) > editBudget) return null
  const furthest = new Map<number, number>([[1, 0]])
  const trace: Array<Map<number, number>> = []
  for (let d = 0; d <= editBudget; d += 1) {
    trace.push(new Map(furthest))
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (furthest.get(k - 1) ?? Number.POSITIVE_INFINITY) < (furthest.get(k + 1) ?? Number.NEGATIVE_INFINITY))) {
        x = furthest.get(k + 1) ?? 0
      } else {
        x = (furthest.get(k - 1) ?? 0) + 1
      }
      let y = x - k
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x += 1
        y += 1
      }
      furthest.set(k, x)
      if (x >= a.length && y >= b.length) return backtrackGapEqualRuns(a, b, trace)
    }
  }
  return null
}

function backtrackGapEqualRuns(a: string, b: string, trace: Array<Map<number, number>>): GapEqualRun[] {
  const diagonals: Array<{ x: number; y: number }> = []
  let x = a.length
  let y = b.length
  for (let d = trace.length - 1; x > 0 || y > 0; d -= 1) {
    const furthest = trace[d] ?? trace[0]!
    const k = x - y
    const prevK = k === -d || (k !== d && (furthest.get(k - 1) ?? Number.POSITIVE_INFINITY) < (furthest.get(k + 1) ?? Number.NEGATIVE_INFINITY))
      ? k + 1
      : k - 1
    const prevX = furthest.get(prevK) ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      diagonals.push({ x: x - 1, y: y - 1 })
      x -= 1
      y -= 1
    }
    if (d > 0) {
      if (x === prevX) y -= 1
      else x -= 1
    }
  }
  diagonals.reverse()
  const runs: GapEqualRun[] = []
  for (const diagonal of diagonals) {
    const current = runs.at(-1)
    if (current && current.aStart + current.length === diagonal.x && current.bStart + current.length === diagonal.y) {
      current.length += 1
    } else runs.push({ aStart: diagonal.x, bStart: diagonal.y, length: 1 })
  }
  return runs
}

/**
 * Forward/backward indel-only edit-distance tables over a gap pair, indexed
 * [i * width + j]. The tables let the refinement prove, per matched character,
 * that its correspondence is identical in every optimal alignment.
 */
interface GapAlignmentTables {
  forward: Int32Array
  backward: Int32Array
  width: number
  total: number
}

function gapAlignmentTables(a: string, b: string): GapAlignmentTables {
  const width = b.length + 1
  const height = a.length + 1
  const unreachable = a.length + b.length + 1
  const forward = new Int32Array(width * height)
  const backward = new Int32Array(width * height)
  for (let j = 0; j <= b.length; j += 1) forward[j] = j
  for (let i = 1; i <= a.length; i += 1) {
    forward[i * width] = i
    for (let j = 1; j <= b.length; j += 1) {
      const diagonal = a[i - 1] === b[j - 1] ? forward[(i - 1) * width + j - 1] : unreachable
      forward[i * width + j] = Math.min(forward[(i - 1) * width + j] + 1, forward[i * width + j - 1] + 1, diagonal)
    }
  }
  for (let i = 0; i <= a.length; i += 1) backward[i * width + b.length] = a.length - i
  for (let j = b.length - 1; j >= 0; j -= 1) backward[a.length * width + j] = b.length - j
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const diagonal = a[i] === b[j] ? backward[(i + 1) * width + j + 1] : unreachable
      backward[i * width + j] = Math.min(backward[(i + 1) * width + j] + 1, backward[i * width + j + 1] + 1, diagonal)
    }
  }
  return { forward, backward, width, total: forward[height * width - 1] }
}

/**
 * Whether the match of a[s] to b[t] is the only way source character s is
 * consumed by ANY optimal alignment of the gap pair: the match edge must lie
 * on an optimal path, no other occurrence of the character may pair with s on
 * one, and no optimal path may delete s. Only then is the correspondence
 * provable — identical characters elsewhere make the re-reading check blind.
 */
function gapCharCorrespondenceForced(tables: GapAlignmentTables, a: string, b: string, s: number, t: number): boolean {
  const { forward, backward, width, total } = tables
  if (forward[s * width + t] + backward[(s + 1) * width + t + 1] !== total) return false
  for (let other = 0; other < b.length; other += 1) {
    if (other !== t && b[other] === a[s] && forward[s * width + other] + backward[(s + 1) * width + other + 1] === total) return false
  }
  for (let j = 0; j <= b.length; j += 1) {
    if (forward[s * width + j] + 1 + backward[(s + 1) * width + j] === total) return false
  }
  return true
}

/**
 * Refines interior gaps between consecutive reliable segments. The gap pair is
 * a proven correspondence (both gaps sit between the same matched anchors), so
 * a bounded local diff recovers exact offsets. From each equal run the diff
 * proposes, only the stretches whose per-character correspondence is identical
 * across every optimal alignment are emitted — whole-run uniqueness does not
 * prove interior pairings (identical characters inside or beside the run can
 * re-pair between equally optimal alignments, and the verbatim re-check cannot
 * catch that). Repeated runs, oversized gaps and edits beyond the distance
 * budget remain unmapped.
 */
function refinedInteriorGapSegments(source: string, target: string, segments: RevisionMapSegment[]): RevisionMapSegment[][] {
  const refined: RevisionMapSegment[][] = []
  for (let index = 0; index + 1 < segments.length; index += 1) {
    const previous = segments[index]!
    const next = segments[index + 1]!
    const sourceGap = source.slice(previous.sourceEnd, next.sourceStart)
    const targetGap = target.slice(previous.targetEnd, next.targetStart)
    const runs = sourceGap.length > 0 && targetGap.length > 0
      && sourceGap.length <= GAP_REFINEMENT_MAX_CHARS && targetGap.length <= GAP_REFINEMENT_MAX_CHARS
      ? boundedGapEqualRuns(sourceGap, targetGap, GAP_REFINEMENT_EDIT_BUDGET)
      : null
    const tables = runs?.length ? gapAlignmentTables(sourceGap, targetGap) : null
    refined.push((runs ?? []).flatMap((run) => {
      const emitted: RevisionMapSegment[] = []
      let stretchStart = -1
      for (let k = 0; k <= run.length; k += 1) {
        const forced = tables !== null && k < run.length
          && gapCharCorrespondenceForced(tables, sourceGap, targetGap, run.aStart + k, run.bStart + k)
        if (forced && stretchStart < 0) stretchStart = k
        if (!forced && stretchStart >= 0) {
          const sourceStart = previous.sourceEnd + run.aStart + stretchStart
          const targetStart = previous.targetEnd + run.bStart + stretchStart
          emitted.push({
            sourceStart,
            sourceEnd: sourceStart + k - stretchStart,
            targetStart,
            targetEnd: targetStart + k - stretchStart,
          })
          stretchStart = -1
        }
      }
      return emitted
    }))
  }
  return refined
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

export { projectRevisionCoverage } from './revision-coverage'

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
