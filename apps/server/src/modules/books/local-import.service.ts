import path from 'node:path'

import { and, eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'

import {
  CONTENT_IMAGE_MAX_BYTES,
  mergeTimeFragments,
  normalizeAuthors,
  type LocalBookDuplicateCheckReq,
  type LocalBookDuplicateCheckRes,
  type LocalBookImportPayload,
} from '@bookdock/shared'

import { blobKeyReferenced, deleteBlobRowIfUnreferenced } from '../../db/blob-refs'
import { getDb } from '../../db/client'
import {
  blobs,
  bookmarks,
  bookReviews,
  bookStates,
  bookVersions,
  contentFiles,
  contentRevisions,
  contentUploadDrafts,
  highlights,
  ideas,
  libraryBooks,
  libraryBookTags,
  libraryBookVersions,
  libraryCategories,
  libraryTags,
  readingArchives,
  readingRounds,
  readingSessions,
  readingWriteReceipts,
  settings,
  shelves,
  textReplacementOverrides,
  textReplacements,
} from '../../db/schema'
import { withContentBlob } from '../../lib/content-file-lifecycle'
import { blobKey, coverThumbnailKey, detectImageExtension, generateCoverThumbnail } from '../../lib/cover'
import { sha256 } from '../../lib/hash'
import { createId } from '../../lib/id'
import { normalizeCoverage, unionLength } from '../../lib/intervals'
import { log } from '../../lib/logger'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { assertUserUploadAllowed, effectiveUploadMaxBytes } from '../auth/auth.service'
import { ensurePrivateLibrary } from '../libraries/library-access'
import { rebuildReadingProjection } from '../reading-records/reading-ledger.service'
import {
  cleanupStagedCover,
  cleanupStagedUpload,
  findPersonalVersionByBlob,
  hashFromBlobKey,
  materializeUpload,
  resolvePrivateBook,
  stripMetaChapters,
} from './books.service'
import { enqueueReaderArchivePreparation } from './reader-content.service'
import { updateReaderBookSettings } from './reader-settings.service'

const IMPORT_RECEIPT_PREFIX = 'local-import:'

interface PreparedNoteImage {
  blobKey: string
  name: string
  mimeType: string
  size: number
}

function receiptKey(requestId: string): string {
  return `${IMPORT_RECEIPT_PREFIX}${requestId}`
}

function parseImportReceipt(userId: string, requestId: string): string | null {
  const row = getDb().select({ value: settings.value }).from(settings).where(and(
    eq(settings.userId, userId),
    eq(settings.key, receiptKey(requestId)),
  )).get()
  const bookVersionId = row?.value && typeof row.value === 'object' && 'bookVersionId' in row.value
    ? (row.value as { bookVersionId?: unknown }).bookVersionId
    : null
  return typeof bookVersionId === 'string' && bookVersionId ? bookVersionId : null
}

async function prepareCustomCover(file: File): Promise<{ coverKey: string; coverSize: number }> {
  const buffer = Buffer.from(await file.arrayBuffer())
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new AppError('UPLOAD_TOO_LARGE', 'Cover file too large')
  const ext = detectImageExtension(buffer)
  if (!ext) throw new AppError('UNSUPPORTED_FORMAT', 'Cover must be a PNG, JPEG, GIF, SVG or WebP image')
  const storage = getStorage()
  const key = blobKey(sha256(buffer), `.cover.${ext}`)
  await storage.put(key, buffer)
  const thumb = await generateCoverThumbnail(buffer, ext)
  if (thumb) await storage.put(coverThumbnailKey(key), thumb)
  return { coverKey: key, coverSize: buffer.length }
}

async function prepareNoteImages(images: Map<string, File>): Promise<Map<string, PreparedNoteImage>> {
  const prepared = new Map<string, PreparedNoteImage>()
  const storage = getStorage()
  for (const [imageId, file] of images) {
    if (!file.size || file.size > CONTENT_IMAGE_MAX_BYTES) throw new AppError('UPLOAD_TOO_LARGE', 'Image file too large')
    let data = Buffer.from(await file.arrayBuffer())
    try {
      const metadata = await sharp(data, { limitInputPixels: 40_000_000 }).metadata()
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) {
        throw new AppError('UNSUPPORTED_FORMAT', 'Unsupported note image format')
      }
      data = await sharp(data, { limitInputPixels: 40_000_000, failOn: 'warning' })
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()
      if (data.length > CONTENT_IMAGE_MAX_BYTES) throw new AppError('UPLOAD_TOO_LARGE', 'Image file too large')
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('UNSUPPORTED_FORMAT', 'The image could not be validated')
    }
    const hash = sha256(data)
    const key = `content/${hash.slice(0, 2)}/${hash}.webp`
    await withContentBlob(key, async () => {
      if (!(await storage.exists(key))) await storage.put(key, data)
    })
    const name = Array.from(path.posix.basename(path.win32.basename(file.name)))
      .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
      .slice(0, 180)
      .join('') || 'image.webp'
    prepared.set(imageId, { blobKey: key, name, mimeType: 'image/webp', size: data.length })
  }
  return prepared
}

async function cleanupPreparedNoteImages(preparedImages: Map<string, PreparedNoteImage>): Promise<void> {
  if (preparedImages.size === 0) return
  const storage = getStorage()
  const uniqueKeys = new Set(Array.from(preparedImages.values(), (img) => img.blobKey))
  for (const key of uniqueKeys) {
    await withContentBlob(key, async () => {
      if (blobKeyReferenced(key)) return
      try {
        await storage.delete(key)
        deleteBlobRowIfUnreferenced(key)
      } catch (error) {
        log('warn', 'local_import.cleanup_note_image_failed', { error, meta: { key } })
      }
    })
  }
}

export async function checkLocalBookDuplicate(userId: string, input: LocalBookDuplicateCheckReq): Promise<LocalBookDuplicateCheckRes> {
  const db = getDb()
  const libraryId = ensurePrivateLibrary(db, userId)
  const duplicate = findPersonalVersionByBlob(libraryId, blobKey(input.sha256, '.epub'), input.format)
  if (!duplicate) return { duplicated: false }
  const existing = await resolvePrivateBook(userId, duplicate.versionId, { allowDeleted: true, showHidden: true })
  return { duplicated: true, bookId: existing.id, title: existing.title }
}

export async function importLocalBookFromClient(
  userId: string,
  file: File,
  payload: LocalBookImportPayload,
  assets: { cover?: File; noteImages?: Map<string, File> } = {},
) {
  assertUserUploadAllowed(userId)
  if (!file.size || file.size > effectiveUploadMaxBytes()) throw new AppError('UPLOAD_TOO_LARGE', 'File too large')

  const priorVersionId = parseImportReceipt(userId, payload.requestId)
  if (priorVersionId) {
    const existing = stripMetaChapters(await resolvePrivateBook(userId, priorVersionId, { allowDeleted: true, showHidden: true }))
    return { book: existing, requestId: payload.requestId }
  }

  const db = getDb()
  const libraryId = ensurePrivateLibrary(db, userId)
  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > effectiveUploadMaxBytes()) throw new AppError('UPLOAD_TOO_LARGE', 'File too large')

  const duplicate = findPersonalVersionByBlob(libraryId, blobKey(sha256(buffer), '.epub'), payload.book.format)
  if (duplicate) {
    const existing = await resolvePrivateBook(userId, duplicate.versionId, { allowDeleted: true, showHidden: true })
    throw new AppError('BOOK_DUPLICATE', 'A book with identical content already exists on the server', {
      bookId: existing.id,
      title: existing.title,
    })
  }

  const versionId = createId('book')
  const revisionId = createId('rev')
  const libraryBookId = createId('lb')
  const upload = await materializeUpload(userId, file, buffer, versionId, {
    normalizeTitle: false,
    txtRulePatterns: payload.book.txtRulePatterns,
    txtChapters: payload.book.txtChapters,
  })
  const customCover = assets.cover ? await prepareCustomCover(assets.cover) : null
  const preparedImages = assets.noteImages?.size ? await prepareNoteImages(assets.noteImages) : new Map<string, PreparedNoteImage>()

  const effectiveCoverKey = customCover?.coverKey ?? upload.coverKey
  const effectiveCoverSize = customCover?.coverSize ?? upload.coverSize
  const effectiveMeta = {
    ...upload.meta,
    ...(payload.book.fileName ? { fileName: payload.book.fileName } : {}),
    ...(payload.book.catalog?.coverPaletteId ? { coverPaletteId: payload.book.catalog.coverPaletteId } : {}),
  }

  const authors = normalizeAuthors({ authors: payload.book.authors })
  const now = Date.now()
  let importedVersionId = versionId
  let replayed = false

  try {
    db.transaction((tx) => {
      const replayVersionId = parseImportReceipt(userId, payload.requestId)
      if (replayVersionId) {
        importedVersionId = replayVersionId
        replayed = true
        return
      }

      const shelfId = payload.book.catalog?.shelfId
        ? tx.select({ id: shelves.id }).from(shelves).where(and(eq(shelves.id, payload.book.catalog.shelfId), eq(shelves.libraryId, libraryId))).get()?.id ?? null
        : null
      const categoryId = payload.book.catalog?.categoryId
        ? tx.select({ id: libraryCategories.id }).from(libraryCategories).where(and(eq(libraryCategories.id, payload.book.catalog.categoryId), eq(libraryCategories.libraryId, libraryId))).get()?.id ?? null
        : null
      const candidateTagIds = [...new Set(payload.book.catalog?.tagIds ?? [])]
      const tagIds = candidateTagIds.length
        ? tx.select({ id: libraryTags.id }).from(libraryTags).where(and(eq(libraryTags.libraryId, libraryId), inArray(libraryTags.id, candidateTagIds))).all().map((row) => row.id)
        : []

      tx.insert(bookVersions).values({
        id: versionId,
        format: upload.format,
        size: upload.size,
        createdAt: payload.book.createdAt,
        updatedAt: payload.book.updatedAt,
      }).run()

      tx.insert(contentRevisions).values({
        id: revisionId,
        bookVersionId: versionId,
        revisionNo: 1,
        blobKey: upload.fileKey,
        size: upload.size,
        wordCount: upload.wordCount,
        chapterCount: upload.chapterCount,
        meta: effectiveMeta,
        createdAt: payload.book.createdAt,
      }).run()

      tx.insert(blobs).values({ key: upload.fileKey, size: upload.size, kind: 'book', createdAt: now }).onConflictDoNothing().run()
      if (effectiveCoverKey && effectiveCoverSize !== null) {
        tx.insert(blobs).values({ key: effectiveCoverKey, size: effectiveCoverSize, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
      }
      for (const img of preparedImages.values()) {
        tx.insert(blobs).values({ key: img.blobKey, size: img.size, kind: 'content', createdAt: now }).onConflictDoNothing().run()
      }

      const workMeta = payload.book.catalog?.metadata ? { ...payload.book.catalog.metadata } : {}
      tx.insert(libraryBooks).values({
        id: libraryBookId,
        libraryId,
        userId,
        shelfId,
        categoryId,
        title: payload.book.title,
        author: authors.author,
        authors: authors.authors,
        description: typeof payload.book.catalog?.metadata?.description === 'string'
          ? payload.book.catalog.metadata.description
          : upload.description,
        coverKey: effectiveCoverKey,
        hidden: payload.book.catalog?.hidden ?? false,
        meta: workMeta,
        createdAt: payload.book.createdAt,
        updatedAt: payload.book.updatedAt,
      }).run()

      tx.insert(libraryBookVersions).values({
        id: createId('lbv'),
        libraryId,
        libraryBookId,
        bookVersionId: versionId,
        kind: 'personal',
        pinnedAt: payload.book.catalog?.pinnedAt ?? null,
        createdAt: payload.book.createdAt,
        updatedAt: payload.book.updatedAt,
      }).run()

      if (tagIds.length > 0) {
        tx.insert(libraryBookTags).values(tagIds.map((tagId) => ({ libraryBookId, tagId }))).onConflictDoNothing().run()
      }

      const localState = payload.state
      const positionMatched = Boolean(localState?.cfi && (!localState.positionContentId || localState.positionContentId === payload.book.contentId))
      const coverageMatched = Boolean(!localState?.coverageContentId || localState.coverageContentId === payload.book.contentId)
      const stateIntervals = coverageMatched ? normalizeCoverage(localState?.coverageIntervals ?? []) : []
      const stateFraction = positionMatched ? (localState?.fraction ?? null) : null
      const statePercent = stateFraction !== null ? stateFraction * 100 : 0
      const stateCfi = positionMatched ? (localState?.layoutCfi ?? localState?.cfi ?? null) : null
      const contentCfi = positionMatched ? (localState?.cfi ?? null) : null
      const progressUpdatedAt = localState?.lastReadAt ?? payload.book.updatedAt

      tx.insert(bookStates).values({
        userId,
        bookVersionId: versionId,
        readStatus: localState?.readStatus ?? 'reading',
        percent: Math.round(statePercent),
        cfi: stateCfi,
        chapter: positionMatched ? (localState?.chapter ?? null) : null,
        lastReadAt: localState?.lastReadAt ?? null,
        readRevisionId: revisionId,
        progressRevisionId: positionMatched ? revisionId : null,
        coverageRevisionId: coverageMatched ? revisionId : null,
        readFraction: unionLength(stateIntervals),
        progressData: {
          progressRevisionId: positionMatched ? revisionId : null,
          coverageRevisionId: coverageMatched ? revisionId : null,
          cfi: stateCfi,
          contentCfi,
          chapter: positionMatched ? (localState?.chapter ?? null) : null,
          percent: statePercent,
          fraction: stateFraction,
          intervals: stateIntervals,
          updatedAt: progressUpdatedAt,
        },
        updatedAt: progressUpdatedAt,
      }).run()

      const seenBookmarkCfis = new Set<string>()
      const seenHighlightCfis = new Set<string>()
      for (const note of payload.notes) {
        const anchorMatched = Boolean(note.cfi && (!note.contentId || note.contentId === payload.book.contentId))
        const noteRevisionId = anchorMatched ? revisionId : null
        const relocation = note.cfi && !anchorMatched ? 'unresolved' as const : 'ok' as const
        const cfi = note.cfi ?? null

        if (note.kind === 'bookmark') {
          if (cfi && seenBookmarkCfis.has(cfi)) continue
          if (cfi) seenBookmarkCfis.add(cfi)
          tx.insert(bookmarks).values({
            id: createId('bm'),
            userId,
            bookVersionId: versionId,
            revisionId: noteRevisionId,
            cfi,
            chapter: note.chapter ?? null,
            chapterHref: note.href ?? null,
            title: note.title ?? null,
            contextText: note.context ?? null,
            relocation,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          }).run()
        } else if (note.kind === 'highlight') {
          if (cfi && seenHighlightCfis.has(cfi)) continue
          if (cfi) seenHighlightCfis.add(cfi)
          tx.insert(highlights).values({
            id: createId('hl'),
            userId,
            bookVersionId: versionId,
            revisionId: noteRevisionId,
            cfiRange: cfi,
            color: note.color ?? 'yellow',
            style: note.style ?? 'highlight',
            text: note.text ?? '',
            chapter: note.chapter ?? null,
            chapterHref: note.href ?? null,
            relocation,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          }).run()
        } else {
          const ideaId = createId('idea')
          tx.insert(ideas).values({
            id: ideaId,
            userId,
            bookVersionId: versionId,
            cfiRange: cfi,
            color: note.color ?? 'yellow',
            style: note.style ?? 'underline',
            text: note.text ?? '',
            note: note.body ?? '',
            visibility: 'private',
            revisionId: noteRevisionId,
            relocation,
            chapter: note.chapter ?? null,
            chapterHref: note.href ?? null,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          }).run()

          const imageIds = (note.imageIds ?? []).filter((id) => preparedImages.has(id))
          if (imageIds.length > 0) {
            const draftId = createId('cdraft')
            tx.insert(contentUploadDrafts).values({
              id: createId('cud'),
              userId,
              draftId,
              domain: 'idea',
              bookVersionId: versionId,
              intendedTargetId: ideaId,
              createdAt: note.createdAt,
            }).run()
            imageIds.forEach((imageId, index) => {
              const img = preparedImages.get(imageId)!
              tx.insert(blobs).values({
                key: img.blobKey,
                kind: 'content',
                size: img.size,
                createdAt: note.createdAt,
              }).onConflictDoNothing().run()
              tx.insert(contentFiles).values({
                id: createId('cfile'),
                userId,
                domain: 'idea',
                kind: 'image',
                draftId,
                bookVersionId: versionId,
                intendedTargetId: ideaId,
                ideaId,
                blobKey: img.blobKey,
                name: img.name,
                mimeType: img.mimeType,
                size: img.size,
                sortOrder: index,
                ready: true,
                createdAt: note.createdAt,
              }).run()
            })
          }
        }
      }

      if (payload.review) {
        const ratingHalves = payload.review.ratingHalves && payload.review.ratingHalves >= 1
          ? payload.review.ratingHalves
          : null
        tx.insert(bookReviews).values({
          id: createId('rev'),
          userId,
          privateLibraryBookId: libraryBookId,
          ratingHalves,
          title: payload.review.title || null,
          body: payload.review.body || null,
          bodyFormat: payload.review.bodyFormat,
          visibility: 'private',
          readBookVersionId: versionId,
          readRevisionId: revisionId,
          createdAt: payload.review.createdAt,
          updatedAt: payload.review.updatedAt,
        }).run()
      }

      const roundIdByOrdinal = new Map<number, string>()
      if (payload.rounds.length > 0 || payload.sessions.length > 0) {
        const roundsToInsert = payload.rounds.length > 0
          ? payload.rounds
          : [{ ordinal: 1, status: (localState?.readStatus === 'finished' || localState?.readStatus === 'abandoned' ? localState.readStatus : 'reading') as 'reading' | 'finished' | 'abandoned', startedAt: null, endedAt: null }]
        for (const round of roundsToInsert) {
          const roundSessions = payload.sessions.filter((session) => session.roundOrdinal === round.ordinal)
          const earliestSessionTime = roundSessions
            .map((s) => s.startedAt)
            .filter((ts): ts is number => ts !== null)
            .sort((a, b) => a - b)[0]
          const roundId = createId('rrd')
          roundIdByOrdinal.set(round.ordinal, roundId)
          tx.insert(readingRounds).values({
            id: roundId,
            userId,
            bookVersionId: versionId,
            ordinal: round.ordinal,
            status: round.status,
            startedAt: round.startedAt ?? earliestSessionTime ?? payload.book.createdAt,
            endedAt: round.status === 'reading' ? null : (round.endedAt ?? payload.book.updatedAt),
          }).run()
        }
      }

      for (const session of payload.sessions) {
        const roundId = roundIdByOrdinal.get(session.roundOrdinal) ?? roundIdByOrdinal.values().next().value ?? null
        const fragments = mergeTimeFragments(session.fragments)
        const durationSeconds = Math.max(1, Math.round(session.durationSeconds))
        const sessionRevisionId = !session.contentId || session.contentId === payload.book.contentId ? revisionId : null
        const sessionId = createId('rs')
        const serverRequestId = `local:${payload.requestId}:${session.requestId}`
        const bodyHash = sha256(Buffer.from(JSON.stringify({ bookId: versionId, sessionId, requestId: serverRequestId })))
        tx.insert(readingSessions).values({
          id: sessionId,
          userId,
          bookId: versionId,
          bookVersionId: versionId,
          roundId,
          date: session.date,
          sortDate: session.date,
          sortStartedAt: session.startedAt ?? 0,
          startedAt: session.startedAt,
          endedAt: session.endedAt ?? null,
          durationSeconds,
          requestId: serverRequestId,
          bodyHash,
          source: session.source,
          timezone: session.timezone ?? null,
          fragments,
          coverage: normalizeCoverage(session.coverage),
          revisionId: sessionRevisionId,
          wordCount: session.wordCount ?? (sessionRevisionId ? upload.wordCount : null),
          startCfi: session.startCfi ?? null,
          endCfi: session.endCfi ?? null,
          startFraction: session.startFraction ?? null,
          endFraction: session.endFraction ?? null,
          startChapterIndex: session.startChapterIndex ?? null,
          endChapterIndex: session.endChapterIndex ?? null,
        }).run()
        tx.insert(readingWriteReceipts).values({
          userId,
          requestId: serverRequestId,
          bookVersionId: versionId,
          bodyHash,
          sessionId,
          status: 'accepted',
        }).run()
      }

      if (payload.sessions.length > 0 || payload.rounds.length > 0 || stateIntervals.length > 0) {
        tx.insert(readingArchives).values({
          userId,
          bookVersionId: versionId,
          title: payload.book.title,
          author: authors.author,
          format: upload.format,
          coverKey: effectiveCoverKey,
          legacyIntervals: payload.rounds.length <= 1 && payload.sessions.length === 0 ? stateIntervals : [],
          legacyWordCount: upload.wordCount,
          legacyRevisionId: revisionId,
          legacyDaily: [],
          createdAt: payload.book.createdAt,
          updatedAt: now,
        }).run()
        rebuildReadingProjection(tx as unknown as Parameters<typeof rebuildReadingProjection>[0], userId, versionId)

        if (stateIntervals.length > 0) {
          const after = tx.select({ readFraction: bookStates.readFraction, progressData: bookStates.progressData }).from(bookStates)
            .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, versionId))).get()
          const mergedIntervals = normalizeCoverage([...(after?.progressData?.intervals ?? []), ...stateIntervals])
          const mergedFraction = unionLength(mergedIntervals)
          if (after && mergedFraction > after.readFraction) {
            tx.update(bookStates).set({
              readFraction: mergedFraction,
              progressData: { ...(after.progressData ?? { percent: statePercent, intervals: [], updatedAt: progressUpdatedAt }), intervals: mergedIntervals },
            }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, versionId))).run()
          }
        }
      }

      if (payload.pointRules.length > 0) {
        const existingMax = tx.select({ sortOrder: textReplacements.sortOrder }).from(textReplacements)
          .where(eq(textReplacements.userId, userId)).all().reduce((max, row) => Math.max(max, row.sortOrder), -1)
        payload.pointRules.forEach((rule, index) => {
          const matched = !rule.contentId || rule.contentId === payload.book.contentId
          tx.insert(textReplacements).values({
            id: createId('tr'),
            userId,
            bookId: versionId,
            bookVersionId: versionId,
            matchType: 'point',
            replacement: rule.replacement,
            enabled: rule.enabled ? 1 : 0,
            sortOrder: existingMax + 1 + index,
            name: rule.name ?? null,
            group: rule.group ?? null,
            spineHref: rule.spineHref,
            textOffset: rule.textOffset,
            originalText: rule.originalText,
            relocation: matched ? rule.relocation : 'unresolved',
            createdAt: rule.createdAt,
            updatedAt: rule.updatedAt,
          }).run()
        })
      }

      const overrideEntries = Object.entries(payload.replacementOverrides)
      if (overrideEntries.length > 0) {
        const validRuleIds = new Set(
          tx.select({ id: textReplacements.id }).from(textReplacements)
            .where(and(eq(textReplacements.userId, userId), inArray(textReplacements.id, overrideEntries.map(([id]) => id))))
            .all().map((row) => row.id),
        )
        for (const [replacementId, enabled] of overrideEntries) {
          if (!validRuleIds.has(replacementId)) continue
          tx.insert(textReplacementOverrides).values({
            id: createId('tro'),
            userId,
            bookId: versionId,
            bookVersionId: versionId,
            replacementId,
            enabled: enabled ? 1 : 0,
            createdAt: now,
            updatedAt: now,
          }).run()
        }
      }

      tx.insert(settings).values({
        id: createId('setting'),
        userId,
        key: receiptKey(payload.requestId),
        value: { bookVersionId: versionId, createdAt: now },
      }).run()
    })
  } catch (error) {
    await cleanupStagedUpload(upload)
    if (customCover) await cleanupStagedCover(customCover.coverKey)
    await cleanupPreparedNoteImages(preparedImages)
    throw error
  }

  if (replayed) {
    await cleanupStagedUpload(upload)
    if (customCover) await cleanupStagedCover(customCover.coverKey)
    await cleanupPreparedNoteImages(preparedImages)
    const existing = stripMetaChapters(await resolvePrivateBook(userId, importedVersionId, { allowDeleted: true, showHidden: true }))
    return { book: existing, requestId: payload.requestId }
  }

  if (payload.readerSettings && (payload.readerSettings.viewSettings !== undefined || payload.readerSettings.boundPresetId !== undefined)) {
    try {
      updateReaderBookSettings(userId, importedVersionId, payload.readerSettings)
    } catch (error) {
      log('warn', 'local_import.reader_settings_failed', { error, meta: { versionId: importedVersionId } })
    }
  }

  try {
    enqueueReaderArchivePreparation({
      id: importedVersionId,
      filePath: upload.fileKey,
      format: upload.format,
      revisionId,
      contentHash: hashFromBlobKey(upload.fileKey),
      size: upload.size,
    })
  } catch (error) {
    log('warn', 'local_import.prebuild_enqueue_failed', { error, meta: { versionId: importedVersionId } })
  }

  const imported = stripMetaChapters(await resolvePrivateBook(userId, importedVersionId, { allowDeleted: true, showHidden: true }))
  return { book: imported, requestId: payload.requestId }
}
