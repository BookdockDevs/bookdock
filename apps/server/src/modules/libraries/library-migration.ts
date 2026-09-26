import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm'

import type { BookMetadata } from '@bookdock/shared'
import { normalizeUsername } from '@bookdock/shared'

import { getDb } from '../../db/client'
import {
  aiBookIndexes, aiChunkEmbeddings, aiChunks, aiThreads, annotations, blobs, bookmarks, books, bookStates,
  bookTags, bookVersions, contentRevisions, highlights, ideas, instance, instanceSettings, libraries,
  libraryBookTags, libraryBookVersions, libraryBooks, libraryCategories, libraryMigrationLog, libraryTags,
  readingRecords, readingSessions, shelves, tags, textReplacementOverrides, textReplacements, users,
} from '../../db/schema'
import { createId } from '../../lib/id'
import { readProgressFile } from '../../lib/progress-file'
import { getStorage } from '../../storage'

export interface LibraryMigrationAnomaly {
  bookId: string
  reason: string
}

export interface LibraryMigrationReport {
  users: number
  librariesCreated: number
  librariesSkipped: number
  books: number
  booksMigrated: number
  booksSkipped: number
  revisions: number
  blobs: number
  anomalies: LibraryMigrationAnomaly[]
}

/**
 * Phase 2 migration (2.1-2.4): one Private Library per real user, every book
 * as a personal LibraryBook/LibraryBookVersion/BookVersion/initial Revision.
 * Idempotent: reruns skip libraries and books that already migrated.
 * Books whose physical file is gone are NOT migrated; they land in
 * anomalies instead of a fabricated readable state. Shelf/tag mapping (2.5),
 * reading data (2.6-2.8) and user/instance backfill (2.10-2.11) are separate
 * steps; each writes its own migration-log row.
 */
export async function migratePrivateLibraries(): Promise<LibraryMigrationReport> {
  const db = getDb()
  const storage = getStorage()
  const startedAt = Date.now()
  const logId = createId('mlog')
  db.insert(libraryMigrationLog).values({ id: logId, batch: 'phase2-private-libraries', status: 'started', details: {}, startedAt }).run()

  const report: LibraryMigrationReport = {
    users: 0, librariesCreated: 0, librariesSkipped: 0,
    books: 0, booksMigrated: 0, booksSkipped: 0,
    revisions: 0, blobs: 0, anomalies: [],
  }
  try {
    // The shared default guest row is a compat identity, never a library owner.
    const realUsers = db.select().from(users).where(ne(users.role, 'guest')).all()
    report.users = realUsers.length
    for (const user of realUsers) {
      const existing = db.select({ id: libraries.id }).from(libraries)
        .where(and(eq(libraries.userId, user.id), eq(libraries.type, 'private'))).get()
      let libraryId: string
      if (existing) {
        report.librariesSkipped += 1
        libraryId = existing.id
      } else {
        libraryId = createId('lib')
        db.insert(libraries).values({
          id: libraryId, userId: user.id, type: 'private',
          name: user.username, description: '', visibility: null,
          createdAt: startedAt, updatedAt: startedAt,
        }).run()
        report.librariesCreated += 1
      }

      const userBooks = db.select().from(books).where(eq(books.userId, user.id)).all()
      report.books += userBooks.length
      for (const book of userBooks) {
        const already = db.select({ id: bookVersions.id }).from(bookVersions).where(eq(bookVersions.id, book.id)).get()
        if (already) {
          report.booksSkipped += 1
          continue
        }
        if (!(await storage.exists(book.filePath))) {
          report.anomalies.push({ bookId: book.id, reason: `missing file: ${book.filePath}` })
          continue
        }
        const meta = (book.meta ?? {}) as { bookmeta?: BookMetadata; chapters?: Array<{ wordCount?: number }>; wordCount?: number }
        const chapters = Array.isArray(meta.chapters) ? meta.chapters : []
        const wordCount = typeof meta.wordCount === 'number' ? meta.wordCount : null
        const description = typeof meta.bookmeta?.description === 'string' ? meta.bookmeta.description : ''
        const libraryBookId = createId('lb')
        const libraryBookVersionId = createId('lbv')
        let coverSize: number | null = null
        if (book.coverKey) {
          if (await storage.exists(book.coverKey)) {
            coverSize = await storage.size(book.coverKey)
          } else {
            report.anomalies.push({ bookId: book.id, reason: `missing cover: ${book.coverKey}` })
          }
        }
        db.transaction((tx) => {
          tx.insert(bookVersions).values({
            id: book.id, format: book.format, size: book.size,
            createdAt: book.createdAt, updatedAt: book.updatedAt,
          }).run()
          tx.insert(contentRevisions).values({
            id: createId('rev'), bookVersionId: book.id, revisionNo: 1,
            blobKey: book.filePath, size: book.size,
            wordCount, chapterCount: chapters.length, createdAt: book.createdAt,
          }).run()
          report.blobs += Number(tx.insert(blobs).values({ key: book.filePath, size: book.size, kind: 'book', createdAt: book.createdAt }).onConflictDoNothing().run().changes)
          if (book.coverKey && coverSize !== null) {
            report.blobs += Number(tx.insert(blobs).values({ key: book.coverKey, size: coverSize, kind: 'cover', createdAt: book.createdAt }).onConflictDoNothing().run().changes)
          }
          tx.insert(libraryBooks).values({
            id: libraryBookId, libraryId, userId: user.id, categoryId: null,
            title: book.title, author: book.author, description, coverKey: book.coverKey,
            createdAt: book.createdAt, updatedAt: book.updatedAt, deletedAt: book.deletedAt,
          }).run()
          tx.insert(libraryBookVersions).values({
            id: libraryBookVersionId, libraryId, libraryBookId, bookVersionId: book.id,
            kind: 'personal', status: 'published', name: '',
            title: null, author: null, description: null, coverKey: null,
            sourceLibraryId: null, sourceLibraryBookVersionId: null, pinnedRevisionId: null,
            createdAt: book.createdAt, updatedAt: book.updatedAt,
          }).run()
        })
        report.booksMigrated += 1
        report.revisions += 1
      }
    }
    db.update(libraryMigrationLog).set({
      status: 'completed', finishedAt: Date.now(),
      details: { ...report, anomalies: report.anomalies },
    }).where(eq(libraryMigrationLog.id, logId)).run()
  } catch (err) {
    db.update(libraryMigrationLog).set({
      status: 'failed', finishedAt: Date.now(),
      details: { ...report, error: err instanceof Error ? err.message : String(err) },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    throw err
  }
  return report
}

export interface OrganizationMigrationReport {
  shelves: number
  categoriesMigrated: number
  tags: number
  tagsMigrated: number
  booksClassified: number
  bookTagRelations: number
  anomalies: LibraryMigrationAnomaly[]
}

/**
 * Phase 2 migration (2.5): shelves/tags become library_categories/library_tags
 * inside each private library, books keep their classification, tag relations
 * move to library_book_tags. Shelf/tag ids are reused as category/tag ids so
 * no mapping table is needed; books resolve their library book through the
 * version row (bookVersionId reuses the book id).
 */
export async function migrateLibraryOrganization(): Promise<OrganizationMigrationReport> {
  const db = getDb()
  const startedAt = Date.now()
  const logId = createId('mlog')
  db.insert(libraryMigrationLog).values({ id: logId, batch: 'phase2-organization', status: 'started', details: {}, startedAt }).run()

  const report: OrganizationMigrationReport = {
    shelves: 0, categoriesMigrated: 0, tags: 0, tagsMigrated: 0,
    booksClassified: 0, bookTagRelations: 0, anomalies: [],
  }
  // libraryBookId by book id for relation rewiring.
  const libraryBookByBook = new Map(
    db.select({ bookVersionId: libraryBookVersions.bookVersionId, libraryBookId: libraryBookVersions.libraryBookId })
      .from(libraryBookVersions).all().map((row) => [row.bookVersionId, row.libraryBookId] as const),
  )
  try {
    const privateLibraries = db.select().from(libraries).where(eq(libraries.type, 'private')).all()
    for (const library of privateLibraries) {
      const userShelves = db.select().from(shelves).where(eq(shelves.userId, library.userId)).all()
      report.shelves += userShelves.length
      for (const shelf of userShelves) {
        const existing = db.select({ id: libraryCategories.id }).from(libraryCategories).where(eq(libraryCategories.id, shelf.id)).get()
        if (!existing) {
          db.insert(libraryCategories).values({
            id: shelf.id, libraryId: library.id, userId: library.userId, name: shelf.name,
            parentId: null, sortOrder: shelf.sortOrder, pinned: shelf.pinned,
            createdAt: shelf.createdAt, updatedAt: shelf.updatedAt,
          }).run()
          report.categoriesMigrated += 1
        }
      }

      const userTags = db.select().from(tags).where(eq(tags.userId, library.userId)).all()
      report.tags += userTags.length
      for (const tag of userTags) {
        const existing = db.select({ id: libraryTags.id }).from(libraryTags).where(eq(libraryTags.id, tag.id)).get()
        if (existing) continue
        try {
          db.insert(libraryTags).values({
            id: tag.id, libraryId: library.id, userId: library.userId, name: tag.name,
            sortOrder: tag.sortOrder, pinned: tag.pinned, createdAt: tag.createdAt, updatedAt: tag.updatedAt,
          }).run()
          report.tagsMigrated += 1
        } catch {
          report.anomalies.push({ bookId: tag.id, reason: `tag name conflict in library: ${tag.name}` })
        }
      }

      const userBooks = db.select().from(books).where(eq(books.userId, library.userId)).all()
      for (const book of userBooks) {
        const libraryBookId = libraryBookByBook.get(book.id)
        if (!libraryBookId) {
          report.anomalies.push({ bookId: book.id, reason: 'book has no migrated library entry' })
          continue
        }
        if (book.shelfId) {
          const category = db.select({ id: libraryCategories.id }).from(libraryCategories)
            .where(and(eq(libraryCategories.id, book.shelfId), eq(libraryCategories.libraryId, library.id))).get()
          if (!category) {
            report.anomalies.push({ bookId: book.id, reason: `shelf not in private library: ${book.shelfId}` })
          } else {
            db.update(libraryBooks).set({ categoryId: book.shelfId }).where(eq(libraryBooks.id, libraryBookId)).run()
            report.booksClassified += 1
          }
        }
        const relations = db.select().from(bookTags).where(eq(bookTags.bookId, book.id)).all()
        for (const relation of relations) {
          const tag = db.select({ id: libraryTags.id }).from(libraryTags)
            .where(and(eq(libraryTags.id, relation.tagId), eq(libraryTags.libraryId, library.id))).get()
          if (!tag) {
            report.anomalies.push({ bookId: book.id, reason: `tag not in private library: ${relation.tagId}` })
            continue
          }
          db.insert(libraryBookTags).values({ libraryBookId, tagId: relation.tagId }).onConflictDoNothing().run()
          report.bookTagRelations += 1
        }
      }
    }
    db.update(libraryMigrationLog).set({
      status: 'completed', finishedAt: Date.now(),
      details: { ...report, anomalies: report.anomalies },
    }).where(eq(libraryMigrationLog.id, logId)).run()
  } catch (err) {
    db.update(libraryMigrationLog).set({
      status: 'failed', finishedAt: Date.now(),
      details: { ...report, error: err instanceof Error ? err.message : String(err) },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    throw err
  }
  return report
}

export interface ReadingStatesMigrationReport {
  books: number
  statesMigrated: number
  statesSkipped: number
  anomalies: LibraryMigrationAnomaly[]
}

/**
 * Phase 2 migration (2.6): current position/state per User x BookVersion.
 * Progress files stay exactly where they are: version ids reuse book ids, so
 * progress/{bookId}.json keys remain valid. Corrupt files fall back to the
 * books-row values instead of overwriting valid old data.
 */
export async function migrateReadingStates(): Promise<ReadingStatesMigrationReport> {
  const db = getDb()
  const startedAt = Date.now()
  const logId = createId('mlog')
  db.insert(libraryMigrationLog).values({ id: logId, batch: 'phase2-reading-states', status: 'started', details: {}, startedAt }).run()

  const report: ReadingStatesMigrationReport = { books: 0, statesMigrated: 0, statesSkipped: 0, anomalies: [] }
  try {
    const allBooks = db.select().from(books).all()
    report.books = allBooks.length
    for (const book of allBooks) {
      const version = db.select({ id: bookVersions.id }).from(bookVersions).where(eq(bookVersions.id, book.id)).get()
      if (!version) {
        report.anomalies.push({ bookId: book.id, reason: 'book has no migrated version' })
        continue
      }
      const existing = db.select().from(bookStates)
        .where(and(eq(bookStates.userId, book.userId), eq(bookStates.bookVersionId, book.id))).get()
      if (existing) {
        report.statesSkipped += 1
        continue
      }
      let file: { cfi?: string | null; chapter?: string | null; percent?: number; updatedAt?: number } | null = null
      try {
        file = await readProgressFile(book.id)
      } catch {
        report.anomalies.push({ bookId: book.id, reason: 'unreadable progress file, fell back to books row' })
      }
      db.insert(bookStates).values({
        userId: book.userId,
        bookVersionId: book.id,
        readStatus: book.readStatus,
        percent: typeof file?.percent === 'number' ? file.percent : book.progress,
        cfi: typeof file?.cfi === 'string' ? file.cfi : null,
        chapter: typeof file?.chapter === 'string' ? file.chapter : null,
        lastReadAt: book.lastReadAt,
        updatedAt: typeof file?.updatedAt === 'number' ? Math.max(file.updatedAt, book.updatedAt) : book.updatedAt,
      }).run()
      report.statesMigrated += 1
    }
    db.update(libraryMigrationLog).set({
      status: 'completed', finishedAt: Date.now(),
      details: { ...report, anomalies: report.anomalies },
    }).where(eq(libraryMigrationLog.id, logId)).run()
  } catch (err) {
    db.update(libraryMigrationLog).set({
      status: 'failed', finishedAt: Date.now(),
      details: { ...report, error: err instanceof Error ? err.message : String(err) },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    throw err
  }
  return report
}

export interface AnnotationsMigrationReport {
  annotations: number
  highlights: number
  bookmarks: number
  ideas: number
  skipped: number
  anomalies: LibraryMigrationAnomaly[]
}

/**
 * Phase 2 migration (2.7): annotations split by type into highlights,
 * bookmarks and ideas, keeping ids, CFI anchors, text, chapters, timestamps
 * and soft-delete state. Annotation ids are reused so old and new rows stay
 * traceable; revisionId stays null because migrated records predate revision
 * tracking (Phase 8 re-evaluates relocation). Originals stay until Phase 12.
 */
export async function migrateAnnotations(): Promise<AnnotationsMigrationReport> {
  const db = getDb()
  const startedAt = Date.now()
  const logId = createId('mlog')
  db.insert(libraryMigrationLog).values({ id: logId, batch: 'phase2-annotations', status: 'started', details: {}, startedAt }).run()

  const report: AnnotationsMigrationReport = {
    annotations: 0, highlights: 0, bookmarks: 0, ideas: 0, skipped: 0, anomalies: [],
  }
  try {
    const rows = db.select().from(annotations).all()
    report.annotations = rows.length
    for (const row of rows) {
      const version = db.select({ id: bookVersions.id }).from(bookVersions).where(eq(bookVersions.id, row.bookId)).get()
      if (!version) {
        report.anomalies.push({ bookId: row.bookId, reason: `annotation ${row.id} has no migrated version` })
        continue
      }
      if (row.type === 'highlight') {
        const existing = db.select({ id: highlights.id }).from(highlights).where(eq(highlights.id, row.id)).get()
        if (existing) {
          report.skipped += 1
          continue
        }
        db.insert(highlights).values({
          id: row.id, userId: row.userId, bookVersionId: row.bookId, revisionId: null,
          cfiRange: row.cfiRange, cfiAnchor: row.cfiAnchor, color: row.color, style: row.style,
          text: row.text, chapter: row.chapter, chapterHref: row.chapterHref, relocation: 'ok',
          createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt,
        }).run()
        report.highlights += 1
      } else if (row.type === 'bookmark') {
        const existing = db.select({ id: bookmarks.id }).from(bookmarks).where(eq(bookmarks.id, row.id)).get()
        if (existing) {
          report.skipped += 1
          continue
        }
        db.insert(bookmarks).values({
          id: row.id, userId: row.userId, bookVersionId: row.bookId, revisionId: null,
          cfi: row.cfiRange, chapter: row.chapter, chapterHref: row.chapterHref,
          title: row.text,
          createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt,
        }).run()
        report.bookmarks += 1
      } else {
        const existing = db.select({ id: ideas.id }).from(ideas).where(eq(ideas.id, row.id)).get()
        if (existing) {
          report.skipped += 1
          continue
        }
        db.insert(ideas).values({
          id: row.id, userId: row.userId, bookVersionId: row.bookId, cfiRange: row.cfiRange,
          cfiAnchor: row.cfiAnchor, color: row.color, style: row.style,
          text: row.text, note: row.note, visibility: 'private', sharedLibraryId: null,
          chapter: row.chapter, chapterHref: row.chapterHref,
          createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt,
        }).run()
        report.ideas += 1
      }
    }
    db.update(libraryMigrationLog).set({
      status: 'completed', finishedAt: Date.now(),
      details: { ...report, anomalies: report.anomalies },
    }).where(eq(libraryMigrationLog.id, logId)).run()
  } catch (err) {
    db.update(libraryMigrationLog).set({
      status: 'failed', finishedAt: Date.now(),
      details: { ...report, error: err instanceof Error ? err.message : String(err) },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    throw err
  }
  return report
}

export interface ReferencesBackfillReport {
  tables: Record<string, number>
  anomalies: LibraryMigrationAnomaly[]
}

/**
 * Phase 2 migration (2.8): point every book-bound row at its BookVersion.
 * Only rows whose book already migrated are touched; anything else lands in
 * anomalies with the original row preserved. AI message/event rows follow
 * their thread and need no direct reference.
 */
export async function backfillVersionReferences(): Promise<ReferencesBackfillReport> {
  const db = getDb()
  const startedAt = Date.now()
  const logId = createId('mlog')
  db.insert(libraryMigrationLog).values({ id: logId, batch: 'phase2-references', status: 'started', details: {}, startedAt }).run()

  const report: ReferencesBackfillReport = { tables: {}, anomalies: [] }
  const versionIds = new Set(db.select({ id: bookVersions.id }).from(bookVersions).all().map((row) => row.id))
  const targets = [
    { table: readingRecords, name: 'reading_records' },
    { table: readingSessions, name: 'reading_sessions' },
    { table: aiThreads, name: 'ai_threads' },
    { table: aiBookIndexes, name: 'ai_book_indexes' },
    { table: aiChunks, name: 'ai_chunks' },
    { table: aiChunkEmbeddings, name: 'ai_chunk_embeddings' },
    { table: textReplacements, name: 'text_replacements' },
    { table: textReplacementOverrides, name: 'text_replacement_overrides' },
  ] as const
  try {
    for (const { table, name } of targets) {
      const pending = db.select({ id: table.id, bookId: table.bookId }).from(table)
        .where(and(isNull(table.bookVersionId), isNotNull(table.bookId))).all()
      let done = 0
      for (const row of pending) {
        if (row.bookId && versionIds.has(row.bookId)) {
          db.update(table).set({ bookVersionId: row.bookId }).where(eq(table.id, row.id)).run()
          done += 1
        } else {
          report.anomalies.push({ bookId: row.bookId ?? '', reason: `${name} row ${row.id} has no migrated version` })
        }
      }
      report.tables[name] = done
    }
    db.update(libraryMigrationLog).set({
      status: 'completed', finishedAt: Date.now(),
      details: { ...report, anomalies: report.anomalies },
    }).where(eq(libraryMigrationLog.id, logId)).run()
  } catch (err) {
    db.update(libraryMigrationLog).set({
      status: 'failed', finishedAt: Date.now(),
      details: { ...report, error: err instanceof Error ? err.message : String(err) },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    throw err
  }
  return report
}

export interface UserBackfillReport {
  users: number
  backfilled: number
  skipped: number
  anomalies: LibraryMigrationAnomaly[]
}

/**
 * Phase 2 migration (2.10): usernameNormalized + bio for real users.
 * Conflicts block the migration (no silent renames); the shared guest row
 * keeps NULL so it can never squat a registrable name. bio arrives as ''
 * from the column default; rows are only touched for the normalized key.
 */
export async function backfillUserFields(): Promise<UserBackfillReport> {
  const db = getDb()
  const startedAt = Date.now()
  const logId = createId('mlog')
  db.insert(libraryMigrationLog).values({ id: logId, batch: 'phase2-users', status: 'started', details: {}, startedAt }).run()

  const report: UserBackfillReport = { users: 0, backfilled: 0, skipped: 0, anomalies: [] }
  try {
    const realUsers = db.select().from(users).where(ne(users.role, 'guest')).all()
    report.users = realUsers.length
    const seen = new Map<string, string>()
    for (const user of realUsers) {
      const normalized = normalizeUsername(user.username)
      const clash = seen.get(normalized)
      if (clash && clash !== user.id) {
        report.anomalies.push({ bookId: user.id, reason: `usernameNormalized conflict: ${user.username} collides after normalization` })
      } else {
        seen.set(normalized, user.id)
      }
    }
    if (report.anomalies.length > 0) {
      db.update(libraryMigrationLog).set({
        status: 'failed', finishedAt: Date.now(),
        details: { ...report, anomalies: report.anomalies },
      }).where(eq(libraryMigrationLog.id, logId)).run()
      throw new Error(`usernameNormalized conflicts block migration: ${report.anomalies.map((a) => a.reason).join('; ')}`)
    }
    for (const user of realUsers) {
      if (user.usernameNormalized === normalizeUsername(user.username)) {
        report.skipped += 1
        continue
      }
      db.update(users).set({ usernameNormalized: normalizeUsername(user.username) }).where(eq(users.id, user.id)).run()
      report.backfilled += 1
    }
    db.update(libraryMigrationLog).set({
      status: 'completed', finishedAt: Date.now(),
      details: { ...report, anomalies: report.anomalies },
    }).where(eq(libraryMigrationLog.id, logId)).run()
  } catch (err) {
    if (report.anomalies.length === 0) {
      db.update(libraryMigrationLog).set({
        status: 'failed', finishedAt: Date.now(),
        details: { ...report, error: err instanceof Error ? err.message : String(err) },
      }).where(eq(libraryMigrationLog.id, logId)).run()
    }
    throw err
  }
  return report
}

export interface InstanceSeedReport {
  created: boolean
  ownerId: string | null
  allowRegistration: boolean
  allowGuestAccess: boolean
  uploadMaxBytes: number | null
}

/**
 * Phase 2 migration (2.11): the single enabled owner plus instance_settings
 * move into the instance row. Zero or multiple enabled owners block the
 * migration for manual adjudication. User-level settings rows stay untouched.
 */
export async function seedInstance(): Promise<InstanceSeedReport> {
  const db = getDb()
  const startedAt = Date.now()
  const logId = createId('mlog')
  db.insert(libraryMigrationLog).values({ id: logId, batch: 'phase2-instance', status: 'started', details: {}, startedAt }).run()

  const existing = db.select().from(instance).all()
  if (existing.length > 0) {
    const row = existing[0]!
    const report = {
      created: false, ownerId: row.ownerUserId, allowRegistration: row.allowRegistration,
      allowGuestAccess: row.allowGuestAccess, uploadMaxBytes: row.uploadMaxBytes,
    }
    db.update(libraryMigrationLog).set({
      status: 'completed', finishedAt: Date.now(), details: { ...report },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    return report
  }
  const owners = db.select().from(users).where(and(eq(users.role, 'owner'), eq(users.disabled, 0))).all()
  if (owners.length !== 1) {
    db.update(libraryMigrationLog).set({
      status: 'failed', finishedAt: Date.now(),
      details: { candidates: owners.map((o) => ({ id: o.id, username: o.username, disabled: o.disabled })) },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    throw new Error(`instance seed blocked: expected exactly one enabled owner, found ${owners.length}`)
  }
  try {
    const settings = new Map(db.select().from(instanceSettings).all().map((row) => [row.key, row.value] as const))
    const report: InstanceSeedReport = {
      created: true,
      ownerId: owners[0]!.id,
      allowRegistration: settings.get('allowRegistration') === 'true',
      allowGuestAccess: settings.get('allowGuestAccess') === 'true',
      uploadMaxBytes: settings.has('uploadMaxBytes') ? Number(settings.get('uploadMaxBytes')) : null,
    }
    db.insert(instance).values({
      id: 'instance', ownerUserId: owners[0]!.id,
      allowRegistration: report.allowRegistration, allowGuestAccess: report.allowGuestAccess,
      uploadMaxBytes: report.uploadMaxBytes, createdAt: startedAt, updatedAt: startedAt,
    }).run()
    db.update(libraryMigrationLog).set({
      status: 'completed', finishedAt: Date.now(), details: { ...report },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    return report
  } catch (err) {
    db.update(libraryMigrationLog).set({
      status: 'failed', finishedAt: Date.now(),
      details: { error: err instanceof Error ? err.message : String(err) },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    throw err
  }
}

export interface VerifyCheck {
  name: string
  pass: boolean
  detail: string
}

export interface VerifyReport {
  pass: boolean
  checks: VerifyCheck[]
}

/**
 * Phase 2 verification (2.9): recount everything from the migrated state
 * instead of trusting migration reports. Backs the Phase 2 Gate.
 */
export async function verifyPhase2Migration(): Promise<VerifyReport> {
  const db = getDb()
  const storage = getStorage()
  const checks: VerifyCheck[] = []
  const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail })

  const realUsers = db.select().from(users).where(ne(users.role, 'guest')).all()
  const guestRow = db.select({ id: users.id }).from(users).where(eq(users.role, 'guest')).get()
  const guestLibraries = guestRow
    ? db.select({ id: libraries.id }).from(libraries).where(eq(libraries.userId, guestRow.id)).all()
    : []
  check('private-library-per-user', realUsers.every((u) =>
    db.select({ id: libraries.id }).from(libraries)
      .where(and(eq(libraries.userId, u.id), eq(libraries.type, 'private'))).all().length === 1,
  ), `${realUsers.length} real users`)
  check('guest-has-no-library', guestLibraries.length === 0, `${guestLibraries.length} guest libraries`)
  check('username-normalized', realUsers.every((u) => !!u.usernameNormalized)
    && new Set(realUsers.map((u) => u.usernameNormalized)).size === realUsers.length,
  'all set, all unique')

  const bookRows = db.select().from(books).all()
  const versionIds = new Set(db.select({ id: bookVersions.id }).from(bookVersions).all().map((r) => r.id))
  check('book-versions', bookRows.every((b) => versionIds.has(b.id)), `${versionIds.size}/${bookRows.length}`)
  const revisions = db.select().from(contentRevisions).all()
  check('initial-revisions', bookRows.every((b) => revisions.some((r) => r.bookVersionId === b.id && r.revisionNo === 1)),
    `${revisions.length} revisions`)
  const chapterMismatch = bookRows.filter((b) => {
    const legacyChapters = (b.meta as { chapters?: unknown[] })?.chapters
    if (!Array.isArray(legacyChapters)) return false
    const latest = revisions.filter((r) => r.bookVersionId === b.id).sort((x, y) => x.revisionNo - y.revisionNo).at(-1)
    const revisionChapters = (latest?.meta as { chapters?: unknown[] } | undefined)?.chapters
    return !Array.isArray(revisionChapters) || revisionChapters.length !== legacyChapters.length
  })
  check('revision-meta-chapters', chapterMismatch.length === 0, chapterMismatch.slice(0, 5).map((b) => b.id).join(', ') || 'all match')
  const missingBlobs: string[] = []
  for (const row of revisions) {
    if (!(await storage.exists(row.blobKey))) missingBlobs.push(row.blobKey)
  }
  check('revision-files', missingBlobs.length === 0, missingBlobs.slice(0, 5).join(', ') || `${revisions.length} files present`)

  const shelfRows = db.select().from(shelves).all()
  const categories = db.select().from(libraryCategories).all()
  check('categories', shelfRows.every((s) => categories.some((c) => c.id === s.id)), `${categories.length}/${shelfRows.length}`)
  const tagRows = db.select().from(tags).all()
  const libraryTagRows = db.select().from(libraryTags).all()
  check('tags', tagRows.every((t) => libraryTagRows.some((l) => l.id === t.id)), `${libraryTagRows.length}/${tagRows.length}`)

  const states = db.select().from(bookStates).all()
  check('reading-states', bookRows.every((b) => states.some((s) => s.userId === b.userId && s.bookVersionId === b.id)),
    `${states.length}/${bookRows.length}`)

  const annotationRows = db.select().from(annotations).all()
  const highlightRows = db.select().from(highlights).all()
  const bookmarkRows = db.select().from(bookmarks).all()
  const ideaRows = db.select().from(ideas).all()
  check('annotations', annotationRows.every((a) =>
    (a.type === 'highlight' && highlightRows.some((h) => h.id === a.id && h.cfiRange === a.cfiRange))
    || (a.type === 'bookmark' && bookmarkRows.some((h) => h.id === a.id && (h.title ?? '') === (a.text ?? '')))
    || (a.type === 'note' && ideaRows.some((h) => h.id === a.id && h.color === a.color && h.style === a.style)),
  ), `${highlightRows.length}/${bookmarkRows.length}/${ideaRows.length} of ${annotationRows.length}`)

  const refTargets = [readingRecords, readingSessions, aiThreads, aiBookIndexes, aiChunks, aiChunkEmbeddings, textReplacements, textReplacementOverrides]
  let dangling = 0
  for (const table of refTargets) {
    const rows = db.select({ bookVersionId: table.bookVersionId, bookId: table.bookId }).from(table).all()
    dangling += rows.filter((r) => r.bookId !== null && r.bookVersionId === null).length
  }
  check('version-references', dangling === 0, `${dangling} unbound rows with a book`)

  const instanceRows = db.select().from(instance).all()
  check('instance', instanceRows.length === 1, `${instanceRows.length} instance rows`)

  return { pass: checks.every((c) => c.pass), checks }
}

export interface RevisionMetaBackfillReport {
  versions: number
  metasBackfilled: number
  pinsBackfilled: number
  anomalies: LibraryMigrationAnomaly[]
}

/**
 * Revision metadata carry-over (Phase 3 read-path prerequisite): copy the
 * frozen legacy books.meta into the latest revision's meta where the latter
 * is still empty, and carry books.pinnedAt onto the personal version row.
 * Later revisions and city-managed versions are never touched: only the
 * initial migration state is completed here.
 */
export async function backfillRevisionMeta(): Promise<RevisionMetaBackfillReport> {
  const db = getDb()
  const startedAt = Date.now()
  const logId = createId('mlog')
  db.insert(libraryMigrationLog).values({ id: logId, batch: 'phase3-revision-meta', status: 'started', details: {}, startedAt }).run()

  const report: RevisionMetaBackfillReport = { versions: 0, metasBackfilled: 0, pinsBackfilled: 0, anomalies: [] }
  try {
    const versions = db.select().from(bookVersions).all()
    report.versions = versions.length
    for (const version of versions) {
      const latest = db.select().from(contentRevisions)
        .where(eq(contentRevisions.bookVersionId, version.id))
        .orderBy(contentRevisions.revisionNo).all().at(-1)
      if (!latest) {
        report.anomalies.push({ bookId: version.id, reason: 'version has no revision' })
        continue
      }
      const legacy = db.select().from(books).where(eq(books.id, version.id)).get()
      if (!legacy) continue
      const currentMeta = (latest.meta ?? {}) as Record<string, unknown>
      if (Object.keys(currentMeta).length === 0 && Object.keys((legacy.meta ?? {}) as Record<string, unknown>).length > 0) {
        db.update(contentRevisions).set({ meta: legacy.meta }).where(eq(contentRevisions.id, latest.id)).run()
        report.metasBackfilled += 1
      }
      if (legacy.pinnedAt !== null && legacy.pinnedAt !== undefined) {
        const lbv = db.select({ id: libraryBookVersions.id, pinnedAt: libraryBookVersions.pinnedAt })
          .from(libraryBookVersions).where(eq(libraryBookVersions.bookVersionId, version.id)).all()
          .find((row) => row.pinnedAt === null || row.pinnedAt === undefined)
        if (lbv) {
          db.update(libraryBookVersions).set({ pinnedAt: legacy.pinnedAt }).where(eq(libraryBookVersions.id, lbv.id)).run()
          report.pinsBackfilled += 1
        }
      }
    }
    db.update(libraryMigrationLog).set({
      status: 'completed', finishedAt: Date.now(),
      details: { ...report, anomalies: report.anomalies },
    }).where(eq(libraryMigrationLog.id, logId)).run()
  } catch (err) {
    db.update(libraryMigrationLog).set({
      status: 'failed', finishedAt: Date.now(),
      details: { ...report, error: err instanceof Error ? err.message : String(err) },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    throw err
  }
  return report
}
