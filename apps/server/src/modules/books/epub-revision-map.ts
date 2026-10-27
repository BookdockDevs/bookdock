import { DOMParser, Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'

import { loadEpubSpineMarkup } from '../../formats/epub'
import type { RevisionMapSegment, RevisionSectionPosition, RevisionTextRange } from './revision-map'
import { createRevisionMap } from './revision-map'

interface TextSection extends RevisionSectionPosition {
  text: string
  start: number
  structuralRanges: RevisionTextRange[]
  headingRange?: { start: number; end: number }
}

function extractSections(markup: { href: string; markup: string }[]): TextSection[] {
  return markup.map(({ href, markup: source }) => {
    const document = new DOMParser().parseFromString(source, 'application/xhtml+xml')
    const body = document.getElementsByTagName('body')[0]
    if (!body) throw new Error('EPUB spine document is missing body')
    let text = ''
    let title: string | undefined
    let headingRange: { start: number; end: number } | undefined
    const structuralRanges: RevisionTextRange[] = []
    const visit = (node: XmlNode) => {
      if (node.nodeType === 3 || node.nodeType === 4) {
        const value = node.nodeValue ?? ''
        const start = text.length
        text += value
        if (value && /^\s+$/.test(value)) structuralRanges.push({ spineHref: href, start, end: text.length })
        return
      }
      const isHeading = node.nodeType === 1 && (node as XmlElement).localName?.toLowerCase() === 'h1'
      const start = text.length
      for (let child = node.firstChild; child; child = child.nextSibling) visit(child)
      if (isHeading && text.length > start) {
        structuralRanges.push({ spineHref: href, start, end: text.length })
        if (!title) {
          title = text.slice(start, text.length)
          headingRange = { start, end: text.length }
        }
      }
    }
    for (let child = body.firstChild; child; child = child.nextSibling) visit(child)
    return {
      spineHref: href,
      size: Buffer.byteLength(source),
      textLength: text.length,
      ...(title ? { title } : {}),
      text,
      start: 0,
      structuralRanges,
      ...(headingRange ? { headingRange } : {}),
    }
  })
}

function withOffsets(sections: TextSection[]): { sections: TextSection[]; text: string } {
  let text = ''
  for (const section of sections) {
    section.start = text.length
    text += section.text + '\u0000'
  }
  return { sections, text }
}

function sectionAt(sections: TextSection[], offset: number): TextSection | undefined {
  return sections.find((section) => offset >= section.start && offset < section.start + section.textLength)
}

function splitMapBySpine(
  segments: RevisionMapSegment[],
  sourceSections: TextSection[],
  targetSections: TextSection[],
): RevisionMapSegment[] {
  const result: RevisionMapSegment[] = []
  for (const segment of segments) {
    const cuts = new Set([segment.sourceStart, segment.sourceEnd])
    for (const section of sourceSections) {
      for (const boundary of [section.start, section.start + section.textLength]) {
        if (boundary > segment.sourceStart && boundary < segment.sourceEnd) cuts.add(boundary)
      }
    }
    for (const section of targetSections) {
      for (const boundary of [section.start, section.start + section.textLength]) {
        const sourceBoundary = segment.sourceStart + boundary - segment.targetStart
        if (sourceBoundary > segment.sourceStart && sourceBoundary < segment.sourceEnd) cuts.add(sourceBoundary)
      }
    }
    const orderedCuts = [...cuts].sort((a, b) => a - b)
    for (let index = 0; index < orderedCuts.length - 1; index += 1) {
      const sourceStart = orderedCuts[index]!
      const sourceEnd = orderedCuts[index + 1]!
      const targetStart = segment.targetStart + sourceStart - segment.sourceStart
      const targetEnd = targetStart + sourceEnd - sourceStart
      const source = sectionAt(sourceSections, sourceStart)
      const target = sectionAt(targetSections, targetStart)
      if (!source || !target || sourceEnd > source.start + source.textLength || targetEnd > target.start + target.textLength) continue
      result.push({
        sourceSpineHref: source.spineHref,
        targetSpineHref: target.spineHref,
        sourceStart: sourceStart - source.start,
        sourceEnd: sourceEnd - source.start,
        targetStart: targetStart - target.start,
        targetEnd: targetEnd - target.start,
      })
    }
  }
  return result
}

export async function createEpubRevisionMap(
  sourceEpub: Buffer,
  targetEpub: Buffer,
  structuralHeadingIndexes: readonly number[] = [],
): Promise<{
  segments: RevisionMapSegment[]
  sourceSections: RevisionSectionPosition[]
  targetSections: RevisionSectionPosition[]
  structuralRanges: RevisionTextRange[]
}> {
  const [sourceMarkup, targetMarkup] = await Promise.all([
    loadEpubSpineMarkup(sourceEpub),
    loadEpubSpineMarkup(targetEpub),
  ])
  const source = withOffsets(extractSections(sourceMarkup))
  const target = withOffsets(extractSections(targetMarkup))
  const sharedHrefs = new Set(target.sections.map((section) => section.spineHref))
  const sourceCommonOrder = source.sections.map((section) => section.spineHref).filter((href) => sharedHrefs.has(href))
  const targetHrefs = new Set(source.sections.map((section) => section.spineHref))
  const targetCommonOrder = target.sections.map((section) => section.spineHref).filter((href) => targetHrefs.has(href))
  const orderPreserved = sourceCommonOrder.length === targetCommonOrder.length
    && sourceCommonOrder.every((href, index) => href === targetCommonOrder[index])
  const ambiguousTargets = new Set(target.sections.filter((targetSection) => {
    if (!targetSection.text.length) return false
    const sourceMatches = new Set(source.sections.filter((sourceSection) => sourceSection.text === targetSection.text)
      .map((sourceSection) => sourceSection.spineHref))
    const targetMatches = new Set(target.sections.filter((candidate) => candidate.text === targetSection.text)
      .map((candidate) => candidate.spineHref))
    return sourceMatches.size > targetMatches.size
  }).map((section) => section.spineHref))
  const segments = (orderPreserved
    ? splitMapBySpine(createRevisionMap(source.text, target.text), source.sections, target.sections)
    : target.sections.flatMap((targetSection) => {
        const sourceSection = source.sections.find((section) => section.spineHref === targetSection.spineHref)
        if (!sourceSection) return []
        return createRevisionMap(sourceSection.text, targetSection.text).map((segment) => ({
          sourceSpineHref: sourceSection.spineHref,
          targetSpineHref: targetSection.spineHref,
          sourceStart: segment.sourceStart,
          sourceEnd: segment.sourceEnd,
          targetStart: segment.targetStart,
          targetEnd: segment.targetEnd,
        }))
      })).filter((segment) => !ambiguousTargets.has(segment.targetSpineHref ?? ''))
  return {
    segments,
    sourceSections: source.sections,
    targetSections: target.sections,
    structuralRanges: target.sections.flatMap((section, index) => {
      const heading = section.headingRange
      if (!structuralHeadingIndexes.includes(index) || !heading) return []
      const body = segments.filter((segment) => segment.targetSpineHref === section.spineHref && segment.targetStart >= heading.end)
        .sort((a, b) => a.targetStart - b.targetStart)[0]
      return body?.sourceSpineHref ? section.structuralRanges.map((range) => ({
        ...range,
        sourceSpineHref: body.sourceSpineHref,
        sourceOffset: body.sourceStart,
      })) : []
    }),
  }
}

export async function extractEpubSpineText(epub: Buffer): Promise<Map<string, string>> {
  const sections = extractSections(await loadEpubSpineMarkup(epub))
  return new Map(sections.map((section) => [section.spineHref, section.text]))
}
