import type { AnnotationCreateReq, AnnotationRes, AnnotationUpdateReq, ClientBookRef, ClientLocator, ClientNote, ReadingProgressRes, ReadingRange, ViewSettings } from '@bookdock/shared'
import { clientLocatorSchema, clientPresetBindingSchema, clientReadingCaptureSchema, clientBookKey, readingRangeSchema } from '@bookdock/shared'
import type { LocalReaderSession } from '../reading-data/reader-source-context'
import { localEpubProvider } from '../reader/content/local-epub-provider'
import { addReadingCoverage } from '../reader/lib/reading-coverage'
import { LocalLibraryError, localLibraryRepository as repository } from './repository'
import { localRecordId } from './id'
import { localCatalogDetailView } from './catalog-view'
import { readPublicationStructure } from './publication-structure'
import { flushLocalReadingOutbox } from './reading-outbox'
import { localManualTimer } from './manual-timer'
import { localTimerCaptureGroup } from './reading-capture-group'
import { projectLocalReadingBook } from './reading-projection'
import { localReviewView } from './reviews'

function noteView(note: ClientNote): AnnotationRes {
  return {
    id: note.id, clientVersion: note.version, bookId: note.book.bookId, revisionId: note.locator?.content.contentId ?? null,
    cfiRange: note.locator?.value ?? null, cfiAnchor: null,
    type: note.kind === 'idea' ? 'note' : note.kind,
    text: note.kind === 'bookmark' ? note.title : note.text,
    contextText: note.kind === 'bookmark' ? note.context : null,
    note: note.kind === 'idea' ? note.body : null,
    color: note.kind === 'highlight' ? note.color : 'yellow',
    style: note.kind === 'highlight' ? note.style : 'highlight',
    chapter: note.chapter, chapterHref: note.locator?.href ?? null,
    createdAt: note.createdAt, updatedAt: note.updatedAt,
    ...(note.kind === 'idea' && note.images ? { images: note.images.map((image) => ({ ...image, kind: 'image' as const, url: '', localSource: { book: note.book, id: image.id } })) } : {}),
  }
}

export async function openLocalReaderSession(ref: ClientBookRef, recordsOnly = false): Promise<LocalReaderSession> {
  const book = await repository.getBook(ref)
  const blob = recordsOnly ? null : await repository.getPublicationFile(ref)
  const sourceAvailable = recordsOnly ? await repository.hasPublication(ref) : Boolean(blob)
  const content = book.content!
  if (!content) throw new LocalLibraryError('storage-unavailable', 'Stored local content identity is missing')
  const namespace = `local:${JSON.stringify([ref.scope, ref.bookId, content.contentId])}`
  let state = await repository.getState(ref)
  let coverageRoundId = (await repository.readReadingRounds(ref)).rounds.at(-1)?.id ?? null
  let coverage: Array<[number, number]> = state?.coverage?.content.contentId === content.contentId ? ((await repository.getPreferences(ref)).coverageIntervals as Array<[number, number]> | undefined) ?? [] : []
  if (!Array.isArray(coverage) || coverage.some((interval) => !Array.isArray(interval) || interval.length !== 2 || !interval.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) || interval[0] > interval[1])) throw new LocalLibraryError('storage-unavailable', 'Stored reading coverage is invalid')
  const locator = (cfi: string | null | undefined, href?: string | null): ClientLocator | null => {
    if (!cfi) return null
    const parsed = clientLocatorSchema.safeParse({ content, schemaVersion: 1, kind: 'epub-cfi', value: cfi, ...(href ? { href } : {}) })
    return parsed.success ? parsed.data : null
  }
  const progressView = (): ReadingProgressRes | null => {
    if (!state) return null
    const positionRevision = state.position?.content.contentId ?? (state.fraction !== null ? state.fractionContent?.contentId ?? state.coverage?.content.contentId : null) ?? null
    const locationAvailable = positionRevision === content.contentId || state.position === null && state.fraction === null
    const coverageAvailable = state.coverage === null || state.coverage.content.contentId === content.contentId && state.coverage.available
    return {
      id: namespace, bookId: ref.bookId, progressRevisionId: positionRevision,
      cfi: state.position?.layout?.value ?? state.position?.value ?? null, contentCfi: state.position?.value ?? null,
      chapter: state.chapter ?? null, percent: (state.fraction ?? 0) * 100, fraction: state.fraction,
      locationAvailable, coverageAvailable, contentUpdateUnseen: !locationAvailable || !coverageAvailable,
      readFraction: coverageAvailable ? state.coverage?.fraction ?? 0 : 0, updatedAt: state.updatedAt,
    }
  }
  const readingProjection = async (range?: ReadingRange) => projectLocalReadingBook(await repository.readReadingBookSnapshot(ref), range)
  let saveChain = Promise.resolve()
  const session: LocalReaderSession = {
    content, ref, bookId: ref.bookId, namespace, sourceAvailable, provider: blob ? localEpubProvider(namespace, blob, { cache: true }) : { cacheIdentity: namespace, async open(foliate, signal) {
      if (!sourceAvailable) throw new LocalLibraryError('unavailable-content', 'Source file is unavailable')
      const current = await repository.getBook(ref)
      if (current.content?.contentId !== content.contentId) throw new LocalLibraryError('conflict', 'Publication revision changed')
      return localEpubProvider(namespace, await repository.getPublicationFile(ref), { cache: true }).open(foliate, signal)
    } },
    async getBook() {
      const current = await repository.getBook(ref)
      if (!recordsOnly && current.availability !== 'available') throw new Error('Local source file was removed')
      const currentState = await repository.getState(ref)
      const settings = await repository.getPreferences(ref)
      const organization = await repository.getOrganization(ref.scope.kind === 'local' ? ref.scope.vaultId : '')
      return { data: localCatalogDetailView(current, currentState, organization, settings) }
    },
    async getStructure(signal) {
      const structure = await readPublicationStructure(repository, ref, signal)
      if (structure.content.contentId !== content.contentId) throw new LocalLibraryError('conflict', 'Publication revision changed')
      return structure
    },
    async getReadingLedger() { return { data: (await readingProjection()).overview } },
    async getReadingStats(range) { return { data: (await readingProjection(range)).stats } },
    async getReadingRecords(range) {
      const stats = (await readingProjection(range)).stats
      return { data: { totalSeconds: stats.totalSeconds, records: stats.daily.map(({ date, durationSeconds }) => ({ date, durationSeconds })) } }
    },
    async getReadingSessions(range, cursor) {
      const normalized = readingRangeSchema.parse(range ?? {})
      const scope = JSON.stringify([clientBookKey(ref), normalized.from ?? null, normalized.to ?? null, normalized.timezone ?? null])
      const result = await readingProjection(normalized)
      let offset = 0
      if (cursor) {
        let value: { scope?: unknown; version?: unknown; offset?: unknown }
        try { value = JSON.parse(cursor) } catch { throw new LocalLibraryError('invalid-input', 'Invalid reading session cursor') }
        if (!value || value.scope !== scope || value.version !== result.overview.dataVersion || typeof value.offset !== 'number' || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset > result.sessions.length) throw new LocalLibraryError('conflict', 'Reading session cursor belongs to another scope or snapshot')
        offset = value.offset
      }
      const items = result.sessions.slice(offset, offset + 50)
      const hasMore = offset + items.length < result.sessions.length
      return { data: { dataVersion: result.overview.dataVersion, items, hasMore, nextCursor: hasMore ? JSON.stringify({ scope, version: result.overview.dataVersion, offset: offset + items.length }) : null } }
    },
    updateReadingSession: (id, members, body) => repository.updateReadingLogicalSession({ book: ref, id, members, requestId: localRecordId() }, body),
    deleteReadingSession: (id, members) => repository.deleteReadingLogicalSession({ book: ref, id, members, requestId: localRecordId() }),
    async addReadingRecord(body) {
      const { bookId, expectedUserId, replaceSessionIds, finished, ...fields } = body
      if (bookId !== ref.bookId || expectedUserId !== undefined || ref.scope.kind !== 'local') throw new LocalLibraryError('invalid-input', 'Reading entry belongs to another source')
      const record = { ...fields, bookId, requestId: fields.requestId ?? localRecordId(), source: fields.source ?? 'retroactive', startedAt: fields.startedAt ?? null,
        ...(fields.startFraction !== undefined || fields.startCfi || fields.coverage?.length ? { revisionId: fields.revisionId ?? content.contentId } : {}) }
      const measuredMs = record.fragments?.reduce((sum, fragment) => sum + fragment.endedAt - fragment.startedAt, 0) ?? 0
      if (record.source === 'manual' && (record.durationSeconds > 86400 || measuredMs > 86400_000 || (record.fragments?.length ?? 0) > 5000)) {
        if (replaceSessionIds?.length) throw new LocalLibraryError('invalid-input', 'Manual timer groups cannot replace other sessions')
        await localManualTimer(ref.scope.vaultId).saveEntry({ group: localTimerCaptureGroup(ref, record), finished: finished ?? false })
      } else {
        const { bookId: _bookId, ...captureFields } = record
        const capture = clientReadingCaptureSchema.parse({ ...captureFields, book: ref })
        await localManualTimer(ref.scope.vaultId).saveEntry({ capture, finished: finished ?? false, replaceSessionIds })
      }
      state = await repository.getState(ref)
    },
    async changeReadingRound(action) {
      if (ref.scope.kind !== 'local') throw new LocalLibraryError('invalid-input', 'Local reading scope is required')
      await flushLocalReadingOutbox(ref.scope.vaultId, repository)
      const history = await repository.readReadingRounds(ref)
      const result = await repository.changeReadingRound(ref, action, history.version, localRecordId())
      state = await repository.getState(ref)
      coverage = (await repository.getPreferences(ref)).coverageIntervals as Array<[number, number]> ?? []
      coverageRoundId = result.rounds.at(-1)?.id ?? null
      return result
    },
    async getProgress() {
      const snapshot = await repository.readReadingBookSnapshot(ref)
      state = snapshot.state
      const currentRoundId = snapshot.rounds.rounds.at(-1)?.id ?? null
      const currentIntervals = snapshot.state?.coverage?.content.contentId === content.contentId ? snapshot.coverageIntervals : []
      if (currentRoundId !== coverageRoundId) coverage = currentIntervals
      else for (const interval of currentIntervals) coverage = addReadingCoverage(coverage, interval[0], interval[1])
      coverageRoundId = currentRoundId
      return { data: progressView() }
    },
    captureCoverage(from, to) {
      if (Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to >= 0 && from <= 1 && to <= 1) coverage = addReadingCoverage(coverage, from, to)
    },
    saveProgress(body) {
      const operation = saveChain.then(async () => {
        if (body.revisionId && body.revisionId !== content.contentId) throw new Error('Local content changed')
        const canonical = locator(body.contentCfi ?? body.cfi)
        if (!canonical) throw new LocalLibraryError('invalid-input', 'An exact content position is required before saving')
        if (canonical && body.cfi && body.cfi !== canonical.value) canonical.layout = { engine: 'bookdock-foliate', version: '1', value: body.cfi }
        const nextCoverage = body.segmentStartFraction !== undefined && body.fraction !== undefined ? addReadingCoverage(coverage, body.segmentStartFraction, body.fraction) : coverage
        const now = Date.now()
        const nextChapter = body.chapter !== undefined ? (body.chapter ?? null) : (state?.chapter ?? null)
        state = await repository.saveState({ book: ref, readStatus: state?.readStatus ?? 'reading', position: canonical, fraction: body.fraction ?? body.percent / 100, chapter: nextChapter,
          coverage: { content, fraction: nextCoverage.reduce((sum, [from, to]) => sum + to - from, 0), available: true }, lastReadAt: now, updatedAt: now, version: state?.version ?? 0 }, state?.version ?? 0, nextCoverage)
        coverage = nextCoverage
      })
      saveChain = operation.catch(() => {})
      return operation.then(() => ({ data: progressView() }))
    },
    async listNotes() {
      const snapshot = await repository.readBookNotesSnapshot(ref)
      return { data: snapshot.notes.map((note) => ({ ...noteView(note), locationAvailable: snapshot.sourceAvailable && note.locator !== null && note.locator.content.contentId === snapshot.book.content?.contentId })) }
    },
    async getArchiveNotes(range) {
      const parsed = readingRangeSchema.parse(range ?? {})
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: parsed.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      const annotations = (await session.listNotes()).data.filter((note) => {
        const date = formatter.format(new Date(note.createdAt))
        return (!parsed.from || date >= parsed.from) && (!parsed.to || date <= parsed.to)
      })
      const review = await repository.getReview(ref)
      return { data: { annotations, reviews: review ? [localReviewView(review)] : [] } }
    },
    async deleteNotes(notes) { await repository.deleteNotes(ref, notes.map((note) => ({ id: note.id, version: note.clientVersion }))) },
    async createNote(body: AnnotationCreateReq, commandId = localRecordId()) {
      const now = Date.now()
      if (body.revisionId && body.revisionId !== content.contentId) throw new LocalLibraryError('invalid-input', 'Note belongs to different content')
      const anchor = locator(body.cfiRange, body.chapterHref)
      if ((body.cfiRange || body.type !== 'note') && !anchor) throw new LocalLibraryError('invalid-input', 'A valid content location is required')
      const base = { id: commandId, book: ref, locator: anchor, chapter: body.chapter ?? null, createdAt: now, updatedAt: now, version: 0 }
      const note: ClientNote = body.type === 'bookmark' ? { ...base, kind: 'bookmark', title: body.text ?? '', context: body.contextText ?? '' }
        : body.type === 'highlight' ? { ...base, kind: 'highlight', text: body.text ?? '', color: body.color ?? 'yellow', style: body.style ?? 'highlight' }
          : { ...base, kind: 'idea', text: body.text ?? '', body: body.note ?? '' }
      return { data: noteView(await repository.saveNote(note, 0, body.replaceAnnotationIds, body)) }
    },
    async updateNote(id: string, body: AnnotationUpdateReq, expectedVersion?: number) {
      const existing = (await repository.listNotes(ref)).find((note) => note.id === id)
      if (!existing) throw new Error('Local note no longer exists')
      const next = { ...existing, updatedAt: Date.now() }
      if (next.kind === 'idea') { next.body = body.note ?? next.body; next.text = body.text ?? next.text }
      if (next.kind === 'highlight') { next.text = body.text ?? next.text; next.color = body.color ?? next.color; next.style = body.style ?? next.style }
      if (next.kind === 'bookmark') next.title = body.text ?? next.title
      return { data: noteView(await repository.saveNote(next, expectedVersion ?? existing.version, [], body)) }
    },
    async deleteNote(id, expectedVersion) { await repository.deleteNote(ref, id, expectedVersion) },
    async saveSettings(viewSettings) {
      await repository.patchPreferences(ref, { viewSettings })
      const settings = await repository.getPreferences(ref)
      return { data: { viewSettings: settings.viewSettings as ViewSettings | undefined } }
    },
    async bindPreset(presetId, owner) {
      const binding = presetId === null ? null : clientPresetBindingSchema.parse({ presetId, owner })
      await repository.patchPreferences(ref, { presetBinding: binding })
    },
    async listAiThreads() { return { data: await repository.listAiThreads(ref) } },
    async getAiThread(threadId) { return { data: await repository.getAiThread(ref, threadId) } },
    async saveAiThreadTurn(input) { return { data: await repository.saveAiThreadTurn(ref, input) } },
    async updateAiThread(threadId, body) { return { data: await repository.updateAiThread(ref, threadId, body) } },
    async deleteAiThread(threadId) { await repository.deleteAiThread(ref, threadId) },
  }
  return session
}

export { localRecordId } from './id'
