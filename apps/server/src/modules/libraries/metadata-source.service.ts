import { and, desc, eq } from 'drizzle-orm'

import type { BookMetadataSourceRes, FileMetadataSourceRes } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookVersions, contentRevisions, libraryBooks, libraryBookVersions } from '../../db/schema'
import { getParser } from '../../formats/registry'
import { normalizeBookTitle } from '../../lib/book-title'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { isTitleNormalizeEnabled } from '../settings/settings.service'
import { resolveSharedVersionRead } from './library-access'
import { resolveLibraryBook } from '../books/books.service'

function emptyFileValues(): FileMetadataSourceRes['values'] {
  return {
    title: null,
    authors: null,
    description: null,
    publisher: null,
    published: null,
    language: null,
    isbn: null,
    subjects: null,
    series: null,
    seriesIndex: null,
  }
}

function missingProvenance(): FileMetadataSourceRes['provenance'] {
  return {
    title: 'missing',
    authors: 'missing',
    description: 'missing',
    publisher: 'missing',
    published: 'missing',
    language: 'missing',
    isbn: 'missing',
    subjects: 'missing',
    series: 'missing',
    seriesIndex: 'missing',
  }
}

function txtFileSource(fileName: string | null, normalizeTitleApplied: boolean): FileMetadataSourceRes {
  const values = emptyFileValues()
  const provenance = missingProvenance()
  if (normalizeTitleApplied && fileName) {
    const derived = normalizeBookTitle(fileName)
    if (derived.title) {
      values.title = derived.title
      provenance.title = 'filename'
    }
    if (derived.authors && derived.authors.length > 0) {
      values.authors = derived.authors
      provenance.authors = 'filename'
    } else if (derived.author) {
      values.authors = [derived.author]
      provenance.authors = 'filename'
    }
  }
  return { kind: 'file', format: 'txt', fileName, normalizeTitleApplied, values, provenance }
}

export async function getPrivateBookMetadataSource(
  userId: string,
  bookId: string,
): Promise<BookMetadataSourceRes> {
  const db = getDb()
  const { libraryBookId, kind } = resolveLibraryBook(userId, bookId)
  const lb = db.select().from(libraryBooks).where(eq(libraryBooks.id, libraryBookId)).get()
  if (!lb || lb.deletedAt) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const lbv = db.select().from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, lb.libraryId), eq(libraryBookVersions.bookVersionId, bookId))).get()
  if (!lbv) throw new AppError('BOOK_NOT_FOUND', 'Book not found')

  if (kind === 'shared') {
    const sourceLibraryId = lbv.sourceLibraryId
    const sourceLibraryBookVersionId = lbv.sourceLibraryBookVersionId
    if (!sourceLibraryId || !sourceLibraryBookVersionId) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
    const source = db.select().from(libraryBookVersions)
      .where(and(
        eq(libraryBookVersions.id, sourceLibraryBookVersionId),
        eq(libraryBookVersions.libraryId, sourceLibraryId),
      )).get()
    if (!source) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
    if (source.bookVersionId !== bookId) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
    await resolveSharedVersionRead(sourceLibraryId, source.bookVersionId, userId)
    const sourceWork = db.select().from(libraryBooks).where(eq(libraryBooks.id, source.libraryBookId)).get()
    if (!sourceWork || sourceWork.deletedAt) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
    const title = source.title ?? sourceWork.title
    const authors = source.authors ?? sourceWork.authors ?? []
    return {
      kind: 'shared',
      sourceLibraryId,
      sourceLibraryBookVersionId,
      bookVersionId: bookId,
      values: { title, authors },
      provenance: { title: 'shared', authors: 'shared' },
    }
  }

  const bv = db.select().from(bookVersions).where(eq(bookVersions.id, bookId)).get()
  if (!bv) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const latest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!latest) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const revisionMeta = (latest.meta ?? {}) as Record<string, unknown>
  const fileName = typeof revisionMeta.fileName === 'string' ? revisionMeta.fileName : null
  const normalizeTitleApplied = isTitleNormalizeEnabled(userId)

  const storage = getStorage()
  if (!(await storage.exists(latest.blobKey))) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  if (bv.format === 'txt') {
    return txtFileSource(fileName, normalizeTitleApplied)
  }
  const parser = getParser(latest.blobKey, '')
  if (!parser) throw new AppError('UNSUPPORTED_FORMAT')
  const parsed = await parser.parse(await storage.get(latest.blobKey))
  const values = emptyFileValues()
  const provenance = missingProvenance()
  const bookmeta = parsed.meta.bookmeta ?? {}

  if (parsed.meta.title) {
    values.title = parsed.meta.title
    provenance.title = 'file'
  }
  const parsedAuthors = (parsed.meta.authors ?? []).map((name) => name.trim()).filter(Boolean).slice(0, 10)
  if (parsedAuthors.length > 0) {
    values.authors = parsedAuthors
    provenance.authors = 'file'
  } else if (parsed.meta.author?.trim()) {
    values.authors = [parsed.meta.author.trim()]
    provenance.authors = 'file'
  }
  if (typeof bookmeta.description === 'string' && bookmeta.description.trim()) {
    values.description = bookmeta.description
    provenance.description = 'file'
  }
  if (typeof bookmeta.publisher === 'string' && bookmeta.publisher.trim()) {
    values.publisher = bookmeta.publisher
    provenance.publisher = 'file'
  }
  if (typeof bookmeta.published === 'string' && bookmeta.published.trim()) {
    values.published = bookmeta.published
    provenance.published = 'file'
  }
  if (typeof bookmeta.language === 'string' && bookmeta.language.trim()) {
    values.language = bookmeta.language
    provenance.language = 'file'
  }
  if (typeof bookmeta.isbn === 'string' && bookmeta.isbn.trim()) {
    values.isbn = bookmeta.isbn
    provenance.isbn = 'file'
  }
  if (Array.isArray(bookmeta.subjects) && bookmeta.subjects.filter((s) => typeof s === 'string' && s.trim()).length > 0) {
    values.subjects = (bookmeta.subjects as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
    provenance.subjects = 'file'
  }
  if (typeof bookmeta.series === 'string' && bookmeta.series.trim()) {
    values.series = bookmeta.series
    provenance.series = 'file'
  }
  if (typeof bookmeta.seriesIndex === 'number' && Number.isFinite(bookmeta.seriesIndex)) {
    values.seriesIndex = bookmeta.seriesIndex
    provenance.seriesIndex = 'file'
  }

  if ((!values.title || !values.authors) && normalizeTitleApplied && fileName) {
    const derived = normalizeBookTitle(fileName)
    if (!values.title && derived.title) {
      values.title = derived.title
      provenance.title = 'filename'
    }
    if (!values.authors && derived.authors && derived.authors.length > 0) {
      values.authors = derived.authors
      provenance.authors = 'filename'
    } else if (!values.authors && derived.author) {
      values.authors = [derived.author]
      provenance.authors = 'filename'
    }
  }

  return { kind: 'file', format: 'epub', fileName, normalizeTitleApplied, values, provenance }
}

export async function getCatalogVersionFileSource(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
): Promise<FileMetadataSourceRes> {
  const db = getDb()
  const { requireLibraryManager } = await import('./library-access')
  await requireLibraryManager(actorId, libraryId)
  const link = db.select().from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.id, versionLinkId),
      eq(libraryBookVersions.libraryId, libraryId),
      eq(libraryBookVersions.libraryBookId, libraryBookId),
    )).get()
  if (!link) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  const work = db.select().from(libraryBooks)
    .where(and(eq(libraryBooks.id, libraryBookId), eq(libraryBooks.libraryId, libraryId))).get()
  if (!work || work.deletedAt) throw new AppError('LIBRARY_BOOK_NOT_FOUND', 'Library book not found')
  const bv = db.select().from(bookVersions).where(eq(bookVersions.id, link.bookVersionId)).get()
  if (!bv) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  const latest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, link.bookVersionId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!latest) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const revisionMeta = (latest.meta ?? {}) as Record<string, unknown>
  const fileName = typeof revisionMeta.fileName === 'string' ? revisionMeta.fileName : null
  const normalizeTitleApplied = isTitleNormalizeEnabled(actorId)

  const storage = getStorage()
  if (!(await storage.exists(latest.blobKey))) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  if (bv.format === 'txt') {
    return txtFileSource(fileName, normalizeTitleApplied)
  }
  const parser = getParser(latest.blobKey, '')
  if (!parser) throw new AppError('UNSUPPORTED_FORMAT')
  const parsed = await parser.parse(await storage.get(latest.blobKey))
  const values = emptyFileValues()
  const provenance = missingProvenance()
  const bookmeta = parsed.meta.bookmeta ?? {}
  if (parsed.meta.title) {
    values.title = parsed.meta.title
    provenance.title = 'file'
  }
  const parsedAuthors = (parsed.meta.authors ?? []).map((name) => name.trim()).filter(Boolean).slice(0, 10)
  if (parsedAuthors.length > 0) {
    values.authors = parsedAuthors
    provenance.authors = 'file'
  } else if (parsed.meta.author?.trim()) {
    values.authors = [parsed.meta.author.trim()]
    provenance.authors = 'file'
  }
  if (typeof bookmeta.description === 'string' && bookmeta.description.trim()) {
    values.description = bookmeta.description
    provenance.description = 'file'
  }
  if (typeof bookmeta.publisher === 'string' && bookmeta.publisher.trim()) {
    values.publisher = bookmeta.publisher
    provenance.publisher = 'file'
  }
  if (typeof bookmeta.published === 'string' && bookmeta.published.trim()) {
    values.published = bookmeta.published
    provenance.published = 'file'
  }
  if (typeof bookmeta.language === 'string' && bookmeta.language.trim()) {
    values.language = bookmeta.language
    provenance.language = 'file'
  }
  if (typeof bookmeta.isbn === 'string' && bookmeta.isbn.trim()) {
    values.isbn = bookmeta.isbn
    provenance.isbn = 'file'
  }
  if (Array.isArray(bookmeta.subjects) && bookmeta.subjects.filter((s) => typeof s === 'string' && s.trim()).length > 0) {
    values.subjects = (bookmeta.subjects as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
    provenance.subjects = 'file'
  }
  if (typeof bookmeta.series === 'string' && bookmeta.series.trim()) {
    values.series = bookmeta.series
    provenance.series = 'file'
  }
  if (typeof bookmeta.seriesIndex === 'number' && Number.isFinite(bookmeta.seriesIndex)) {
    values.seriesIndex = bookmeta.seriesIndex
    provenance.seriesIndex = 'file'
  }
  if ((!values.title || !values.authors) && normalizeTitleApplied && fileName) {
    const derived = normalizeBookTitle(fileName)
    if (!values.title && derived.title) {
      values.title = derived.title
      provenance.title = 'filename'
    }
    if (!values.authors && derived.authors && derived.authors.length > 0) {
      values.authors = derived.authors
      provenance.authors = 'filename'
    } else if (!values.authors && derived.author) {
      values.authors = [derived.author]
      provenance.authors = 'filename'
    }
  }
  return { kind: 'file', format: 'epub', fileName, normalizeTitleApplied, values, provenance }
}
