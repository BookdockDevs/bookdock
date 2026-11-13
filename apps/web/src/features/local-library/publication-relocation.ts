import { cfiSpineIndex, createEpubMarkupRevisionMap, extractEpubMarkupText, mapAnnotationAnchor, mapPointReplacementAnchor, mapRevisionFraction, mapRevisionTextPosition, projectRevisionCoverage, resolveEpubCfiTextStart } from '@bookdock/shared'
import type { ClientBookRef, ClientNote, ClientReadingState, ClientReadingRounds, ClientReplacement, EditorTxtSaveRes } from '@bookdock/shared'

export interface PublicationRelocationSnapshot {
  book: ClientBookRef
  baseContentId: string
  structuralHeadingIndexes?: number[]
  state: ClientReadingState | null
  notes: ClientNote[]
  rounds: ClientReadingRounds
  intervals: Array<[number, number]>
  points: ClientReplacement[]
}

export function relocatePublication(snapshot: PublicationRelocationSnapshot, contentId: string, before: { href: string; content: string }[], after: { href: string; content: string }[], sourceOrder: string[], targetOrder: string[]) {
  const sourceMarkup = before.map((document) => ({ href: document.href, markup: document.content }))
  const targetMarkup = after.map((document) => ({ href: document.href, markup: document.content }))
  const mapping = createEpubMarkupRevisionMap(sourceMarkup, targetMarkup, snapshot.structuralHeadingIndexes)
  const sections = (order: string[], parsed: typeof mapping.sourceSections) => order.map((href) => parsed.find((section) => section.spineHref === href) ?? { spineHref: href, size: 0, textLength: 0 })
  mapping.sourceSections = sections(sourceOrder, mapping.sourceSections)
  mapping.targetSections = sections(targetOrder, mapping.targetSections)
  const sourceTexts = extractEpubMarkupText(sourceMarkup)
  const targetTexts = extractEpubMarkupText(targetMarkup)
  const sourceMarkups = new Map(before.map((document) => [document.href, document.content]))
  const targetMarkups = new Map(after.map((document) => [document.href, document.content]))
  const content = { book: snapshot.book, contentId }
  const unlocated: EditorTxtSaveRes['unlocated'] = { progress: 0, coverage: 0, highlights: 0, bookmarks: 0, notes: 0, pointReplacements: 0 }
  const mapLocator = (locator: NonNullable<ClientReadingState['position']>) => {
    if (locator.content.contentId !== snapshot.baseContentId) return null
    const mapped = mapAnnotationAnchor(locator.value, locator.href, mapping.sourceSections, mapping.targetSections, sourceTexts, targetTexts, sourceMarkups, targetMarkups, mapping.segments)
    if (!mapped?.cfi) return null
    const { layout: _layout, ...previous } = locator
    return { ...previous, content, value: mapped.cfi, href: mapped.chapterHref }
  }
  // Notes migrate the primary CFI AND every retained evidence fragment each
  // round, unioning the survivors into the new evidence: a fragment must not
  // be dropped while the primary CFI still maps, or a later edit deleting the
  // primary would lose a fragment that is still alive (see
  // revision-anchors.ts mapAnnotationAnchorWithEvidence).
  const mapNoteAnchor = (note: ClientNote) => {
    const base = note.locator
    if (!base || base.content.contentId !== snapshot.baseContentId) return null
    const attempts: Array<{ value: string; href?: string }> = [{ value: base.value, href: base.href }]
    for (const fragment of note.locatorEvidence ?? []) {
      if (fragment.value !== base.value) attempts.push(fragment)
    }
    const survivors: Array<{ cfi: string; chapterHref: string }> = []
    let primary: { cfi: string; chapterHref: string } | null = null
    for (const attempt of attempts) {
      const mapped = mapAnnotationAnchor(attempt.value, attempt.href, mapping.sourceSections, mapping.targetSections, sourceTexts, targetTexts, sourceMarkups, targetMarkups, mapping.segments)
      if (!mapped?.cfi) continue
      const pieces = mapped.fragments ?? [{ cfi: mapped.cfi, chapterHref: mapped.chapterHref }]
      survivors.push(...pieces)
      if (!primary && attempt.value === base.value) primary = { cfi: mapped.cfi, chapterHref: mapped.chapterHref }
    }
    if (!survivors.length) return null
    const chosen = primary ?? survivors[0]!
    const { layout: _layout, ...previous } = base
    return {
      locator: { ...previous, content, value: chosen.cfi, href: chosen.chapterHref },
      fragments: survivors.length > 1 ? survivors : undefined,
    }
  }
  const projectCoverage = (intervals: Array<[number, number]>) => projectRevisionCoverage(intervals, mapping.sourceSections, mapping.targetSections, mapping.segments, mapping.structuralRanges)
  const state = snapshot.state ? structuredClone(snapshot.state) : null
  let intervals = snapshot.intervals
  if (state) {
    const previousPosition = state.position
    if (state.fraction !== null) state.fractionContent = state.position?.content ?? state.fractionContent ?? state.coverage?.content ?? null
    const previousFraction = state.fraction
    const position = state.position ? mapLocator(state.position) : null
    if (position) {
      const index = cfiSpineIndex(position.value)
      const section = index === null ? undefined : mapping.targetSections[index]
      const markup = section && targetMarkups.get(section.spineHref)
      const offset = markup ? resolveEpubCfiTextStart(markup, position.value) : null
      const fraction = section && offset !== null ? mapRevisionTextPosition(section.spineHref, offset, mapping.targetSections, [{ sourceSpineHref: section.spineHref, targetSpineHref: section.spineHref, sourceStart: 0, sourceEnd: section.textLength, targetStart: 0, targetEnd: section.textLength }]) : null
      state.fractionContent = content
      state.position = position
      state.fraction = fraction?.fraction ?? null
    } else if (state.position || state.fraction !== null) {
      if (!state.position && state.coverage?.content.contentId === snapshot.baseContentId && state.fraction !== null) {
        const mapped = mapRevisionFraction(state.fraction, mapping.sourceSections, mapping.targetSections, mapping.segments)
        if (mapped) { state.fraction = mapped.fraction; state.fractionContent = content }
        else unlocated.progress++
      } else unlocated.progress++
    }
    if (state.coverage?.content.contentId === snapshot.baseContentId && state.coverage.available && (state.coverage.fraction === 0 || intervals.length > 0)) {
      intervals = projectCoverage(intervals)
      state.coverage = { content, available: true, fraction: intervals.reduce((sum, [start, end]) => sum + end - start, 0) }
    } else if (state.coverage && state.coverage.fraction > 0) unlocated.coverage++
    if (position || state.fraction !== previousFraction) state.positionHistory = [...(state.positionHistory ?? []), { position: previousPosition, fraction: previousFraction, updatedAt: state.updatedAt }]
    state.version++
  }
  const notes = snapshot.notes.map((note) => {
    if (!note.locator) return note
    const result = mapNoteAnchor(note)
    if (!result) { unlocated[note.kind === 'idea' ? 'notes' : note.kind === 'highlight' ? 'highlights' : 'bookmarks']++; return note }
    return {
      ...note,
      locator: result.locator,
      locatorHistory: [...(note.locatorHistory ?? []), note.locator],
      locatorEvidence: result.fragments?.map((fragment) => ({ value: fragment.cfi, href: fragment.chapterHref })),
      version: note.version + 1,
    }
  })
  const rounds = structuredClone(snapshot.rounds)
  for (const round of rounds.rounds) {
    if (round.coverage?.content.contentId !== snapshot.baseContentId) continue
    round.coverageHistory = [...(round.coverageHistory ?? []), round.coverage]
    round.coverage = { content, intervals: projectCoverage(round.coverage.intervals) }
  }
  rounds.version++
  const points = snapshot.points.map((row) => {
    if (row.contentId !== snapshot.baseContentId) { unlocated.pointReplacements++; return row }
    const mapped = mapPointReplacementAnchor({ spineHref: row.rule.spineHref ?? null, textOffset: row.rule.textOffset ?? null, originalText: row.rule.originalText ?? null }, mapping.segments, sourceTexts, targetTexts)
    if (!mapped) { unlocated.pointReplacements++; return row }
    return { ...row, contentId, rule: { ...row.rule, ...mapped }, version: row.version + 1 }
  })
  return { state, notes, rounds, intervals, points, unlocated }
}
export type PublicationRelocation = ReturnType<typeof relocatePublication>
