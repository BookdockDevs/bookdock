import { cfiSpineIndex, createEpubCfiTextOffset, createEpubCfiTextRange, resolveEpubCfiTextRange } from './epub-cfi-position'
import type { RevisionMapSegment, RevisionSectionPosition } from './revision-map'

export interface AnnotationAnchorFragment {
  cfi: string
  chapterHref: string
}

export interface MappedAnnotationAnchor {
  cfi: string | null | undefined
  chapterHref: string
  /** Present only when the anchor migrated partially: every surviving portion. */
  fragments?: AnnotationAnchorFragment[]
}

export function mapPointReplacementAnchor(
  row: { spineHref: string | null; textOffset: number | null; originalText: string | null },
  segments: RevisionMapSegment[],
  sourceTexts: Map<string, string>,
  targetTexts: Map<string, string>,
): { spineHref: string; textOffset: number } | null {
  const href = row.spineHref
  const offset = row.textOffset
  const snapshot = row.originalText
  if (!href || offset === null || !snapshot || offset < 0) return null
  const sourceText = sourceTexts.get(href)
  if (!sourceText || sourceText.slice(offset, offset + snapshot.length) !== snapshot) return null
  const unchangedText = targetTexts.get(href)
  const repeatedTextSectionsRemoved = [...sourceTexts.values()].filter((text) => text === sourceText).length
    > [...targetTexts.values()].filter((text) => text === sourceText).length
  if (unchangedText === sourceText && !repeatedTextSectionsRemoved) return { spineHref: href, textOffset: offset }
  const end = offset + snapshot.length
  const matches = segments.filter((segment) => segment.sourceSpineHref === href
    && offset >= segment.sourceStart && end <= segment.sourceEnd)
  if (matches.length !== 1) return null
  const segment = matches[0]!
  const targetOffset = segment.targetStart + offset - segment.sourceStart
  const targetText = targetTexts.get(segment.targetSpineHref ?? '')
  if (!targetText || targetText.slice(targetOffset, targetOffset + snapshot.length) !== snapshot) return null
  return { spineHref: segment.targetSpineHref!, textOffset: targetOffset }
}

export function mapAnnotationAnchor(
  cfi: string | null | undefined,
  chapterHref: string | null | undefined,
  sourceSections: RevisionSectionPosition[],
  targetSections: RevisionSectionPosition[],
  sourceTexts: Map<string, string>,
  targetTexts: Map<string, string>,
  sourceMarkups: Map<string, string>,
  targetMarkups: Map<string, string>,
  segments: RevisionMapSegment[],
): MappedAnnotationAnchor | null {
  const cfiIndex = cfi ? cfiSpineIndex(cfi) : null
  const sourceIndex = chapterHref
    ? sourceSections.findIndex((section) => section.spineHref === chapterHref)
    : cfiIndex
  if (sourceIndex === null || sourceIndex < 0) return null
  if (cfiIndex !== null && cfiIndex !== sourceIndex) return null
  const source = sourceSections[sourceIndex]
  if (!source || sourceTexts.get(source.spineHref) === undefined) return null
  const targetIndex = targetSections.findIndex((section) => section.spineHref === source.spineHref)
  if (!cfi) return null
  const sourceText = sourceTexts.get(source.spineHref)
  const targetText = targetTexts.get(source.spineHref)
  const sourceMarkup = sourceMarkups.get(source.spineHref)
  const targetMarkup = targetMarkups.get(source.spineHref)
  if (!sourceText) return null
  const repeatedSectionsRemoved = sourceSections.filter((section) => sourceTexts.get(section.spineHref) === sourceText).length
    > targetSections.filter((section) => targetTexts.get(section.spineHref) === sourceText).length
  if (targetIndex >= 0 && !repeatedSectionsRemoved && sourceText === targetText && sourceMarkup && sourceMarkup === targetMarkup) {
    if (targetIndex !== sourceIndex && cfiIndex === null) return null
    const mappedCfi = targetIndex === sourceIndex ? cfi : cfi.replace(
      /^epubcfi\(\/6\/\d+/, `epubcfi(/6/${(targetIndex + 1) * 2}`,
    )
    if (!mappedCfi || (targetIndex !== sourceIndex && mappedCfi === cfi)) return null
    return { cfi: mappedCfi, chapterHref: source.spineHref }
  }
  if (!sourceMarkup) return null
  const sourceRange = resolveEpubCfiTextRange(sourceMarkup, cfi)
  if (!sourceRange) return null
  let targetHref = source.spineHref
  let targetStart = sourceRange.start
  let targetEnd = sourceRange.end
  if (targetIndex < 0 || sourceText !== targetText || repeatedSectionsRemoved) {
    const segmentMatches = segments.filter((segment) => segment.sourceSpineHref === source.spineHref
      && sourceRange.start >= segment.sourceStart
      && (sourceRange.start === sourceRange.end
        ? sourceRange.start < segment.sourceEnd
        : sourceRange.end <= segment.sourceEnd))
    const segment = segmentMatches.length === 1 ? segmentMatches[0]! : undefined
    if (!segment || !segment.targetSpineHref) {
      return mapSurvivingRangeFragments(sourceRange, source.spineHref, sourceText,
        segments, targetSections, targetTexts, targetMarkups)
    }
    targetHref = segment.targetSpineHref
    targetStart = segment.targetStart + sourceRange.start - segment.sourceStart
    targetEnd = segment.targetStart + sourceRange.end - segment.sourceStart
  }
  const targetSectionIndex = targetSections.findIndex((section) => section.spineHref === targetHref)
  const mappedTargetMarkup = targetMarkups.get(targetHref)
  const mappedTargetText = targetTexts.get(targetHref)
  if (targetSectionIndex < 0 || !mappedTargetMarkup || mappedTargetText === undefined) return null
  if (mappedTargetText.slice(targetStart, targetEnd) !== sourceText.slice(sourceRange.start, sourceRange.end)) return null
  const mappedCfi = targetStart === targetEnd
    ? createEpubCfiTextOffset(mappedTargetMarkup, targetSectionIndex, targetStart)
    : createEpubCfiTextRange(mappedTargetMarkup, targetSectionIndex, targetStart, targetEnd)
  return mappedCfi ? { cfi: mappedCfi, chapterHref: targetHref } : null
}

/**
 * Partial survival for range anchors: intersect the source range with every
 * reliable segment of the section, verify each surviving piece verbatim at the
 * target, and keep the anchor located while any piece survives. Point anchors
 * never enter here (empty intersections). Segments already guarantee equal
 * text, but each piece is re-verified so a stale map can never move an anchor.
 */
function mapSurvivingRangeFragments(
  sourceRange: { start: number; end: number },
  sourceSpineHref: string,
  sourceText: string,
  segments: RevisionMapSegment[],
  targetSections: RevisionSectionPosition[],
  targetTexts: Map<string, string>,
  targetMarkups: Map<string, string>,
): MappedAnnotationAnchor | null {
  if (sourceRange.end <= sourceRange.start) return null
  const pieces = segments
    .filter((segment) => segment.sourceSpineHref === sourceSpineHref && segment.targetSpineHref)
    .map((segment) => {
      const pieceStart = Math.max(sourceRange.start, segment.sourceStart)
      const pieceEnd = Math.min(sourceRange.end, segment.sourceEnd)
      return {
        pieceStart, pieceEnd,
        targetHref: segment.targetSpineHref!,
        targetStart: segment.targetStart + pieceStart - segment.sourceStart,
        targetEnd: segment.targetStart + pieceEnd - segment.sourceStart,
      }
    })
    .filter((piece) => piece.pieceEnd > piece.pieceStart)
    .sort((a, b) => a.pieceStart - b.pieceStart || a.pieceEnd - b.pieceEnd)
  const merged: Array<typeof pieces[number]> = []
  for (const piece of pieces) {
    const previous = merged.at(-1)
    if (previous && previous.pieceEnd === piece.pieceStart && previous.targetHref === piece.targetHref
      && previous.targetEnd === piece.targetStart) {
      previous.pieceEnd = piece.pieceEnd
      previous.targetEnd = piece.targetEnd
    } else merged.push(piece)
  }
  const fragments: Array<AnnotationAnchorFragment & { length: number }> = []
  for (const piece of merged) {
    const targetSectionIndex = targetSections.findIndex((section) => section.spineHref === piece.targetHref)
    const targetText = targetTexts.get(piece.targetHref)
    const markup = targetMarkups.get(piece.targetHref)
    if (targetSectionIndex < 0 || targetText === undefined || !markup) continue
    if (targetText.slice(piece.targetStart, piece.targetEnd) !== sourceText.slice(piece.pieceStart, piece.pieceEnd)) continue
    const fragmentCfi = createEpubCfiTextRange(markup, targetSectionIndex, piece.targetStart, piece.targetEnd)
    if (!fragmentCfi) continue
    fragments.push({ cfi: fragmentCfi, chapterHref: piece.targetHref, length: piece.pieceEnd - piece.pieceStart })
  }
  if (!fragments.length) return null
  const primary = fragments.reduce((best, fragment) => (fragment.length > best.length ? fragment : best), fragments[0]!)
  return {
    cfi: primary.cfi,
    chapterHref: primary.chapterHref,
    fragments: fragments.map(({ cfi, chapterHref }) => ({ cfi, chapterHref })),
  }
}

/**
 * Migrates an annotation anchor together with its retained surviving
 * fragments. Every attempt (the primary CFI first, then each retained
 * fragment) migrates every round, and the survivors are unioned into the new
 * evidence — a fragment must not be dropped just because the primary CFI
 * still maps, or a later edit deleting the primary would lose a fragment that
 * is still alive. The primary CFI stays stable while it keeps mapping;
 * otherwise the first surviving fragment takes over. Fragmented results are
 * returned only when more than one piece survives: a single surviving piece
 * is fully covered by the primary CFI plus partial survival on later saves.
 */
export function mapAnnotationAnchorWithEvidence(
  cfi: string | null | undefined,
  chapterHref: string | null | undefined,
  evidence: readonly AnnotationAnchorFragment[] | null | undefined,
  sourceSections: RevisionSectionPosition[],
  targetSections: RevisionSectionPosition[],
  sourceTexts: Map<string, string>,
  targetTexts: Map<string, string>,
  sourceMarkups: Map<string, string>,
  targetMarkups: Map<string, string>,
  segments: RevisionMapSegment[],
): MappedAnnotationAnchor | null {
  const attempts: Array<{ cfi: string; chapterHref: string | null | undefined }> = []
  if (cfi) attempts.push({ cfi, chapterHref })
  for (const fragment of evidence ?? []) {
    if (fragment.cfi !== cfi) attempts.push(fragment)
  }
  const survivors: AnnotationAnchorFragment[] = []
  let primary: AnnotationAnchorFragment | null = null
  for (const attempt of attempts) {
    const mapped = mapAnnotationAnchor(attempt.cfi, attempt.chapterHref, sourceSections, targetSections,
      sourceTexts, targetTexts, sourceMarkups, targetMarkups, segments)
    if (!mapped?.cfi) continue
    const pieces = mapped.fragments ?? [{ cfi: mapped.cfi, chapterHref: mapped.chapterHref }]
    survivors.push(...pieces)
    if (!primary && attempt.cfi === cfi) primary = { cfi: mapped.cfi, chapterHref: mapped.chapterHref }
  }
  if (!survivors.length) return null
  const chosen = primary ?? survivors[0]!
  return {
    cfi: chosen.cfi,
    chapterHref: chosen.chapterHref,
    ...(survivors.length > 1 ? { fragments: survivors } : {}),
  }
}
