import { cfiSpineIndex, createEpubCfiTextOffset, createEpubCfiTextRange, resolveEpubCfiTextRange } from './epub-cfi-position'
import type { RevisionMapSegment, RevisionSectionPosition } from './revision-map'

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
): { cfi: string | null | undefined; chapterHref: string } | null {
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
    if (segmentMatches.length !== 1) return null
    const segment = segmentMatches[0]!
    if (!segment.targetSpineHref) return null
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

