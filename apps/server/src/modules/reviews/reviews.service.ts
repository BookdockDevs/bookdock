import { and, asc, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm'

import type {
  ArchiveQuery,
  MyReviewEntry,
  ProfileReadingBook,
  ProfileReadingSummary,
  Review,
  ReviewAuthor,
  ReviewBookContext,
  ReviewComposerContext,
  ReviewCreateReq,
  ReviewSummary,
  ReviewUpdateReq,
} from '@bookdock/shared'
import { reviewFileReferences, reviewHalvesToRating, reviewRatingToHalves } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { syncContentFiles } from '../../db/content-files'
import { bookReviewComments, bookReviewLikes, bookReviews, bookStates, bookVersions, libraries, libraryBooks, libraryBookVersions, users } from '../../db/schema'
import { createId } from '../../lib/id'
import { recordActivityEvent } from '../../lib/activity-events'
import { capturePrivateArchiveSnapshots, savePersonalBookSnapshot } from '../../lib/personal-book-archive'
import { cleanContentBlobs } from '../../lib/content-file-lifecycle'
import { AppError, isUniqueViolation } from '../../middleware/error'
import { getBook, assertReadableBook } from '../books/books.service'
import { resolveSharedVersionRead } from '../libraries/library-access'
import { getProfileSettings } from '../settings/settings.service'
import { getSummary } from '../reading-records/reading-records.service'
import { excludedReadingBookVersionIds } from '../reading-records/reading-visibility'
import {
  assertSourceWorkReadable,
  authorHoldingReadable,
  emptyDistribution,
  privateReviewLink,
  projectReview,
  readableReview,
  recordReviewVisibilityPref,
  reviewComposerContext,
  reviewReadRevision,
  sharedReviewLinks,
  sourceWorkOf,
} from './review-access'

export async function summarizeSourceReviews(
  sourceLibraryId: string,
  sourceLibraryBookId: string,
): Promise<ReviewSummary> {
  const rows = getDb()
    .select({ ratingHalves: bookReviews.ratingHalves })
    .from(bookReviews)
    .where(
      and(
        eq(bookReviews.sourceLibraryId, sourceLibraryId),
        eq(bookReviews.sourceLibraryBookId, sourceLibraryBookId),
        eq(bookReviews.visibility, 'shared'),
      ),
    )
    .all()
  const distribution = emptyDistribution()
  let rated = 0
  let halvesSum = 0
  for (const row of rows) {
    if (row.ratingHalves == null) continue
    rated += 1
    halvesSum += row.ratingHalves
    const rating = reviewHalvesToRating(row.ratingHalves)
    const bucket = distribution.find((entry) => entry.rating === rating)
    if (bucket) bucket.count += 1
  }
  return {
    average: rated === 0 ? null : Math.round((halvesSum / (2 * rated)) * 100) / 100,
    count: rated,
    distribution,
  }
}

async function listSourceReviews(
  userId: string | null,
  sourceLibraryId: string,
  sourceLibraryBookId: string,
  manager: boolean,
  libraryName: string,
): Promise<Review[]> {
  const db = getDb()
  const rows = db
    .select()
    .from(bookReviews)
    .where(
      and(
        eq(bookReviews.sourceLibraryId, sourceLibraryId),
        eq(bookReviews.sourceLibraryBookId, sourceLibraryBookId),
        eq(bookReviews.visibility, 'shared'),
      ),
    )
    .orderBy(asc(bookReviews.createdAt), asc(bookReviews.id))
    .all()
  if (rows.length === 0) return []
  // Set-based fan-out: one select each for likes, comment counts and authors
  // instead of per-row queries. Provenance stays per row — each review may
  // point at a different read version.
  const ids = rows.map((row) => row.id)
  const likesByReview = new Map<string, Array<typeof bookReviewLikes.$inferSelect>>()
  for (const like of db.select().from(bookReviewLikes).where(inArray(bookReviewLikes.reviewId, ids)).all()) {
    const list = likesByReview.get(like.reviewId) ?? []
    list.push(like)
    likesByReview.set(like.reviewId, list)
  }
  const commentsByReview = new Map<string, number>()
  for (const comment of db
    .select({ reviewId: bookReviewComments.reviewId })
    .from(bookReviewComments)
    .where(and(inArray(bookReviewComments.reviewId, ids), isNull(bookReviewComments.deletedAt)))
    .all()) {
    commentsByReview.set(comment.reviewId, (commentsByReview.get(comment.reviewId) ?? 0) + 1)
  }
  const authorsById = new Map<string, ReviewAuthor>()
  for (const author of db
    .select({ id: users.id, username: users.username, avatarKey: users.avatarKey })
    .from(users)
    .where(inArray(users.id, [...new Set(rows.map((row) => row.userId))]))
    .all()) {
    authorsById.set(author.id, { id: author.id, name: author.username, avatarKey: author.avatarKey })
  }
  return Promise.all(
    rows.map((row) =>
      projectReview(userId, row, manager, {
        libraryName,
        likes: likesByReview.get(row.id) ?? [],
        commentCount: commentsByReview.get(row.id) ?? 0,
        author: authorsById.get(row.userId),
      }),
    ),
  )
}

const GUEST_COMPOSER: ReviewComposerContext = {
  anchor: null,
  eligible: false,
  sourceReadable: false,
  canPublishShared: false,
  defaultVisibility: 'private',
  existing: null,
  bookVersionId: null,
}

/**
 * Detail context for a private book card: the caller's own review under
 * either anchor plus, when the card is a collected B with a readable source
 * work, the shared summary and list. Both collected versions of one source
 * work resolve the same review (one anchor, one row, counted once).
 */
export async function getReviewBookContext(
  userId: string | null,
  bookVersionId: string,
): Promise<ReviewBookContext> {
  if (!userId) {
    await assertReadableBook(null, bookVersionId)
    return { composer: GUEST_COMPOSER, own: null, summary: null, reviews: [] }
  }
  const composer = await reviewComposerContext(userId, bookVersionId)
  const held = privateReviewLink(userId, bookVersionId)
  const work = held ? sourceWorkOf(held.link) : null
  if (!work) return { composer, own: composer.existing, summary: null, reviews: [] }
  try {
    const read = await assertSourceWorkReadable(userId, work.libraryId, work.libraryBookId)
    const manager = read.relation === 'owner' || read.relation === 'admin'
    return {
      composer,
      own: composer.existing,
      summary: await summarizeSourceReviews(work.libraryId, work.libraryBookId),
      reviews: await listSourceReviews(userId, work.libraryId, work.libraryBookId, manager, read.library.name),
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    return { composer, own: composer.existing, summary: null, reviews: [] }
  }
}

/**
 * Detail context for a shared work (libraryId + libraryBookId): shared
 * summary and list for anyone with current source access, plus the caller's
 * own composer state when they hold any collected version of this work.
 * Switching versions of one work shows the same review set.
 */
export async function getReviewWorkContext(
  userId: string | null,
  libraryId: string,
  libraryBookId: string,
): Promise<ReviewBookContext> {
  const read = await assertSourceWorkReadable(userId, libraryId, libraryBookId)
  const manager = read.relation === 'owner' || read.relation === 'admin'
  let composer: ReviewComposerContext = GUEST_COMPOSER
  let own: Review | null = null
  if (userId) {
    const targets = new Set(
      getDb()
        .select({ id: libraryBookVersions.id })
        .from(libraryBookVersions)
        .where(and(eq(libraryBookVersions.libraryId, libraryId), eq(libraryBookVersions.libraryBookId, libraryBookId)))
        .all()
        .map((row) => row.id),
    )
    const privateHoldings = getDb()
      .select({ link: libraryBookVersions, deletedAt: libraryBooks.deletedAt })
      .from(libraryBookVersions)
      .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
      .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
      .where(
        and(
          eq(libraries.userId, userId),
          eq(libraries.type, 'private'),
          eq(libraryBookVersions.kind, 'shared'),
          eq(libraryBookVersions.sourceLibraryId, libraryId),
        ),
      )
      .orderBy(desc(libraryBookVersions.updatedAt))
      .all()
      .filter((row) => !!row.link.sourceLibraryBookVersionId && targets.has(row.link.sourceLibraryBookVersionId))

    const activeHolding = privateHoldings.find((row) => !row.deletedAt)?.link
    const hasTrashedHolding = privateHoldings.some((row) => !!row.deletedAt)

    if (activeHolding) {
      composer = await reviewComposerContext(userId, activeHolding.bookVersionId)
      own = composer.existing
    } else if (hasTrashedHolding) {
      composer = GUEST_COMPOSER
    } else {
      const firstReadable = getDb()
        .select()
        .from(libraryBookVersions)
        .where(
          and(
            eq(libraryBookVersions.libraryId, libraryId),
            eq(libraryBookVersions.libraryBookId, libraryBookId),
            inArray(libraryBookVersions.id, read.readableLinkIds),
          ),
        )
        .orderBy(asc(libraryBookVersions.createdAt), asc(libraryBookVersions.id))
        .get()
      if (firstReadable) {
        composer = await reviewComposerContext(userId, firstReadable.bookVersionId)
        own = composer.existing
      }
    }
  }
  return {
    composer,
    own,
    summary: await summarizeSourceReviews(libraryId, libraryBookId),
    reviews: await listSourceReviews(userId, libraryId, libraryBookId, manager, read.library.name),
  }
}

export async function createReview(userId: string, input: ReviewCreateReq): Promise<Review> {
  const db = getDb()
  const held = privateReviewLink(userId, input.bookVersionId)
  let sharedLink: ReturnType<typeof sharedReviewLinks>[number] | null = null
  if (!held) {
    const candidates = sharedReviewLinks(input.bookVersionId)
    for (const candidate of candidates) {
      try {
        await assertSourceWorkReadable(userId, candidate.library.id, candidate.work.id)
        await resolveSharedVersionRead(candidate.library.id, input.bookVersionId, userId)
        sharedLink = candidate
        break
      } catch (error) {
        if (!(error instanceof AppError)) throw error
      }
    }
    if (!sharedLink) {
      await assertReadableBook(userId, input.bookVersionId)
      throw new AppError('REVIEW_NOT_FOUND')
    }
  }
  const rating = input.rating ?? null
  const title = input.title?.trim() ? input.title.trim() : null
  const body = input.body?.trim() ? input.body : null
  const bodyFormat = input.bodyFormat ?? 'markdown'
  const files = bodyFormat === 'markdown' ? reviewFileReferences(body ?? '') : { ids: [], imageIds: [], unmanagedImages: false }
  if (files.unmanagedImages) throw new AppError('VALIDATION_ERROR', 'Review images must be uploaded through the editor')
  if (rating == null && body == null) throw new AppError('VALIDATION_ERROR', 'rating or body is required')
  if (title && title.length > 100) throw new AppError('VALIDATION_ERROR', 'title is too long')
  if (body && body.length > 20000) throw new AppError('VALIDATION_ERROR', 'body is too long')

  const isSource = !held || (held.link.kind === 'shared' && !!held.link.sourceLibraryId && !!held.link.sourceLibraryBookVersionId)
  const composer = await reviewComposerContext(userId, input.bookVersionId)
  const visibility = input.visibility ?? composer.defaultVisibility
  const now = Date.now()

  if (!isSource) {
    if (visibility !== 'private') throw new AppError('REVIEW_NOT_FOUND')
    const row = {
      id: createId('review'),
      userId,
      privateLibraryBookId: held!.work.id,
      sourceLibraryId: null,
      sourceLibraryBookId: null,
      ratingHalves: rating == null ? null : reviewRatingToHalves(rating),
      title,
      body,
      bodyFormat,
      visibility: 'private' as const,
      readListingId: null,
      readBookVersionId: input.bookVersionId,
      readRevisionId: null,
      createdAt: now,
      updatedAt: now,
      editedAt: null,
    }
    try {
      db.transaction((tx) => {
        tx.insert(bookReviews).values(row).run()
        capturePrivateArchiveSnapshots(tx as unknown as ReturnType<typeof getDb>, [input.bookVersionId])
        syncContentFiles(tx, { userId, domain: 'review', targetId: row.id, bookVersionId: input.bookVersionId, draftId: input.draftId, ...files })
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('REVIEW_ALREADY_EXISTS')
      throw error
    }
    return projectReview(userId, row, false)
  }

  const work = held ? sourceWorkOf(held.link) : { libraryId: sharedLink!.library.id, libraryBookId: sharedLink!.work.id }
  if (!work) throw new AppError('REVIEW_NOT_FOUND')
  if (visibility === 'shared' && !composer.canPublishShared) throw new AppError('REVIEW_NOT_FOUND')
  const readListingId = held ? held.link.sourceLibraryBookVersionId : sharedLink!.link.id
  const readLink = held ? held.link : sharedLink!.link
  const row = {
    id: createId('review'),
    userId,
    privateLibraryBookId: null,
    sourceLibraryId: work.libraryId,
    sourceLibraryBookId: work.libraryBookId,
    ratingHalves: rating == null ? null : reviewRatingToHalves(rating),
    title,
    body,
    bodyFormat,
    visibility,
    readListingId,
    readBookVersionId: input.bookVersionId,
    readRevisionId: reviewReadRevision(readLink, input.bookVersionId),
    createdAt: now,
    updatedAt: now,
    editedAt: null,
  }
  const snapshot = held ? null : await getBook(userId, input.bookVersionId)
  try {
    db.transaction((tx) => {
      tx.insert(bookReviews).values(row).run()
      if (snapshot) savePersonalBookSnapshot(tx as unknown as ReturnType<typeof getDb>, userId, input.bookVersionId, snapshot)
      else capturePrivateArchiveSnapshots(tx as unknown as ReturnType<typeof getDb>, [input.bookVersionId])
      syncContentFiles(tx, { userId, domain: 'review', targetId: row.id, bookVersionId: input.bookVersionId, draftId: input.draftId, ...files })
      if (visibility === 'shared' && row.sourceLibraryId && row.sourceLibraryBookId) {
        const workRow = tx.select().from(libraryBooks).where(and(
          eq(libraryBooks.id, row.sourceLibraryBookId),
          eq(libraryBooks.libraryId, row.sourceLibraryId),
        )).get()
        if (workRow && !workRow.deletedAt) {
          recordActivityEvent(tx, {
            idempotencyKey: `review.published:${row.id}`,
            eventType: 'review.published',
            audience: 'library',
            libraryId: row.sourceLibraryId,
            actorUserId: userId,
            targetKind: 'review',
            targetId: row.id,
            workId: row.sourceLibraryBookId,
            versionId: row.readBookVersionId,
            occurredAt: row.createdAt,
          })
        }
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError('REVIEW_ALREADY_EXISTS')
    throw error
  }
  // Only a successful new shared-eligible publish moves the default.
  recordReviewVisibilityPref(userId, visibility)
  return projectReview(userId, row, false)
}

export async function updateReview(userId: string, id: string, patch: ReviewUpdateReq): Promise<Review> {
  const db = getDb()
  // Managers never edit another author's content: only the author updates.
  const row = db
    .select()
    .from(bookReviews)
    .where(and(eq(bookReviews.id, id), eq(bookReviews.userId, userId)))
    .get()
  if (!row) throw new AppError('REVIEW_NOT_FOUND')
  const rating = patch.rating !== undefined ? patch.rating : row.ratingHalves == null ? null : reviewHalvesToRating(row.ratingHalves)
  const title = patch.title !== undefined ? (patch.title?.trim() ? patch.title.trim() : null) : row.title
  const body = patch.body !== undefined ? (patch.body?.trim() ? patch.body : null) : row.body
  const bodyFormat = patch.bodyFormat ?? row.bodyFormat
  const files = bodyFormat === 'markdown' ? reviewFileReferences(body ?? '') : { ids: [], imageIds: [], unmanagedImages: false }
  if (files.unmanagedImages && (body !== row.body || bodyFormat !== row.bodyFormat)) throw new AppError('VALIDATION_ERROR', 'Review images must be uploaded through the editor')
  if (rating == null && body == null) throw new AppError('VALIDATION_ERROR', 'rating or body is required')
  if (title && title.length > 100) throw new AppError('VALIDATION_ERROR', 'title is too long')
  const visibility = patch.visibility ?? row.visibility
  // Only a transition INTO shared re-checks publish eligibility (work reads
  // plus the author's own listing). Keeping an already-shared visibility while
  // editing never rewrites it, so a stranded review retains its choice and
  // recovers shared reads with it; current shared access still closes through
  // the read gates above.
  if (visibility === 'shared' && row.visibility !== 'shared') {
    if (!row.sourceLibraryId || !row.sourceLibraryBookId) throw new AppError('REVIEW_NOT_FOUND')
    try {
      await assertSourceWorkReadable(userId, row.sourceLibraryId, row.sourceLibraryBookId)
      if (!(await authorHoldingReadable(userId, row.sourceLibraryId, row.sourceLibraryBookId))) {
        throw new AppError('REVIEW_NOT_FOUND')
      }
    } catch (error) {
      if (error instanceof AppError) throw new AppError('REVIEW_NOT_FOUND')
      throw error
    }
  }
  const now = Date.now()
  const editedAt = (patch.body !== undefined && body !== row.body) || bodyFormat !== row.bodyFormat || (patch.title !== undefined && title !== row.title) ? now : row.editedAt
  db.transaction((tx) => {
    tx.update(bookReviews)
      .set({
        ratingHalves: rating == null ? null : reviewRatingToHalves(rating),
        title,
        body,
        bodyFormat,
        visibility,
        updatedAt: now,
        editedAt,
      })
      .where(eq(bookReviews.id, id))
      .run()
    syncContentFiles(tx, { userId, domain: 'review', targetId: id, draftId: patch.draftId, ...files })
    if (row.visibility !== 'shared' && visibility === 'shared' && row.sourceLibraryId && row.sourceLibraryBookId) {
      const workRow = tx.select().from(libraryBooks).where(and(
        eq(libraryBooks.id, row.sourceLibraryBookId),
        eq(libraryBooks.libraryId, row.sourceLibraryId),
      )).get()
      if (workRow && !workRow.deletedAt) {
        recordActivityEvent(tx, {
          idempotencyKey: `review.published:${row.id}`,
          eventType: 'review.published',
          audience: 'library',
          libraryId: row.sourceLibraryId,
          actorUserId: userId,
          targetKind: 'review',
          targetId: row.id,
          workId: row.sourceLibraryBookId,
          versionId: row.readBookVersionId,
          occurredAt: now,
        })
      }
    }
  })
  await cleanContentBlobs()
  const updated = db.select().from(bookReviews).where(eq(bookReviews.id, id)).get()!
  return projectReview(userId, updated, false)
}

export async function deleteReview(userId: string, id: string) {
  const db = getDb()
  const owned = db
    .select()
    .from(bookReviews)
    .where(and(eq(bookReviews.id, id), eq(bookReviews.userId, userId)))
    .get()
  if (!owned) {
    const access = await readableReview(userId, id)
    if (!access.manager) throw new AppError('REVIEW_NOT_FOUND')
    if (!access.row.sourceLibraryId || !access.row.sourceLibraryBookId) throw new AppError('REVIEW_NOT_FOUND')
    try {
      await assertSourceWorkReadable(userId, access.row.sourceLibraryId, access.row.sourceLibraryBookId)
    } catch {
      throw new AppError('REVIEW_NOT_FOUND')
    }
    db.transaction((tx) => {
      const workRow = tx.select().from(libraryBooks).where(and(
        eq(libraryBooks.id, access.row.sourceLibraryBookId!),
        eq(libraryBooks.libraryId, access.row.sourceLibraryId!),
      )).get()
      if (access.row.visibility === 'shared' && workRow) {
        recordActivityEvent(tx, {
          idempotencyKey: `review.deleted:${access.row.id}`,
          eventType: 'review.deleted',
          audience: 'manager',
          libraryId: access.row.sourceLibraryId!,
          actorUserId: userId,
          targetKind: 'review',
          targetId: access.row.id,
          workId: access.row.sourceLibraryBookId,
          versionId: access.row.readBookVersionId,
          occurredAt: Date.now(),
          snapshotWorkTitle: workRow.title,
          snapshotObjectLabel: access.row.title,
          snapshotAuthorId: access.row.userId,
        })
      }
      tx.delete(bookReviews).where(eq(bookReviews.id, id)).run()
    })
    await cleanContentBlobs()
    return { id }
  }
  // Author deletes are always allowed, even when the source is gone: the
  // retained copy stays under the author's control. Manager deletes derive
  // from the source and require it to still read.
  // Dependent discussion and likes follow through FK cascades.
  db.transaction((tx) => {
    if (owned.visibility === 'shared' && owned.sourceLibraryId && owned.sourceLibraryBookId) {
      const workRow = tx.select().from(libraryBooks).where(and(
        eq(libraryBooks.id, owned.sourceLibraryBookId),
        eq(libraryBooks.libraryId, owned.sourceLibraryId),
      )).get()
      if (workRow) {
        recordActivityEvent(tx, {
          idempotencyKey: `review.deleted:${owned.id}`,
          eventType: 'review.deleted',
          audience: 'manager',
          libraryId: owned.sourceLibraryId,
          actorUserId: userId,
          targetKind: 'review',
          targetId: owned.id,
          workId: owned.sourceLibraryBookId,
          versionId: owned.readBookVersionId,
          occurredAt: Date.now(),
          snapshotWorkTitle: workRow.title,
          snapshotObjectLabel: owned.title,
          snapshotAuthorId: owned.userId,
        })
      }
    }
    tx.delete(bookReviews).where(eq(bookReviews.id, id)).run()
  })
  await cleanContentBlobs()
  return { id }
}

/**
 * The author's own reviews, newest first, including rows whose source is
 * gone: the personal entry that stays reachable after a permanent source
 * delete. Private-anchored rows always report `private`.
 */
export async function myReviews(userId: string, query: ArchiveQuery = { page: 1, pageSize: 20 }) {
  const db = getDb()
  const rows = db
    .select()
    .from(bookReviews)
    .where(eq(bookReviews.userId, userId))
    .orderBy(desc(bookReviews.createdAt), desc(bookReviews.id))
    .limit(query.pageSize + 1)
    .offset((query.page - 1) * query.pageSize)
    .all()
  const entries: MyReviewEntry[] = await Promise.all(
    rows.slice(0, query.pageSize).map(async (row) => {
      if (!row.sourceLibraryId || !row.sourceLibraryBookId) {
        const work = row.privateLibraryBookId
          ? db.select().from(libraryBooks).where(eq(libraryBooks.id, row.privateLibraryBookId)).get()
          : null
        return {
          review: await projectReview(userId, row, false),
          sourceStatus: 'private' as const,
          workTitle: work?.title ?? null,
        }
      }
      const library = db.select().from(libraries).where(eq(libraries.id, row.sourceLibraryId)).get()
      if (!library) {
        return { review: await projectReview(userId, row, false), sourceStatus: 'library-deleted' as const, workTitle: null }
      }
      const work = db
        .select()
        .from(libraryBooks)
        .where(and(eq(libraryBooks.id, row.sourceLibraryBookId), eq(libraryBooks.libraryId, row.sourceLibraryId)))
        .get()
      if (!work) {
        return { review: await projectReview(userId, row, false), sourceStatus: 'deleted' as const, workTitle: null }
      }
      // The live title needs the same current read permission as any other
      // shared metadata; the retained rating, body and discussion above do
      // not. Without it the entry keeps its status with a null title.
      let workTitle: string | null = null
      try {
        await assertSourceWorkReadable(userId, row.sourceLibraryId, row.sourceLibraryBookId)
        workTitle = work.title
      } catch (error) {
        if (!(error instanceof AppError)) throw error
      }
      return {
        review: await projectReview(userId, row, false),
        sourceStatus: work.deletedAt ? ('trashed' as const) : workTitle === null ? ('unavailable' as const) : ('ok' as const),
        workTitle,
      }
    }),
  )
  return { entries, page: query.page, hasMore: rows.length > query.pageSize }
}

interface ReaderProfileOptions {
  homepage?: boolean
  today?: string
}

async function profileReadingBook(viewerId: string, bookVersionId: string, progress: number): Promise<ProfileReadingBook | null> {
  const db = getDb()
  const privateLibrary = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, viewerId), eq(libraries.type, 'private'))).get()
  let link: typeof libraryBookVersions.$inferSelect | undefined
  let work: typeof libraryBooks.$inferSelect | undefined

  if (privateLibrary) {
    link = db.select().from(libraryBookVersions)
      .where(and(eq(libraryBookVersions.libraryId, privateLibrary.id), eq(libraryBookVersions.bookVersionId, bookVersionId))).get()
    if (link) work = db.select().from(libraryBooks).where(eq(libraryBooks.id, link.libraryBookId)).get()
  }

  if (!link || !work) {
    const sharedCandidates = db.select({ libraryId: libraryBookVersions.libraryId })
      .from(libraryBookVersions)
      .where(eq(libraryBookVersions.bookVersionId, bookVersionId)).all()
    for (const candidate of sharedCandidates) {
      try {
        const read = await resolveSharedVersionRead(candidate.libraryId, bookVersionId, viewerId)
        link = read.link
        work = db.select().from(libraryBooks).where(eq(libraryBooks.id, link.libraryBookId)).get()
        if (work) break
      } catch (error) {
        if (!(error instanceof AppError)) throw error
      }
    }
  }

  if (!link || !work) return null
  const version = db.select({ format: bookVersions.format }).from(bookVersions).where(eq(bookVersions.id, bookVersionId)).get()
  if (!version) return null
  return {
    id: bookVersionId,
    title: link.title ?? work.title,
    author: link.author ?? work.author,
    format: version.format,
    coverKey: link.coverKey ?? work.coverKey,
    progress: Math.max(0, Math.min(100, progress)),
  }
}

async function profileSummary(userId: string, today?: string): Promise<ProfileReadingSummary> {
  const summary = await getSummary(userId, today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10))
  return {
    totalSeconds: summary.totalSeconds,
    totalWordsRead: summary.totalWordsRead,
    totalBooks: summary.totalBooks,
    finishedBooks: summary.scope?.finishedBooks ?? 0,
    totalDays: summary.totalDays,
    currentStreak: summary.currentStreak,
    longestStreak: summary.longestStreak,
  }
}

async function profileCurrentlyReading(viewerId: string, readerId: string): Promise<ProfileReadingBook[]> {
  const db = getDb()
  const hiddenIds = excludedReadingBookVersionIds(db, readerId)
  const rows = db.select({
    bookVersionId: bookStates.bookVersionId,
    progress: bookStates.percent,
    lastReadAt: bookStates.lastReadAt,
    updatedAt: bookStates.updatedAt,
  }).from(bookStates)
    .where(and(
      eq(bookStates.userId, readerId),
      eq(bookStates.readStatus, 'reading'),
      hiddenIds.length > 0 ? notInArray(bookStates.bookVersionId, hiddenIds) : undefined,
    ))
    .orderBy(desc(bookStates.lastReadAt), desc(bookStates.updatedAt), desc(bookStates.bookVersionId))
    .limit(20).all()

  const books: ProfileReadingBook[] = []
  for (const row of rows) {
    try {
      await assertReadableBook(viewerId, row.bookVersionId)
      const book = await profileReadingBook(viewerId, row.bookVersionId, row.progress)
      if (book) books.push(book)
      if (books.length >= 4) break
    } catch (error) {
      if (!(error instanceof AppError)) throw error
    }
  }
  return books
}

export async function readerProfile(viewerId: string | null, authorId: string, query: ArchiveQuery, options: ReaderProfileOptions = {}) {
  const db = getDb()
  const authorRow = db.select({ id: users.id, name: users.username, avatarKey: users.avatarKey, bio: users.bio, createdAt: users.createdAt })
    .from(users).where(eq(users.id, authorId)).get()
  if (!authorRow) throw new AppError('REVIEW_NOT_FOUND')
  const author = { id: authorRow.id, name: authorRow.name, avatarKey: authorRow.avatarKey }
  if (options.homepage) {
    if (!viewerId) throw new AppError('UNAUTHORIZED', 'Login required')
    const isOwner = viewerId === authorId
    const settings = getProfileSettings(authorId)
    const isPublic = isOwner || settings.isPublic !== false
    if (!isPublic) return { author, isOwner: false, visibility: 'private' as const, reviews: { entries: [], page: 1, hasMore: false } }
    const showActivity = settings.showPublicActivity === true
    const showStats = settings.showPublicStats ?? settings.showStats !== false
    const showShowcase = settings.showPublicShowcase ?? settings.showShowcase !== false
    if (isOwner) {
      return {
        author: { ...author, bio: authorRow.bio, createdAt: authorRow.createdAt },
        isOwner: true,
        visibility: 'public' as const,
        showPublicActivity: showActivity,
        showStats: true,
        summary: await profileSummary(authorId, options.today),
        showShowcase: true,
        currentlyReading: await profileCurrentlyReading(viewerId, authorId),
        reviews: { entries: [], page: 1, hasMore: false },
      }
    }
    return {
      author: { ...author, bio: authorRow.bio, createdAt: authorRow.createdAt },
      isOwner,
      visibility: 'public' as const,
      ...(showStats ? { showStats: true, summary: await profileSummary(authorId, options.today) } : { showStats: false }),
      showPublicActivity: showActivity,
      ...(showShowcase ? { showShowcase: true, currentlyReading: await profileCurrentlyReading(viewerId, authorId) } : { showShowcase: false }),
      reviews: { entries: [], page: 1, hasMore: false },
    }
  }
  if (viewerId === authorId) return { author, reviews: await myReviews(authorId, query) }
  const entries: MyReviewEntry[] = []
  const skip = (query.page - 1) * query.pageSize
  let visible = 0
  let offset = 0
  // ACL filtering precedes pagination; bounded batches avoid loading the archive.
  while (entries.length <= query.pageSize) {
    const rows = db.select().from(bookReviews)
      .where(and(eq(bookReviews.userId, authorId), eq(bookReviews.visibility, 'shared')))
      .orderBy(desc(bookReviews.createdAt), desc(bookReviews.id)).limit(50).offset(offset).all()
    for (const row of rows) {
      if (!row.sourceLibraryId || !row.sourceLibraryBookId) continue
      try {
        const read = await assertSourceWorkReadable(viewerId, row.sourceLibraryId, row.sourceLibraryBookId)
        if (visible++ < skip) continue
        entries.push({ review: await projectReview(viewerId, row, read.relation === 'owner' || read.relation === 'admin', { libraryName: read.library.name }), sourceStatus: 'ok', workTitle: read.work.title })
        if (entries.length > query.pageSize) break
      } catch (error) {
        if (!(error instanceof AppError)) throw error
      }
    }
    if (rows.length < 50) break
    offset += rows.length
  }
  return { author, reviews: { entries: entries.slice(0, query.pageSize), page: query.page, hasMore: entries.length > query.pageSize } }
}
