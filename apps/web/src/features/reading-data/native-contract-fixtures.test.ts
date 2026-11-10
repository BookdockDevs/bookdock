import { describe, expect, it } from 'vitest'
import { annotationCreateSchema, clientBookRefSchema, clientLocatorSchema, clientPresetBindingSchema, clientPublicationStructureSchema, clientReadingCaptureGroupSchema, clientReadingCaptureSchema, clientManualTimerSnapshotSchema, clientReadingRoundsSchema, clientReadingEntrySchema, clientReadingGroupEntrySchema, clientTxtPublicationSchema, countWords, loginSchema, readingProgressUpdateSchema, readingRecordCreateSchema, resolveClientPresetBinding, selectedTextTranslationRequestSchema, translationRequestSchema, ttsEdgeSpeechSchema, ttsSpeechSchema, TXT_EPUB_ARTIFACT_VERSION } from '@bookdock/shared'
import fixtures from '../../../../../packages/shared/src/client-reading.fixtures.json'

describe('native handoff golden examples', () => {
  it('preserves paused zero time and suspended subsecond time independently of finalized captures', () => {
    const [paused, suspended] = fixtures.manualTimerSnapshots.map((value) => clientManualTimerSnapshotSchema.parse(value))
    expect(paused.elapsedMs).toBe(0)
    expect(paused.expiresAt).toBeNull()
    expect(suspended.elapsedMs).toBe(250)
    expect(clientManualTimerSnapshotSchema.safeParse({ ...paused, expiresAt: suspended.expiresAt }).success).toBe(false)
    expect(clientManualTimerSnapshotSchema.safeParse({ ...suspended, elapsedMs: 1 }).success).toBe(false)
  })
  it('keeps fractional local facts independent of integer Server wire precision', () => {
    const local = clientReadingCaptureSchema.parse({ ...fixtures.untimedLocalReadingCapture, durationSeconds: 0.25 })
    expect(local.durationSeconds).toBe(0.25)
    const wire = { bookId: local.book.bookId, date: local.date, source: 'retroactive', startedAt: null, durationSeconds: 1 }
    expect(readingRecordCreateSchema.safeParse(wire).success).toBe(true)
    expect(readingRecordCreateSchema.safeParse({ ...wire, durationSeconds: 0.25 }).success).toBe(false)
  })

  it('keeps unknown historical round clocks and explicit finish intent out of timed capture facts', () => {
    const rounds = clientReadingRoundsSchema.parse(fixtures.localReadingRounds)
    expect(rounds.rounds[0]).toMatchObject({ status: 'finished', startedAt: null, endedAt: null })
    expect(clientReadingRoundsSchema.safeParse({ ...rounds, rounds: [rounds.rounds[1]] }).success).toBe(false)
    const entry = clientReadingEntrySchema.parse(fixtures.localReadingEntry)
    expect(entry.finished).toBe(true)
    expect(entry.capture.startedAt).toBeNull()
    expect(clientReadingCaptureSchema.safeParse(entry).success).toBe(false)
  })

  it('separates raw long manual time from bounded facts and validates an atomic group-entry finish command', () => {
    const paused = clientManualTimerSnapshotSchema.parse(fixtures.manualTimerSnapshots[0])
    const endedAt = paused.startedAt + 86400_500
    const long = clientManualTimerSnapshotSchema.parse({ ...paused, elapsedMs: 86400_500, fragments: [{ startedAt: paused.startedAt, endedAt }] })
    expect(long.elapsedMs).toBe(86400_500)
    const entry = clientReadingGroupEntrySchema.parse({ group: fixtures.localTimedCaptureGroup, finished: true })
    expect(entry.finished).toBe(true)
    expect(clientReadingGroupEntrySchema.safeParse({ ...entry, group: { ...entry.group, captures: entry.group.captures.map((capture) => ({ ...capture, source: 'auto' })) } }).success).toBe(false)
    expect(clientReadingCaptureGroupSchema.safeParse({ ...entry.group, captures: [entry.group.captures[0], { ...entry.group.captures[1], timezone: 'Asia/Shanghai' }] }).success).toBe(false)
  })

  it('qualifies logical timer chunks by their real book, source and revision', () => {
    const group = clientReadingCaptureGroupSchema.parse(fixtures.localTimedCaptureGroup)
    expect(group.captures.reduce((sum, capture) => sum + capture.durationSeconds, 0)).toBe(70)
    expect(group.captures.every((capture) => capture.startCfi === undefined && capture.wordCount === undefined)).toBe(true)
    expect(clientReadingCaptureGroupSchema.safeParse({ ...group, captures: [group.captures[0], { ...group.captures[1], book: { ...group.book, bookId: 'another-book' } }] }).success).toBe(false)
    expect(clientReadingCaptureGroupSchema.safeParse({ ...group, captures: [group.captures[0], group.captures[0]] }).success).toBe(false)
  })
  it('preserves unknown local reading time without Server command fields', () => {
    const capture = clientReadingCaptureSchema.parse(fixtures.untimedLocalReadingCapture)
    expect(capture.startedAt).toBeNull()
    expect(capture.endedAt).toBeUndefined()
    expect(capture.timezone).toBeUndefined()
    expect(capture.wordCount).toBeUndefined()
    expect(clientReadingCaptureSchema.safeParse({ ...capture, expectedUserId: 'server-user' }).success).toBe(false)
    expect(clientReadingCaptureSchema.safeParse({ ...capture, finished: true }).success).toBe(false)
  })
  it('validates sentence speech inputs without library identity, file or reading records', () => {
    expect(ttsSpeechSchema.parse(fixtures.speechRequest)).toEqual(fixtures.speechRequest)
    expect(ttsEdgeSpeechSchema.parse(fixtures.edgeSpeechRequest)).toEqual(fixtures.edgeSpeechRequest)
    expect(ttsSpeechSchema.safeParse({ ...fixtures.speechRequest, text: 'x'.repeat(4001) }).success).toBe(false)
    expect(ttsEdgeSpeechSchema.safeParse({ ...fixtures.edgeSpeechRequest, text: ' ' }).success).toBe(false)
  })
  it('validates selected-text utility input separately from remote-book authorization input', () => {
    const selection = selectedTextTranslationRequestSchema.parse(fixtures.selectedTextTranslation)
    expect(selection.text).toBe('Hello.')
    expect(translationRequestSchema.safeParse(selection).success).toBe(false)
    expect(translationRequestSchema.safeParse({ ...selection, bookId: 'server-book-version' }).success).toBe(true)
    expect(selectedTextTranslationRequestSchema.safeParse({ ...selection, bookId: 'local-book' }).success).toBe(false)
    expect(selectedTextTranslationRequestSchema.safeParse({ ...selection, context: 'extra chapter' }).success).toBe(false)
  })
  it('validates normalized TXT bounds and actual counted text independently of CFI anchors', () => {
    const publication = clientTxtPublicationSchema.parse(fixtures.txtPublication)
    expect(publication.artifactVersion).toBe(TXT_EPUB_ARTIFACT_VERSION)
    expect(publication.normalizedLength).toBe(fixtures.txtNormalizedText.length)
    const chapter = publication.chapters[0]!
    expect(chapter.contentStartOffset).toBe(fixtures.txtNormalizedText.indexOf('Hello.'))
    expect(chapter.wordCount).toBe(countWords(fixtures.txtNormalizedText.slice(chapter.contentStartOffset, chapter.endOffset)))
  })

  it('keeps publication facts unknown and resolves equal preset IDs only for their qualified owners', () => {
    const structure = clientPublicationStructureSchema.parse(fixtures.publicationStructure)
    expect(structure.sections.every((section) => section.byteLength === null && section.wordCount === null)).toBe(true)
    expect(structure.sections[0]).not.toHaveProperty('startOffset')
    for (const raw of fixtures.presetBindings) {
      const binding = clientPresetBindingSchema.parse(raw)
      expect(resolveClientPresetBinding(binding, binding.owner)).toBe('same-preset-id')
      expect(resolveClientPresetBinding(binding, { kind: 'account', connectionId: 'other', accountId: 'fixture-reader' })).toBeNull()
    }
  })

  it('preserves portable CFI and engine-tagged view coordinates independently', () => {
    expect(clientBookRefSchema.parse(fixtures.book)).toEqual(fixtures.book)
    const position = clientLocatorSchema.parse(fixtures.position)
    expect(position.value.startsWith('epubcfi(')).toBe(true)
    expect(position.layout?.value).toBe('chapter:1:0.000000')
    expect(clientLocatorSchema.parse(fixtures.highlight).quote?.exact).toBe('Second paragraph 0. A lo')
    expect(clientLocatorSchema.safeParse(fixtures.unsupportedLocator).success).toBe(false)
  })

  it('validates the documented remote request examples against owning wire schemas', () => {
    expect(loginSchema.parse({ username: 'reader', password: 'example-password' }).username).toBe('reader')
    const progress = readingProgressUpdateSchema.parse({ expectedUserId: 'reader', revisionId: 'revision', percent: 50, fraction: 0.5, cfi: fixtures.position.layout.value, contentCfi: fixtures.position.value })
    expect(progress.contentCfi).toBe(fixtures.position.value)
    const highlight = annotationCreateSchema.parse({ type: 'highlight', revisionId: 'revision', cfiRange: fixtures.highlight.value, text: fixtures.highlight.quote.exact, color: 'yellow', style: 'underline' })
    expect(highlight.type).toBe('highlight')
    expect(annotationCreateSchema.parse({ ...highlight, type: 'note', note: 'A native idea' }).note).toBe('A native idea')
  })
})
