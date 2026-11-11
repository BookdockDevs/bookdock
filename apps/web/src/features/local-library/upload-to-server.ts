import {
  clientPresetBindingSchema,
  readerBookSettingsSchema,
  resolveClientPresetBinding,
  type Book,
  type ClientBookRef,
  type LocalBookDuplicateCheckRes,
  type LocalBookImportPayload,
} from '@bookdock/shared'

import { ApiError, apiPost, apiUpload } from '@/api/client'
import { queryClient } from '@/lib/query-client'

import { localRecordId } from './id'
import { localLibraryRepository, type LocalLibraryRepository } from './repository'

export interface UploadLocalBookOptions {
  accountId: string
  connectionId?: string
  requestId?: string
  signal?: AbortSignal
  onProgress?: (percent: number) => void
  repository?: LocalLibraryRepository
}

export async function uploadLocalBookToServer(
  ref: ClientBookRef,
  options: UploadLocalBookOptions,
): Promise<Book> {
  const repository = options.repository ?? localLibraryRepository
  const snapshot = await repository.exportBookTransferSnapshot(ref)
  options.signal?.throwIfAborted()

  const existingRequestId = options.requestId ?? await repository.getUploadMigrationReceipt?.(ref, options.accountId) ?? null
  if (!existingRequestId) {
    const duplicate = await apiPost<{ data: LocalBookDuplicateCheckRes }>('/books/duplicate-check', {
      sha256: snapshot.fileSha256,
      format: snapshot.book.format,
    })
    options.signal?.throwIfAborted()
    if (duplicate.data.duplicated) {
      throw new ApiError(
        'BOOK_DUPLICATE',
        'A book with identical content already exists on the server',
        duplicate.data,
      )
    }
  }
  const requestId = existingRequestId ?? localRecordId()
  if (!existingRequestId) {
    await repository.setUploadMigrationReceipt?.(ref, options.accountId, requestId)
  }

  const contentId = snapshot.book.content?.contentId
  if (!contentId) throw new Error('Local book content identity is missing')

  const roundOrdinalById = new Map<string, number>()
  for (const round of snapshot.rounds) {
    roundOrdinalById.set(round.id, round.ordinal)
  }

  const bindingParsed = clientPresetBindingSchema.safeParse(snapshot.preferences.presetBinding)
  const boundPresetId = bindingParsed.success
    ? resolveClientPresetBinding(bindingParsed.data, {
        kind: 'account',
        connectionId: options.connectionId ?? 'default',
        accountId: options.accountId,
      })
    : null
  const readerSettingsParsed = readerBookSettingsSchema.safeParse({
    ...(snapshot.preferences.viewSettings !== undefined ? { viewSettings: snapshot.preferences.viewSettings } : {}),
    ...(boundPresetId ? { boundPresetId } : {}),
  })
  const readerSettings = readerSettingsParsed.success && (
    readerSettingsParsed.data.viewSettings !== undefined || readerSettingsParsed.data.boundPresetId !== undefined
  )
    ? readerSettingsParsed.data
    : null

  const payload: LocalBookImportPayload = {
    requestId,
    book: {
      title: snapshot.book.title,
      authors: snapshot.book.authors,
      format: snapshot.book.format,
      fileName: snapshot.book.fileName ?? snapshot.book.textSource?.fileName ?? null,
      contentId,
      createdAt: snapshot.book.createdAt,
      updatedAt: snapshot.book.updatedAt,
      ...(snapshot.book.catalog ? { catalog: snapshot.book.catalog } : {}),
      ...(snapshot.book.textSource?.ruleSelection ? { txtRulePatterns: snapshot.book.textSource.ruleSelection.patterns } : {}),
      ...(snapshot.book.textSource?.chapters ? {
        txtChapters: snapshot.book.textSource.chapters.map((chapter) => ({
          title: chapter.title,
          level: chapter.level,
          startOffset: chapter.startOffset,
          endOffset: chapter.endOffset,
          contentStartOffset: chapter.contentStartOffset,
          wordCount: chapter.wordCount,
        })),
      } : {}),
    },
    state: snapshot.state ? {
      readStatus: snapshot.state.readStatus,
      cfi: snapshot.state.position?.value ?? null,
      layoutCfi: snapshot.state.position?.layout?.value ?? null,
      chapter: snapshot.state.chapter ?? null,
      fraction: snapshot.state.fraction ?? null,
      positionContentId: snapshot.state.position?.content.contentId ?? null,
      coverageIntervals: snapshot.coverageIntervals,
      coverageContentId: snapshot.state.coverage?.content.contentId ?? null,
      lastReadAt: snapshot.state.lastReadAt ?? null,
    } : null,
    notes: snapshot.notes.map((note) => ({
      id: note.id,
      kind: note.kind,
      ...(note.kind === 'bookmark' ? { title: note.title, context: note.context } : {}),
      ...(note.kind === 'highlight' ? { text: note.text, color: note.color, style: note.style } : {}),
      ...(note.kind === 'idea' ? {
        text: note.text,
        body: note.body,
        ...(note.images?.length ? { imageIds: note.images.map((image) => image.id) } : {}),
      } : {}),
      chapter: note.chapter,
      href: note.locator?.href ?? null,
      cfi: note.locator?.value ?? null,
      contentId: note.locator?.content.contentId ?? null,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })),
    review: snapshot.review ? {
      ratingHalves: snapshot.review.ratingHalves,
      title: snapshot.review.title,
      body: snapshot.review.body,
      bodyFormat: snapshot.review.bodyFormat,
      createdAt: snapshot.review.createdAt,
      updatedAt: snapshot.review.updatedAt,
    } : null,
    rounds: snapshot.rounds.map((round) => ({
      ordinal: round.ordinal,
      status: round.status,
      startedAt: round.startedAt,
      endedAt: round.endedAt,
      coverageIntervals: round.coverage?.intervals,
    })),
    sessions: snapshot.sessions.map((session) => ({
      roundOrdinal: (session.roundId ? roundOrdinalById.get(session.roundId) : undefined) ?? 1,
      requestId: session.capture.requestId,
      source: session.capture.source,
      date: session.capture.date,
      startedAt: session.capture.startedAt,
      endedAt: session.capture.endedAt ?? null,
      durationSeconds: session.durationSeconds,
      timezone: session.capture.timezone ?? null,
      fragments: session.acceptedFragments,
      coverage: session.capture.coverage ?? [],
      startCfi: session.capture.startCfi ?? null,
      endCfi: session.capture.endCfi ?? null,
      startFraction: session.capture.startFraction ?? null,
      endFraction: session.capture.endFraction ?? null,
      startChapterIndex: session.capture.startChapterIndex ?? null,
      endChapterIndex: session.capture.endChapterIndex ?? null,
      wordCount: session.capture.wordCount ?? null,
      contentId: session.capture.revisionId ?? null,
    })),
    readerSettings,
    pointRules: snapshot.pointRules
      .filter((rule) => rule.rule.matchType === 'point' && rule.rule.spineHref && rule.rule.textOffset !== undefined && rule.rule.originalText)
      .map((rule) => ({
        name: rule.rule.name ?? null,
        group: rule.rule.group ?? null,
        replacement: rule.rule.replacement ?? '',
        spineHref: rule.rule.spineHref!,
        textOffset: rule.rule.textOffset!,
        originalText: rule.rule.originalText!,
        contentId: rule.contentId,
        relocation: 'ok' as const,
        enabled: rule.rule.enabled !== false,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })),
    replacementOverrides: snapshot.replacementOverrides,
  }

  const formData = new FormData()
  const rawName = payload.book.fileName ?? `${snapshot.book.title}.${snapshot.book.format}`
  const safeFileName = rawName.toLowerCase().endsWith(`.${snapshot.book.format}`)
    ? rawName
    : `${rawName}.${snapshot.book.format}`
  const mime = snapshot.book.format === 'epub' ? 'application/epub+zip' : 'text/plain;charset=utf-8'
  formData.append('file', new File([snapshot.file], safeFileName, { type: mime }))
  if (snapshot.cover) {
    formData.append('cover', new File([snapshot.cover], 'cover.webp', { type: snapshot.cover.type || 'image/webp' }))
  }
  for (const [imageId, blob] of snapshot.noteImages) {
    formData.append(`image_${imageId}`, new File([blob], `${imageId}.webp`, { type: blob.type || 'image/webp' }))
  }
  formData.append('payload', JSON.stringify(payload))

  const res = await apiUpload<{ data: { book: Book; requestId: string } }>(
    '/books/import-from-local',
    formData,
    'POST',
    { signal: options.signal, onProgress: options.onProgress },
  )

  await repository.removeBook(ref, true)
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['books'] }),
    queryClient.invalidateQueries({ queryKey: ['reading-records'] }),
    queryClient.invalidateQueries({ queryKey: ['archive'] }),
    queryClient.invalidateQueries({ queryKey: ['shelves'] }),
    queryClient.invalidateQueries({ queryKey: ['tags'] }),
    queryClient.invalidateQueries({ queryKey: ['categories'] }),
    queryClient.invalidateQueries({ queryKey: ['local-catalog'] }),
  ])

  return res.data.book
}
