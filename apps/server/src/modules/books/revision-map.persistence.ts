import { and, eq } from 'drizzle-orm'

import { contentRevisionMaps } from '../../db/schema'
import { createId } from '../../lib/id'
import { composeRevisionMaps, type RevisionMapSegment, type RevisionSectionPosition, type RevisionTextRange } from './revision-map'

type MapWriter = Pick<ReturnType<typeof import('../../db/client').getDb>, 'select' | 'insert'>

export function composeRevisionStructuralRanges(
  priorRanges: RevisionTextRange[],
  priorSegments: RevisionMapSegment[],
  directSegments: RevisionMapSegment[],
  directRanges: RevisionTextRange[],
): RevisionTextRange[] {
  const carriedRanges = priorRanges.flatMap((range) => {
    const segment = directSegments.find((candidate) => candidate.sourceSpineHref === range.spineHref
      && range.start >= candidate.sourceStart && range.end <= candidate.sourceEnd)
    return segment ? [{
      ...range,
      spineHref: segment.targetSpineHref ?? range.spineHref,
      start: segment.targetStart + range.start - segment.sourceStart,
      end: segment.targetStart + range.end - segment.sourceStart,
    }] : []
  })
  const newlyStructuralRanges = directRanges.flatMap((range) => {
    if (!range.sourceSpineHref || range.sourceOffset === undefined) return []
    const sources = priorSegments.filter((segment) => segment.targetSpineHref === range.sourceSpineHref
      && range.sourceOffset! >= segment.targetStart && range.sourceOffset! <= segment.targetEnd)
    if (sources.length !== 1) return []
    const segment = sources[0]!
    return [{
      ...range,
      sourceSpineHref: segment.sourceSpineHref ?? range.sourceSpineHref,
      sourceOffset: segment.sourceStart + range.sourceOffset - segment.targetStart,
    }]
  })
  return [...carriedRanges, ...newlyStructuralRanges]
}

export function persistContentRevisionMaps(
  tx: MapWriter,
  input: {
    bookVersionId: string
    sourceRevisionId: string
    targetRevisionId: string
    directSegments: RevisionMapSegment[]
    directSourceSections: RevisionSectionPosition[]
    directTargetSections: RevisionSectionPosition[]
    directStructuralRanges: RevisionTextRange[]
  },
): void {
  const priorMaps = tx.select().from(contentRevisionMaps).where(and(
    eq(contentRevisionMaps.bookVersionId, input.bookVersionId),
    eq(contentRevisionMaps.targetRevisionId, input.sourceRevisionId),
  )).all()
  const maps = [
    {
      sourceRevisionId: input.sourceRevisionId,
      segments: input.directSegments,
      sourceSections: input.directSourceSections,
      structuralRanges: input.directStructuralRanges,
    },
    ...priorMaps.map((map) => {
      const segments = composeRevisionMaps(map.segments, input.directSegments)
      return {
        sourceRevisionId: map.sourceRevisionId,
        segments,
        sourceSections: map.sourceSections,
        structuralRanges: composeRevisionStructuralRanges(map.structuralRanges, map.segments,
          input.directSegments, input.directStructuralRanges),
      }
    }),
  ]

  tx.insert(contentRevisionMaps).values(maps.map(({ sourceRevisionId, segments, sourceSections, structuralRanges }) => ({
    id: createId('crm'),
    bookVersionId: input.bookVersionId,
    sourceRevisionId,
    targetRevisionId: input.targetRevisionId,
    segments,
    sourceSections,
    targetSections: input.directTargetSections,
    structuralRanges,
    createdAt: Date.now(),
  }))).onConflictDoNothing().run()
}
