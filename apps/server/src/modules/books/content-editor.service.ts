import { and, desc, eq, or } from 'drizzle-orm'

import type { EditorEpubLoadRes, EditorEpubSaveReq, EditorTxtSaveReq, EditorTxtSaveRes, TocRulePattern } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { blobKeyReferenced } from '../../db/blob-refs'
import { blobs, bookStates, bookVersions, bookmarks, contentRevisionMaps, contentRevisions, highlights, ideas, libraryBookVersions, libraryBooks, textReplacements, tocRules } from '../../db/schema'
import { blobKey } from '../../lib/cover'
import { createId } from '../../lib/id'
import { sha256 } from '../../lib/hash'
import { log } from '../../lib/logger'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { assertCanContribute, assertMutableContent } from '../libraries/library-access'
import { convertTxtToEpub, TXT_EPUB_ARTIFACT_VERSION } from '../../lib/txt-to-epub'
import { countWords } from '../../lib/word-count'
import { createEpubRevisionMap, extractEpubSpineText } from './epub-revision-map'
import { txtChapterId } from '../../formats/txt'
import { composeRevisionStructuralRanges, persistContentRevisionMaps } from './revision-map.persistence'
import { composeRevisionMaps, mapRevisionTextPosition, projectRevisionCoverage, type RevisionMapSegment, type RevisionSectionPosition } from './revision-map'
import { enqueueReaderArchivePreparation } from './reader-content.service'
import { bufferFromStream, getActiveBook, getOrRecoverTxtNormalized, resolveLibraryBook } from './books.service'
import { unionLength } from '../../lib/intervals'
import type { ProgressFileData } from '../../lib/progress-file'
import { patchEpubPackage, readEpubEditorPackage } from './epub-editor-package'
import { loadEpubSpineMarkup } from '../../formats/epub'
import { EpubParser } from '../../formats/epub'
import { cfiSpineIndex, createEpubCfiTextOffset, createEpubCfiTextRange, resolveEpubCfiTextRange, resolveEpubCfiTextStart } from './epub-cfi-position'

type RevisionProjection = Awaited<ReturnType<typeof createEpubRevisionMap>>

export interface EditorTarget {
  libraryId: string
  libraryBookId: string
  versionLinkId: string
}

async function assertManagedEditorTarget(userId: string, bookId: string, target: EditorTarget): Promise<void> {
  await assertCanContribute(userId, target.libraryId, target.versionLinkId)
  const link = getDb().select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.id, target.versionLinkId), eq(libraryBookVersions.libraryId, target.libraryId),
      eq(libraryBookVersions.libraryBookId, target.libraryBookId))).get()
  if (!link || link.bookVersionId !== bookId) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
}

export async function getEditorAccess(userId: string, bookId: string, target?: EditorTarget): Promise<{ revisionId: string }> {
  if (target) await assertManagedEditorTarget(userId, bookId, target)
  else assertMutableContent(resolveLibraryBook(userId, bookId).kind)
  const book = await getActiveBook(userId, bookId, { showHidden: true })
  if (!book.revisionId) throw new AppError('BOOK_NOT_FOUND', 'Book content revision is unavailable')
  return { revisionId: book.revisionId }
}

type ReaderPositionAnchor = NonNullable<ProgressFileData['positionAnchor']>
type MappedReaderPosition = NonNullable<ReturnType<typeof mapRevisionTextPosition>>

function withRestorableCfi(
  position: MappedReaderPosition | null,
  targetSections: RevisionSectionPosition[],
  targetMarkups: Map<string, string>,
): (MappedReaderPosition & { cfi: string }) | null {
  if (!position) return null
  const markup = targetMarkups.get(position.spineHref)
  const spineIndex = targetSections.findIndex((section) => section.spineHref === position.spineHref)
  const cfi = markup && spineIndex >= 0 ? createEpubCfiTextOffset(markup, spineIndex, position.textOffset) : null
  return cfi ? { ...position, cfi } : null
}

function mapPointReplacementAnchor(
  row: typeof textReplacements.$inferSelect,
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

function mapAnnotationAnchor(
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

async function resolveReaderPositionAnchors(
  bookVersionId: string,
  baseRevisionId: string,
  baseEpub: Buffer | null,
  states: Array<typeof bookStates.$inferSelect>,
): Promise<Map<string, ReaderPositionAnchor>> {
  const anchors = new Map<string, ReaderPositionAnchor>()
  const sourceMarkupCache = new Map<string, Awaited<ReturnType<typeof loadEpubSpineMarkup>> | null>()
  const storage = getStorage()
  const db = getDb()
  for (const row of states) {
    const previous = row.progressData
    const basisId = row.progressRevisionId ?? previous?.progressRevisionId ?? baseRevisionId
    if (previous?.positionAnchor?.revisionId === basisId) {
      anchors.set(row.userId, previous.positionAnchor)
      continue
    }
    const cfi = previous?.contentCfi ?? previous?.cfi ?? row.cfi
    if (!cfi) continue
    let sourceMarkup = sourceMarkupCache.get(basisId)
    if (sourceMarkup === undefined) {
      try {
        let epub: Buffer | null = basisId === baseRevisionId ? baseEpub : null
        if (!epub) {
          const revision = db.select({ blobKey: contentRevisions.blobKey }).from(contentRevisions).where(and(
            eq(contentRevisions.bookVersionId, bookVersionId), eq(contentRevisions.id, basisId),
          )).get()
          if (revision && await storage.exists(revision.blobKey)) epub = await bufferFromStream(await storage.get(revision.blobKey))
        }
        sourceMarkup = epub ? await loadEpubSpineMarkup(epub) : null
      } catch {
        sourceMarkup = null
      }
      sourceMarkupCache.set(basisId, sourceMarkup)
    }
    if (!sourceMarkup) continue
    const spineIndex = cfiSpineIndex(cfi, previous?.chapterIndex)
    const section = spineIndex === null ? undefined : sourceMarkup[spineIndex]
    if (!section) continue
    const textOffset = resolveEpubCfiTextStart(section.markup, cfi)
    if (textOffset === null) continue
    anchors.set(row.userId, { revisionId: basisId, spineHref: section.href, textOffset })
  }
  return anchors
}

async function prepareReaderStateRevisionMaps(
  bookVersionId: string,
  baseRevisionId: string,
  direct: RevisionProjection | null,
  states: Array<typeof bookStates.$inferSelect>,
): Promise<Map<string, RevisionProjection>> {
  const projections = new Map<string, RevisionProjection>()
  if (!direct) return projections
  projections.set(baseRevisionId, direct)
  const basisIds = new Set(states.flatMap((row) => [
    row.progressRevisionId ?? row.progressData?.progressRevisionId,
    row.coverageRevisionId ?? row.progressData?.coverageRevisionId ?? row.progressRevisionId ?? row.progressData?.progressRevisionId,
  ]).filter((revisionId): revisionId is string => Boolean(revisionId && revisionId !== baseRevisionId)))
  const db = getDb()
  const storage = getStorage()
  for (const sourceRevisionId of basisIds) {
    const storedMap = db.select().from(contentRevisionMaps).where(and(
      eq(contentRevisionMaps.bookVersionId, bookVersionId),
      eq(contentRevisionMaps.sourceRevisionId, sourceRevisionId),
      eq(contentRevisionMaps.targetRevisionId, baseRevisionId),
    )).get()
    if (!storedMap?.segments.length) continue
    let sourceSections: RevisionSectionPosition[] = storedMap.sourceSections
    if (sourceSections.length === 0) {
      const oldRevision = db.select({ blobKey: contentRevisions.blobKey }).from(contentRevisions).where(and(
        eq(contentRevisions.bookVersionId, bookVersionId), eq(contentRevisions.id, sourceRevisionId),
      )).get()
      if (!oldRevision || !(await storage.exists(oldRevision.blobKey))) continue
      try {
        const oldContent = await bufferFromStream(await storage.get(oldRevision.blobKey))
        sourceSections = (await createEpubRevisionMap(oldContent, oldContent)).sourceSections
      } catch {
        continue
      }
    }
    projections.set(sourceRevisionId, {
      segments: composeRevisionMaps(storedMap.segments, direct.segments),
      sourceSections,
      targetSections: direct.targetSections,
      structuralRanges: composeRevisionStructuralRanges(storedMap.structuralRanges, storedMap.segments,
        direct.segments, direct.structuralRanges),
    })
  }
  return projections
}

export async function saveEditorTxtContent(userId: string, bookId: string, input: EditorTxtSaveReq): Promise<EditorTxtSaveRes> {
  return saveTxtContent(userId, bookId, input)
}

export async function saveManagedEditorTxtContent(
  userId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  expectedBookVersionId: string,
  input: EditorTxtSaveReq,
): Promise<EditorTxtSaveRes> {
  await assertManagedEditorTarget(userId, expectedBookVersionId, { libraryId, libraryBookId, versionLinkId })
  return saveTxtContent(userId, expectedBookVersionId, input, { libraryId, libraryBookId })
}

export async function saveEditorEpubContent(userId: string, bookId: string, input: EditorEpubSaveReq): Promise<EditorTxtSaveRes> {
  return saveEpubContent(userId, bookId, input)
}

export async function getEditorEpubContent(userId: string, bookId: string): Promise<EditorEpubLoadRes> {
  const book = await getActiveBook(userId, bookId, { showHidden: true })
  if (book.format !== 'epub') throw new AppError('UNSUPPORTED_FORMAT', 'EPUB editor content is unavailable for this format')
  if (!book.revisionId) throw new AppError('BOOK_NOT_FOUND', 'Book content revision is unavailable')
  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  try {
    return { revisionId: book.revisionId, ...await readEpubEditorPackage(await bufferFromStream(await storage.get(book.filePath))) }
  } catch (error) {
    throw new AppError('READER_ENTRY_FAILED', 'EPUB editor content could not be loaded', error instanceof Error ? error.message : undefined)
  }
}

export async function saveManagedEditorEpubContent(
  userId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  expectedBookVersionId: string,
  input: EditorEpubSaveReq,
): Promise<EditorTxtSaveRes> {
  await assertManagedEditorTarget(userId, expectedBookVersionId, { libraryId, libraryBookId, versionLinkId })
  return saveEpubContent(userId, expectedBookVersionId, input, { libraryId, libraryBookId })
}

async function saveEpubContent(
  userId: string,
  bookId: string,
  input: EditorEpubSaveReq,
  managedContext?: { libraryId: string; libraryBookId: string },
): Promise<EditorTxtSaveRes> {
  const db = getDb()
  const { kind, libraryBookId } = managedContext
    ? { kind: 'shared', libraryBookId: managedContext.libraryBookId }
    : resolveLibraryBook(userId, bookId)
  if (!managedContext) assertMutableContent(kind)
  const book = await getActiveBook(userId, bookId, { showHidden: true })
  if (book.format !== 'epub') throw new AppError('UNSUPPORTED_FORMAT', 'The EPUB editor cannot save this format')
  if (!book.revisionId || book.revisionId !== input.baseRevisionId) {
    throw new AppError('VALIDATION_ERROR', 'Content revision changed; reopen the editor')
  }

  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const source = await bufferFromStream(await storage.get(book.filePath))
  let updated: Buffer
  let revisionMapping: Awaited<ReturnType<typeof createEpubRevisionMap>>
  try {
    updated = await patchEpubPackage(source, input)
    revisionMapping = await createEpubRevisionMap(source, updated)
  } catch (error) {
    throw new AppError('VALIDATION_ERROR', 'EPUB edits could not be applied', error instanceof Error ? error.message : undefined)
  }
  const contentHash = sha256(updated)
  const [sourceTexts, targetTexts, sourceSpineMarkup, targetSpineMarkup] = await Promise.all([
    extractEpubSpineText(source), extractEpubSpineText(updated), loadEpubSpineMarkup(source), loadEpubSpineMarkup(updated),
  ])
  const sourceMarkups = new Map(sourceSpineMarkup.map((section) => [section.href, section.markup]))
  const targetMarkups = new Map(targetSpineMarkup.map((section) => [section.href, section.markup]))
  const filePath = blobKey(contentHash, '.epub')
  const revisionId = createId('rev')
  const now = Date.now()
  const revisionNo = db.select({ revisionNo: contentRevisions.revisionNo }).from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get()?.revisionNo ?? 0
  const parsedBook = await new EpubParser().parse(updated)
  const priorChapters = Array.isArray(book.meta.chapters) ? book.meta.chapters as Array<{ id?: string; addedAt?: number }> : []
  const chapters = parsedBook.chapters.map((chapter, index) => ({
    id: priorChapters[index]?.id ?? `ch-${index}`,
    title: chapter.title,
    level: chapter.level ?? 1,
    startOffset: 0,
    endOffset: 0,
    wordCount: chapter.wordCount ?? countWords(targetTexts.get(chapter.content) ?? ''),
    ...(priorChapters[index]?.addedAt ? { addedAt: priorChapters[index]!.addedAt } : {}),
  }))
  const wordCount = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  const meta: Record<string, unknown> = { ...book.meta, chapters, wordCount, epubTocLevelVersion: 1 }
  delete meta.readingCompatibleRevisions
  let unlocated: EditorTxtSaveRes['unlocated'] = { progress: 0, coverage: 0, highlights: 0, bookmarks: 0, notes: 0, pointReplacements: 0 }
  const readerStates = db.select().from(bookStates).where(eq(bookStates.bookVersionId, bookId)).all()
  const stateMappings = await prepareReaderStateRevisionMaps(bookId, input.baseRevisionId, revisionMapping, readerStates)
  const positionAnchors = await resolveReaderPositionAnchors(bookId, input.baseRevisionId, source, readerStates)
  await storage.put(filePath, updated)
  try {
    db.transaction((tx) => {
      const latest = tx.select({ id: contentRevisions.id }).from(contentRevisions)
        .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get()
      if (latest?.id !== input.baseRevisionId) throw new AppError('VALIDATION_ERROR', 'Content revision changed; reopen the editor')
      tx.insert(contentRevisions).values({
        id: revisionId, bookVersionId: bookId, revisionNo: revisionNo + 1,
        blobKey: filePath, size: updated.length, wordCount, chapterCount: chapters.length,
        meta, createdAt: now,
      }).run()
      tx.insert(blobs).values({ key: filePath, size: updated.length, kind: 'book', createdAt: now }).onConflictDoNothing().run()
      tx.update(bookVersions).set({ size: updated.length, updatedAt: now }).where(eq(bookVersions.id, bookId)).run()
      const affectedLibraryBookIds = kind === 'shared'
        ? tx.select({ id: libraryBookVersions.libraryBookId }).from(libraryBookVersions)
            .where(eq(libraryBookVersions.bookVersionId, bookId)).all().map((row) => row.id)
        : [libraryBookId]
      for (const affectedId of new Set(affectedLibraryBookIds)) {
        tx.update(libraryBooks).set({ updatedAt: now }).where(eq(libraryBooks.id, affectedId)).run()
      }
      tx.update(libraryBookVersions).set({ pinnedRevisionId: revisionId }).where(and(
        eq(libraryBookVersions.bookVersionId, bookId), eq(libraryBookVersions.kind, 'shared'),
      )).run()
      persistContentRevisionMaps(tx, {
        bookVersionId: bookId, sourceRevisionId: input.baseRevisionId, targetRevisionId: revisionId,
        directSegments: revisionMapping.segments, directSourceSections: revisionMapping.sourceSections,
        directTargetSections: revisionMapping.targetSections, directStructuralRanges: revisionMapping.structuralRanges,
      })
      const pointRows = tx.select().from(textReplacements).where(and(
        eq(textReplacements.matchType, 'point'), eq(textReplacements.relocation, 'ok'),
        or(eq(textReplacements.bookId, bookId), eq(textReplacements.bookVersionId, bookId)),
      )).all()
      for (const row of pointRows) {
        const mapped = mapPointReplacementAnchor(row, revisionMapping.segments, sourceTexts, targetTexts)
        if (mapped) {
          if (mapped.spineHref !== row.spineHref || mapped.textOffset !== row.textOffset) {
            tx.update(textReplacements).set({ ...mapped, updatedAt: now }).where(eq(textReplacements.id, row.id)).run()
          }
        } else {
          unlocated.pointReplacements += 1
          tx.update(textReplacements).set({ relocation: 'unresolved', updatedAt: now }).where(eq(textReplacements.id, row.id)).run()
        }
      }
      for (const row of tx.select().from(bookStates).where(eq(bookStates.bookVersionId, bookId)).all()) {
        const previous: ProgressFileData = row.progressData ?? {
          progressRevisionId: row.progressRevisionId,
          cfi: row.cfi,
          chapter: row.chapter,
          percent: row.percent,
          intervals: [],
          updatedAt: row.updatedAt,
        }
        const hadPosition = Boolean(previous.cfi || previous.fraction !== null && previous.fraction !== undefined)
        const hadCoverage = (previous.intervals?.length ?? 0) > 0
        const positionBasis = row.progressRevisionId ?? previous.progressRevisionId ?? input.baseRevisionId
        const coverageBasis = row.coverageRevisionId ?? previous.coverageRevisionId ?? row.progressRevisionId ?? previous.progressRevisionId ?? input.baseRevisionId
        const historicalPositions = hadPosition || hadCoverage
          ? [...(previous.historicalPositions ?? []), {
              progressRevisionId: positionBasis,
              coverageRevisionId: coverageBasis,
              cfi: previous.cfi ?? null, chapter: previous.chapter ?? null,
              chapterIndex: previous.chapterIndex ?? null, percent: previous.percent,
              fraction: previous.fraction ?? null, intervals: previous.intervals ?? [], updatedAt: previous.updatedAt,
            }]
          : previous.historicalPositions
        const positionMapping = stateMappings.get(positionBasis)
        const coverageMapping = hadCoverage ? stateMappings.get(coverageBasis) : revisionMapping
        const sourcePosition = positionAnchors.get(row.userId)
        const mappedPosition = positionMapping && sourcePosition
          ? withRestorableCfi(mapRevisionTextPosition(sourcePosition.spineHref, sourcePosition.textOffset,
              positionMapping.targetSections, positionMapping.segments), positionMapping.targetSections, targetMarkups)
          : null
        const mappedIntervals = coverageMapping
          ? projectRevisionCoverage(previous.intervals ?? [], coverageMapping.sourceSections, coverageMapping.targetSections, coverageMapping.segments, coverageMapping.structuralRanges)
          : previous.intervals ?? []
        if (hadPosition && !mappedPosition) unlocated.progress += 1
        if (hadCoverage && !coverageMapping) unlocated.coverage += 1
        const progressRevisionId = mappedPosition ? revisionId : positionBasis
        const coverageRevisionId = coverageMapping ? revisionId : coverageBasis
        const nextProgress = {
          ...previous,
          progressRevisionId,
          coverageRevisionId,
          cfi: mappedPosition?.cfi ?? null,
          contentCfi: mappedPosition?.cfi ?? null,
          chapter: mappedPosition?.title ?? null,
          chapterIndex: mappedPosition?.chapterIndex ?? null,
          percent: mappedPosition ? mappedPosition.fraction * 100 : 0,
          fraction: mappedPosition?.fraction ?? null,
          positionAnchor: mappedPosition
            ? { revisionId, spineHref: mappedPosition.spineHref, textOffset: mappedPosition.textOffset, cfi: mappedPosition.cfi }
            : previous.positionAnchor ?? null,
          intervals: mappedIntervals,
          updatedAt: now,
          ...(historicalPositions ? { historicalPositions } : {}),
        }
        tx.update(bookStates).set({
          cfi: nextProgress.cfi ?? null, chapter: nextProgress.chapter, percent: nextProgress.percent,
          readFraction: coverageMapping ? unionLength(mappedIntervals) : 0,
          progressRevisionId,
          coverageRevisionId,
          progressData: nextProgress, updatedAt: now,
        }).where(and(eq(bookStates.userId, row.userId), eq(bookStates.bookVersionId, bookId))).run()
      }
      for (const row of tx.select().from(highlights).where(eq(highlights.bookVersionId, bookId)).all()) {
        if (row.revisionId && row.revisionId !== input.baseRevisionId || row.relocation === 'unresolved') continue
        const mapped = mapAnnotationAnchor(row.cfiRange, row.chapterHref, revisionMapping.sourceSections, revisionMapping.targetSections, sourceTexts, targetTexts, sourceMarkups, targetMarkups, revisionMapping.segments)
        if (mapped) tx.update(highlights).set({ revisionId, cfiRange: mapped.cfi ?? row.cfiRange, chapterHref: mapped.chapterHref, updatedAt: now }).where(eq(highlights.id, row.id)).run()
        else {
          unlocated.highlights += 1
          tx.update(highlights).set({ relocation: 'unresolved', updatedAt: now }).where(eq(highlights.id, row.id)).run()
        }
      }
      for (const row of tx.select().from(bookmarks).where(eq(bookmarks.bookVersionId, bookId)).all()) {
        if (row.revisionId && row.revisionId !== input.baseRevisionId || row.relocation === 'unresolved') continue
        const mapped = mapAnnotationAnchor(row.cfi, row.chapterHref, revisionMapping.sourceSections, revisionMapping.targetSections, sourceTexts, targetTexts, sourceMarkups, targetMarkups, revisionMapping.segments)
        if (mapped) tx.update(bookmarks).set({ revisionId, cfi: mapped.cfi ?? row.cfi, chapterHref: mapped.chapterHref, updatedAt: now }).where(eq(bookmarks.id, row.id)).run()
        else {
          unlocated.bookmarks += 1
          tx.update(bookmarks).set({ relocation: 'unresolved', updatedAt: now }).where(eq(bookmarks.id, row.id)).run()
        }
      }
      for (const row of tx.select().from(ideas).where(eq(ideas.bookVersionId, bookId)).all()) {
        if (row.revisionId && row.revisionId !== input.baseRevisionId || row.relocation === 'unresolved') continue
        const mapped = mapAnnotationAnchor(row.cfiRange, row.chapterHref, revisionMapping.sourceSections, revisionMapping.targetSections, sourceTexts, targetTexts, sourceMarkups, targetMarkups, revisionMapping.segments)
        if (mapped) tx.update(ideas).set({ revisionId, cfiRange: mapped.cfi ?? row.cfiRange, chapterHref: mapped.chapterHref, updatedAt: now }).where(eq(ideas.id, row.id)).run()
        else {
          unlocated.notes += 1
          tx.update(ideas).set({ relocation: 'unresolved', updatedAt: now }).where(eq(ideas.id, row.id)).run()
        }
      }
    })
  } catch (error) {
    if (!blobKeyReferenced(filePath) && await storage.exists(filePath)) {
      try { await storage.delete(filePath) } catch (cleanupError) {
        log('warn', 'books.editor_staged_blob_cleanup_failed', { error: cleanupError, meta: { filePath } })
      }
    }
    throw error
  }
  enqueueReaderArchivePreparation({ id: bookId, filePath, format: 'epub', revisionId, contentHash, size: updated.length })
  return { revisionId, changed: true, unlocated }
}

function normalizeTxtEditorContent(content: string): string {
  return content.split('\n\n').map((paragraph) => paragraph.trim()).filter(Boolean).join('\n\n')
}

async function saveTxtContent(
  userId: string,
  bookId: string,
  input: EditorTxtSaveReq,
  managedContext?: { libraryId: string; libraryBookId: string },
): Promise<EditorTxtSaveRes> {
  const db = getDb()
  const { kind, libraryBookId } = managedContext
    ? { kind: 'shared', libraryBookId: managedContext.libraryBookId }
    : resolveLibraryBook(userId, bookId)
  if (!managedContext) assertMutableContent(kind)
  const book = await getActiveBook(userId, bookId, { showHidden: true })
  if (book.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'The TXT editor cannot save this format')
  if (!book.revisionId || book.revisionId !== input.baseRevisionId) {
    throw new AppError('VALIDATION_ERROR', 'Content revision changed; reopen the editor')
  }

  const originalText = await getOrRecoverTxtNormalized(book)
  const chaptersToSave = input.chapters.map((chapter) => ({
    ...chapter,
    content: normalizeTxtEditorContent(chapter.content),
  }))
  let normalized = ''
  const now = Date.now()
  const chapters = chaptersToSave.map((chapter, index) => {
    if (index > 0) normalized += '\n\n'
    const startOffset = normalized.length
    const titlePrefix = chapter.title ? chapter.title + (chapter.content ? '\n\n' : '') : ''
    normalized += titlePrefix
    const contentStartOffset = normalized.length
    normalized += chapter.content
    const endOffset = normalized.length
    const metaChapter = {
      id: txtChapterId({ startOffset }), title: chapter.title, level: chapter.level,
      startOffset, contentStartOffset, endOffset, wordCount: countWords(chapter.content),
    }
    return metaChapter
  })
  const wordCount = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  const originalChapters = Array.isArray(book.meta.chapters)
    ? book.meta.chapters as Array<{ title?: string; contentStartOffset?: number; endOffset?: number }>
    : []
  const sameTextAndSpine = normalizeTxtEditorContent(originalText) === normalizeTxtEditorContent(normalized)
    && originalChapters.length === chaptersToSave.length
    && originalChapters.every((chapter, index) => chapter.title === chaptersToSave[index]!.title
      && Number.isInteger(chapter.contentStartOffset) && Number.isInteger(chapter.endOffset)
      && normalizeTxtEditorContent(originalText.slice(chapter.contentStartOffset, chapter.endOffset)) === chaptersToSave[index]!.content)
  const chapterEntries = chapters.map(({ id, title, level }) => ({ id, title, level }))
  const epub = await convertTxtToEpub(
    { title: book.title, author: book.author || undefined, id: book.id },
    chapterEntries,
    (index) => chaptersToSave[index]!.content,
  )
  const contentHash = sha256(epub)
  const filePath = blobKey(contentHash, '.epub')
  const meta: Record<string, unknown> = {
    ...book.meta,
    chapters,
    wordCount,
    txtArtifactVersion: TXT_EPUB_ARTIFACT_VERSION,
  }
  delete meta.readingCompatibleRevisions
  delete meta.tocExcludedChapterIds
  delete meta.tocExcludedLeadingText
  if (input.tocRuleSelection) {
    const selection = input.tocRuleSelection
    if (managedContext) {
      if (selection.ruleId && (!selection.patterns || selection.patterns.length === 0)) {
        throw new AppError('VALIDATION_ERROR', 'Shared book rule selections must include frozen patterns')
      }
      if (selection.patterns?.length) {
        meta.customTocPatterns = structuredClone(selection.patterns) as TocRulePattern[]
        meta.tocRuleId = 'custom'
        meta.tocRuleLabel = selection.label
        meta.tocRuleAuto = false
      } else {
        delete meta.customTocPatterns
        delete meta.tocRuleId
        delete meta.tocRuleLabel
        delete meta.tocRuleAuto
      }
    } else if (selection.ruleId === 'custom') {
      if (!selection.patterns?.length) throw new AppError('VALIDATION_ERROR', 'Custom directory rule patterns are required')
      meta.customTocPatterns = structuredClone(selection.patterns) as TocRulePattern[]
      meta.tocRuleId = 'custom'
      meta.tocRuleLabel = selection.label
      meta.tocRuleAuto = false
    } else if (selection.ruleId) {
      const ownedRule = db.select({ id: tocRules.id }).from(tocRules).where(and(
        eq(tocRules.id, selection.ruleId), eq(tocRules.userId, userId),
      )).get()
      if (!ownedRule) throw new AppError('VALIDATION_ERROR', 'Directory rule does not belong to this user')
      meta.tocRuleId = selection.ruleId
      meta.tocRuleLabel = selection.label
      meta.tocRuleAuto = selection.auto
      delete meta.customTocPatterns
    } else {
      delete meta.customTocPatterns
      delete meta.tocRuleId
      delete meta.tocRuleLabel
      delete meta.tocRuleAuto
    }
  }
  const storage = getStorage()
  let sourceMap: RevisionMapSegment[] = []
  let revisionMapping: Awaited<ReturnType<typeof createEpubRevisionMap>> | null = null
  let sourceEpub: Buffer | null = null
  try {
    if (await storage.exists(book.filePath)) {
      sourceEpub = await bufferFromStream(await storage.get(book.filePath))
      revisionMapping = await createEpubRevisionMap(sourceEpub, epub,
        input.chapters.flatMap((chapter, index) => chapter.structureOnlyTitle ? [index] : []))
      sourceMap = revisionMapping.segments
    }
  } catch (error) {
    sourceMap = []
    log('warn', 'books.editor_revision_map_unavailable', { error, meta: { bookId, baseRevisionId: input.baseRevisionId } })
  }
  let sourceTexts = new Map<string, string>()
  let sourceMarkups = new Map<string, string>()
  if (sourceEpub) {
    try {
      const [texts, sections] = await Promise.all([extractEpubSpineText(sourceEpub), loadEpubSpineMarkup(sourceEpub)])
      sourceTexts = texts
      sourceMarkups = new Map(sections.map((section) => [section.href, section.markup]))
    } catch {
      sourceTexts = new Map()
      sourceMarkups = new Map()
    }
  }
  const [targetTexts, targetSpineMarkup] = await Promise.all([extractEpubSpineText(epub), loadEpubSpineMarkup(epub)])
  const targetMarkups = new Map(targetSpineMarkup.map((section) => [section.href, section.markup]))
  await storage.put(filePath, epub)

  const revisionId = createId('rev')
  const revisionNo = db.select({ revisionNo: contentRevisions.revisionNo }).from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get()?.revisionNo ?? 0
  let unlocated: EditorTxtSaveRes['unlocated'] = { progress: 0, coverage: 0, highlights: 0, bookmarks: 0, notes: 0, pointReplacements: 0 }
  const readerStates = db.select().from(bookStates).where(eq(bookStates.bookVersionId, bookId)).all()
  const stateMappings = await prepareReaderStateRevisionMaps(bookId, input.baseRevisionId, revisionMapping, readerStates)
  const positionAnchors = await resolveReaderPositionAnchors(bookId, input.baseRevisionId, sourceEpub, readerStates)

  try {
    db.transaction((tx) => {
      const latest = tx.select({ id: contentRevisions.id }).from(contentRevisions)
        .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get()
      if (latest?.id !== input.baseRevisionId) throw new AppError('VALIDATION_ERROR', 'Content revision changed; reopen the editor')
      tx.insert(contentRevisions).values({
        id: revisionId, bookVersionId: bookId, revisionNo: revisionNo + 1,
        blobKey: filePath, size: epub.length, wordCount, chapterCount: chapters.length,
        meta, createdAt: now,
      }).run()
      tx.insert(blobs).values({ key: filePath, size: epub.length, kind: 'book', createdAt: now }).onConflictDoNothing().run()
      tx.update(bookVersions).set({ size: epub.length, updatedAt: now }).where(eq(bookVersions.id, bookId)).run()
      const affectedLibraryBookIds = kind === 'shared'
        ? tx.select({ id: libraryBookVersions.libraryBookId }).from(libraryBookVersions)
            .where(eq(libraryBookVersions.bookVersionId, bookId)).all().map((row) => row.id)
        : [libraryBookId]
      for (const affectedId of new Set(affectedLibraryBookIds)) {
        tx.update(libraryBooks).set({ updatedAt: now }).where(eq(libraryBooks.id, affectedId)).run()
      }
      tx.update(libraryBookVersions).set({ pinnedRevisionId: revisionId }).where(and(
        eq(libraryBookVersions.bookVersionId, bookId), eq(libraryBookVersions.kind, 'shared'),
      )).run()
      persistContentRevisionMaps(tx, {
        bookVersionId: bookId, sourceRevisionId: input.baseRevisionId, targetRevisionId: revisionId,
        directSegments: sourceMap, directSourceSections: revisionMapping?.sourceSections ?? [],
        directTargetSections: revisionMapping?.targetSections ?? [], directStructuralRanges: revisionMapping?.structuralRanges ?? [],
      })

      const stateRows = tx.select().from(bookStates).where(eq(bookStates.bookVersionId, bookId)).all()
      unlocated = {
        progress: 0,
        coverage: 0,
        highlights: 0,
        bookmarks: 0,
        notes: 0,
        pointReplacements: 0,
      }
      const pointRows = tx.select().from(textReplacements).where(and(
        eq(textReplacements.matchType, 'point'), eq(textReplacements.relocation, 'ok'),
        or(eq(textReplacements.bookId, bookId), eq(textReplacements.bookVersionId, bookId)),
      )).all()
      for (const row of pointRows) {
        const mapped = mapPointReplacementAnchor(row, revisionMapping?.segments ?? [], sourceTexts, targetTexts)
        if (mapped) {
          if (mapped.spineHref !== row.spineHref || mapped.textOffset !== row.textOffset) {
            tx.update(textReplacements).set({ ...mapped, updatedAt: now }).where(eq(textReplacements.id, row.id)).run()
          }
        } else {
          unlocated.pointReplacements += 1
          tx.update(textReplacements).set({ relocation: 'unresolved', updatedAt: now }).where(eq(textReplacements.id, row.id)).run()
        }
      }
      for (const row of stateRows) {
        if (sameTextAndSpine && row.progressRevisionId === input.baseRevisionId
          && (row.coverageRevisionId ?? row.progressData?.coverageRevisionId ?? input.baseRevisionId) === input.baseRevisionId) {
          const previous = row.progressData
          tx.update(bookStates).set({
            progressRevisionId: revisionId,
            coverageRevisionId: revisionId,
            ...(previous ? {
              progressData: {
                ...previous,
                progressRevisionId: revisionId,
                coverageRevisionId: revisionId,
                ...(previous.positionAnchor ? { positionAnchor: { ...previous.positionAnchor, revisionId } } : {}),
                updatedAt: now,
              },
            } : {}),
            updatedAt: now,
          }).where(and(eq(bookStates.userId, row.userId), eq(bookStates.bookVersionId, bookId))).run()
          continue
        }
        const previous = row.progressData ?? {
          progressRevisionId: row.progressRevisionId,
          cfi: row.cfi,
          chapter: row.chapter,
          percent: row.percent,
          intervals: [],
          updatedAt: row.updatedAt,
        }
        const hadPosition = Boolean(previous.cfi || previous.chapter || previous.percent > 0 || previous.fraction !== null && previous.fraction !== undefined)
        const hadCoverage = (previous.intervals?.length ?? 0) > 0
        const positionBasis = row.progressRevisionId ?? previous.progressRevisionId ?? input.baseRevisionId
        const coverageBasis = row.coverageRevisionId ?? previous.coverageRevisionId ?? row.progressRevisionId ?? previous.progressRevisionId ?? input.baseRevisionId
        const historicalPositions = hadPosition || hadCoverage
          ? [...(previous.historicalPositions ?? []), {
              progressRevisionId: positionBasis,
              coverageRevisionId: coverageBasis,
              cfi: previous.cfi ?? null, chapter: previous.chapter ?? null,
              chapterIndex: previous.chapterIndex ?? null, percent: previous.percent,
              fraction: previous.fraction ?? null, intervals: previous.intervals ?? [], updatedAt: previous.updatedAt,
            }]
          : previous.historicalPositions
        const positionMapping = stateMappings.get(positionBasis)
        const coverageMapping = hadCoverage ? stateMappings.get(coverageBasis) : revisionMapping
        const sourcePosition = positionAnchors.get(row.userId)
        const mappedPosition = positionMapping && sourcePosition
          ? withRestorableCfi(mapRevisionTextPosition(sourcePosition.spineHref, sourcePosition.textOffset,
              positionMapping.targetSections, positionMapping.segments), positionMapping.targetSections, targetMarkups)
          : null
        const mappedIntervals = coverageMapping
          ? projectRevisionCoverage(previous.intervals ?? [], coverageMapping.sourceSections, coverageMapping.targetSections,
            coverageMapping.segments, coverageMapping.structuralRanges)
          : previous.intervals ?? []
        if (hadCoverage && !coverageMapping) unlocated.coverage += 1
        const locationAvailable = !hadPosition || Boolean(mappedPosition)
        if (hadPosition && !locationAvailable) unlocated.progress += 1
        const progressRevisionId = mappedPosition ? revisionId : positionBasis
        const nextCoverageRevisionId = coverageMapping ? revisionId : coverageBasis
        const nextProgress = {
          ...previous, progressRevisionId, coverageRevisionId: nextCoverageRevisionId,
          cfi: mappedPosition?.cfi ?? null, contentCfi: mappedPosition?.cfi ?? null, chapter: mappedPosition?.title ?? null, chapterIndex: mappedPosition?.chapterIndex ?? null,
          percent: mappedPosition ? mappedPosition.fraction * 100 : 0, fraction: mappedPosition?.fraction ?? null,
          positionAnchor: mappedPosition
            ? { revisionId, spineHref: mappedPosition.spineHref, textOffset: mappedPosition.textOffset, cfi: mappedPosition.cfi }
            : previous.positionAnchor ?? null,
          intervals: mappedIntervals, updatedAt: now,
          ...(historicalPositions ? { historicalPositions } : {}),
        }
        tx.update(bookStates).set({
          cfi: nextProgress.cfi ?? null, chapter: nextProgress.chapter, percent: nextProgress.percent,
          readFraction: coverageMapping ? unionLength(mappedIntervals) : 0,
          progressRevisionId, coverageRevisionId: nextCoverageRevisionId,
          progressData: nextProgress, updatedAt: now,
        }).where(and(eq(bookStates.userId, row.userId), eq(bookStates.bookVersionId, bookId))).run()
      }
      for (const row of tx.select().from(highlights).where(eq(highlights.bookVersionId, bookId)).all()) {
        if (row.revisionId && row.revisionId !== input.baseRevisionId || row.relocation === 'unresolved') continue
        const mapped = revisionMapping && mapAnnotationAnchor(row.cfiRange, row.chapterHref, revisionMapping.sourceSections, revisionMapping.targetSections, sourceTexts, targetTexts, sourceMarkups, targetMarkups, revisionMapping.segments)
        if (mapped) tx.update(highlights).set({ revisionId, cfiRange: mapped.cfi ?? row.cfiRange, chapterHref: mapped.chapterHref, updatedAt: now }).where(eq(highlights.id, row.id)).run()
        else {
          unlocated.highlights += 1
          tx.update(highlights).set({ relocation: 'unresolved', updatedAt: now }).where(eq(highlights.id, row.id)).run()
        }
      }
      for (const row of tx.select().from(bookmarks).where(eq(bookmarks.bookVersionId, bookId)).all()) {
        if (row.revisionId && row.revisionId !== input.baseRevisionId || row.relocation === 'unresolved') continue
        const mapped = revisionMapping && mapAnnotationAnchor(row.cfi, row.chapterHref, revisionMapping.sourceSections, revisionMapping.targetSections, sourceTexts, targetTexts, sourceMarkups, targetMarkups, revisionMapping.segments)
        if (mapped) tx.update(bookmarks).set({ revisionId, cfi: mapped.cfi ?? row.cfi, chapterHref: mapped.chapterHref, updatedAt: now }).where(eq(bookmarks.id, row.id)).run()
        else {
          unlocated.bookmarks += 1
          tx.update(bookmarks).set({ relocation: 'unresolved', updatedAt: now }).where(eq(bookmarks.id, row.id)).run()
        }
      }
      for (const row of tx.select().from(ideas).where(eq(ideas.bookVersionId, bookId)).all()) {
        if (row.revisionId && row.revisionId !== input.baseRevisionId || row.relocation === 'unresolved') continue
        const mapped = revisionMapping && mapAnnotationAnchor(row.cfiRange, row.chapterHref, revisionMapping.sourceSections, revisionMapping.targetSections, sourceTexts, targetTexts, sourceMarkups, targetMarkups, revisionMapping.segments)
        if (mapped) tx.update(ideas).set({ revisionId, cfiRange: mapped.cfi ?? row.cfiRange, chapterHref: mapped.chapterHref, updatedAt: now }).where(eq(ideas.id, row.id)).run()
        else {
          unlocated.notes += 1
          tx.update(ideas).set({ relocation: 'unresolved', updatedAt: now }).where(eq(ideas.id, row.id)).run()
        }
      }
    })
  } catch (error) {
    if (!blobKeyReferenced(filePath) && await storage.exists(filePath)) {
      try { await storage.delete(filePath) } catch (cleanupError) {
        log('warn', 'books.editor_staged_blob_cleanup_failed', { error: cleanupError, meta: { filePath } })
      }
    }
    throw error
  }

  enqueueReaderArchivePreparation({ id: bookId, filePath, format: 'txt', revisionId, contentHash, size: epub.length })
  return { revisionId, changed: true, unlocated }
}
