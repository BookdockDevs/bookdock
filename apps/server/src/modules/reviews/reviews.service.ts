import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm'

import type {
  ArchiveQuery,
  ContentFile,
  MyReviewEntry,
  ProfileReadingBook,
  ProfileReadingSummary,
  Review,
  ReviewAuthor,
  ReviewProvenance,
  ReviewBookContext,
  ReviewComposerContext,
  ReviewCreateReq,
  ReviewSummary,
  ReviewUpdateReq,
} from '@bookdock/shared'
import { reviewFileReferences, reviewHalvesToRating, reviewRatingToHalves } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { contentFileProjection, syncContentFiles } from '../../db/content-files'
import { bookReviewComments, bookReviewLikes, bookReviews, bookStates, bookVersions, contentFiles, contentRevisions, libraries, libraryBooks, libraryBookVersions, users } from '../../db/schema'
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
    .select({
      ratingHalves: bookReviews.ratingHalves,
      count: sql<number>`count(*)`,
      sum: sql<number>`sum(${bookReviews.ratingHalves})`,
    })
    .from(bookReviews)
    .where(
      and(
        eq(bookReviews.sourceLibraryId, sourceLibraryId),
        eq(bookReviews.sourceLibraryBookId, sourceLibraryBookId),
        eq(bookReviews.visibility, 'shared'),
        isNotNull(bookReviews.ratingHalves),
      ),
    )
    .groupBy(bookReviews.ratingHalves)
    .all()
  const distribution = emptyDistribution()
  let rated = 0
  let halvesSum = 0
  for (const row of rows) {
    if (row.ratingHalves == null) continue
    rated += row.count
    halvesSum += row.sum
    const rating = reviewHalvesToRating(row.ratingHalves)
    const bucket = distribution.find((entry) => entry.rating === rating)
    if (bucket) bucket.count += row.count
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
  const facts = await loadReviewProjectionFacts(rows, userId)
  const reviews: Review[] = []
  for (const row of rows) {
    reviews.push(await projectReview(userId, row, manager, {
      libraryName,
      likes: facts.likesByReview.get(row.id) ?? [],
      commentCount: facts.commentsByReview.get(row.id) ?? 0,
      author: facts.authorsById.get(row.userId),
      files: facts.filesByReview.get(row.id) ?? [],
      provenance: facts.provenanceByReview.get(row.id),
    }))
  }
  return reviews
}

interface ReviewProjectionFacts {
  likesByReview: Map<string, Array<typeof bookReviewLikes.$inferSelect>>
  commentsByReview: Map<string, number>
  authorsById: Map<string, ReviewAuthor>
  filesByReview: Map<string, ContentFile[]>
  provenanceByReview: Map<string, ReviewProvenance>
}

async function loadReviewProjectionFacts(rows: Array<typeof bookReviews.$inferSelect>, viewerId: string | null): Promise<ReviewProjectionFacts> {
  const db = getDb()
  const ids = [...new Set(rows.map((row) => row.id))]
  const likesByReview = new Map<string, Array<typeof bookReviewLikes.$inferSelect>>()
  for (const like of ids.length ? db.select().from(bookReviewLikes).where(inArray(bookReviewLikes.reviewId, ids)).all() : []) {
    const list = likesByReview.get(like.reviewId) ?? []
    list.push(like)
    likesByReview.set(like.reviewId, list)
  }
  const commentsByReview = new Map<string, number>()
  for (const comment of ids.length ? db.select({ reviewId: bookReviewComments.reviewId, count: sql<number>`count(*)` }).from(bookReviewComments)
    .where(and(inArray(bookReviewComments.reviewId, ids), isNull(bookReviewComments.deletedAt)))
    .groupBy(bookReviewComments.reviewId).all() : []) {
    commentsByReview.set(comment.reviewId, comment.count)
  }
  const authorsById = new Map<string, ReviewAuthor>()
  const authorIds = [...new Set(rows.map((row) => row.userId))]
  for (const author of authorIds.length ? db.select({ id: users.id, username: users.username, avatarKey: users.avatarKey })
    .from(users).where(inArray(users.id, authorIds)).all() : []) {
    authorsById.set(author.id, { id: author.id, name: author.username, avatarKey: author.avatarKey })
  }
  for (const authorId of authorIds) {
    if (!authorsById.has(authorId)) authorsById.set(authorId, { id: authorId, name: 'Deleted user', avatarKey: null })
  }
  const filesByReview = new Map<string, ContentFile[]>()
  for (const file of ids.length ? db.select().from(contentFiles)
    .where(and(inArray(contentFiles.reviewId, ids), eq(contentFiles.ready, true)))
    .orderBy(contentFiles.sortOrder, contentFiles.createdAt, contentFiles.id).all() : []) {
    const list = filesByReview.get(file.reviewId!) ?? []
    list.push(contentFileProjection(file))
    filesByReview.set(file.reviewId!, list)
  }

  const provenanceByReview = new Map<string, ReviewProvenance>()
  const ownRows = viewerId ? rows.filter((row) => row.userId === viewerId && row.sourceLibraryId && row.readListingId && row.readBookVersionId) : []
  const listingIds = [...new Set(ownRows.map((row) => row.readListingId!))]
  const listingsById = new Map(listingIds.length ? db.select().from(libraryBookVersions).where(inArray(libraryBookVersions.id, listingIds)).all().map((row) => [row.id, row]) : [])
  const revisionIds = [...new Set(ownRows.flatMap((row) => row.readRevisionId ? [row.readRevisionId] : []))]
  const revisionsById = new Map(revisionIds.length ? db.select().from(contentRevisions).where(inArray(contentRevisions.id, revisionIds)).all().map((row) => [row.id, row]) : [])
  const readableBySource = new Map<string, Promise<boolean>>()
  for (const row of ownRows) {
    const base: ReviewProvenance = {
      listingId: row.readListingId,
      bookVersionId: row.readBookVersionId,
      revisionId: row.readRevisionId,
      versionName: null,
      available: false,
    }
    const listing = listingsById.get(row.readListingId!)
    if (!listing || listing.libraryId !== row.sourceLibraryId || listing.bookVersionId !== row.readBookVersionId) {
      provenanceByReview.set(row.id, base)
      continue
    }
    const key = [row.sourceLibraryId, row.readBookVersionId].join(':')
    let readable = readableBySource.get(key)
    if (!readable) {
      readable = (async () => {
        try {
          await resolveSharedVersionRead(row.sourceLibraryId!, row.readBookVersionId!, viewerId)
          return true
        } catch (error) {
          if (error instanceof AppError) return false
          throw error
        }
      })()
      readableBySource.set(key, readable)
    }
    const revision = row.readRevisionId ? revisionsById.get(row.readRevisionId) : null
    provenanceByReview.set(row.id, await readable && revision && revision.bookVersionId === row.readBookVersionId
      ? { ...base, versionName: listing.name || null, available: true }
      : base)
  }
  return { likesByReview, commentsByReview, authorsById, filesByReview, provenanceByReview }
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
  const pageRows = rows.slice(0, query.pageSize)
  const facts = await loadReviewProjectionFacts(pageRows, userId)
  const libraryIds = [...new Set(pageRows.flatMap((row) => row.sourceLibraryId ? [row.sourceLibraryId] : []))]
  const librariesById = new Map(libraryIds.length ? db.select().from(libraries).where(inArray(libraries.id, libraryIds)).all().map((row) => [row.id, row]) : [])
  const sourceWorkKeys = [...new Set(pageRows.flatMap((row) => row.sourceLibraryId && row.sourceLibraryBookId ? [[row.sourceLibraryId, row.sourceLibraryBookId].join(':')] : []))]
  const sourceBookPairs = new Map(sourceWorkKeys.map((key) => {
    const [libraryId, bookId] = key.split(':')
    return [key, { libraryId, bookId }]
  }))
  const worksByKey = new Map<string, typeof libraryBooks.$inferSelect>()
  const sourceBookIds = [...new Set([...sourceBookPairs.values()].map((pair) => pair.bookId))]
  for (const work of sourceBookIds.length && libraryIds.length
    ? db.select().from(libraryBooks).where(and(inArray(libraryBooks.id, sourceBookIds), inArray(libraryBooks.libraryId, libraryIds))).all()
    : []) {
    worksByKey.set([work.libraryId, work.id].join(':'), work)
  }
  const privateWorkIds = [...new Set(pageRows.flatMap((row) => row.privateLibraryBookId ? [row.privateLibraryBookId] : []))]
  const privateWorks = new Map(privateWorkIds.length ? db.select().from(libraryBooks).where(inArray(libraryBooks.id, privateWorkIds)).all().map((row) => [row.id, row]) : [])
  const readableByWork = new Map<string, Promise<boolean>>()
  const isSourceReadable = (libraryId: string, bookId: string) => {
    const key = [libraryId, bookId].join(':')
    const existing = readableByWork.get(key)
    if (existing) return existing
    const check = (async () => {
      try {
        await assertSourceWorkReadable(userId, libraryId, bookId)
        return true
      } catch (error) {
        if (error instanceof AppError) return false
        throw error
      }
    })()
    readableByWork.set(key, check)
    return check
  }
  const entries: MyReviewEntry[] = []
  for (const row of pageRows) {
    const preset = {
      likes: facts.likesByReview.get(row.id) ?? [],
      commentCount: facts.commentsByReview.get(row.id) ?? 0,
      author: facts.authorsById.get(row.userId),
      files: facts.filesByReview.get(row.id) ?? [],
      provenance: facts.provenanceByReview.get(row.id),
    }
    if (!row.sourceLibraryId || !row.sourceLibraryBookId) {
      entries.push({
        review: await projectReview(userId, row, false, preset),
        sourceStatus: 'private',
        workTitle: row.privateLibraryBookId ? privateWorks.get(row.privateLibraryBookId)?.title ?? null : null,
      })
      continue
    }
    const library = librariesById.get(row.sourceLibraryId)
    if (!library) {
      entries.push({ review: await projectReview(userId, row, false, preset), sourceStatus: 'library-deleted', workTitle: null })
      continue
    }
    const work = worksByKey.get([row.sourceLibraryId, row.sourceLibraryBookId].join(':'))
    if (!work) {
      entries.push({ review: await projectReview(userId, row, false, preset), sourceStatus: 'deleted', workTitle: null })
      continue
    }
    // Retained review data is independent from the live source title and ACL.
    const readable = await isSourceReadable(row.sourceLibraryId, row.sourceLibraryBookId)
    const workTitle = readable ? work.title : null
    entries.push({
      review: await projectReview(userId, row, false, { ...preset, libraryName: readable ? library.name : null }),
      sourceStatus: work.deletedAt ? 'trashed' : workTitle === null ? 'unavailable' : 'ok',
      workTitle,
    })
  }
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
  const visibleRows: Array<{ row: typeof bookReviews.$inferSelect; read: Awaited<ReturnType<typeof assertSourceWorkReadable>> }> = []
  const readableByWork = new Map<string, Promise<Awaited<ReturnType<typeof assertSourceWorkReadable>> | null>>()
  const readSourceWork = (libraryId: string, bookId: string) => {
    const key = [viewerId, libraryId, bookId].join(':')
    const existing = readableByWork.get(key)
    if (existing) return existing
    const check = (async () => {
      try {
        return await assertSourceWorkReadable(viewerId, libraryId, bookId)
      } catch (error) {
        if (error instanceof AppError) return null
        throw error
      }
    })()
    readableByWork.set(key, check)
    return check
  }
  // ACL filtering precedes pagination; bounded batches avoid loading the archive.
  while (visibleRows.length <= query.pageSize) {
    const rows = db.select().from(bookReviews)
      .where(and(eq(bookReviews.userId, authorId), eq(bookReviews.visibility, 'shared')))
      .orderBy(desc(bookReviews.createdAt), desc(bookReviews.id)).limit(50).offset(offset).all()
    for (const row of rows) {
      if (!row.sourceLibraryId || !row.sourceLibraryBookId) continue
      const read = await readSourceWork(row.sourceLibraryId, row.sourceLibraryBookId)
      if (!read) continue
      if (visible++ < skip) continue
      visibleRows.push({ row, read })
      if (visibleRows.length > query.pageSize) break
    }
    if (rows.length < 50) break
    offset += rows.length
  }
  const facts = await loadReviewProjectionFacts(visibleRows.map((entry) => entry.row), viewerId)
  for (const { row, read } of visibleRows) {
    entries.push({
      review: await projectReview(viewerId, row, read.relation === 'owner' || read.relation === 'admin', {
        libraryName: read.library.name,
        likes: facts.likesByReview.get(row.id) ?? [],
        commentCount: facts.commentsByReview.get(row.id) ?? 0,
        author: facts.authorsById.get(row.userId),
        files: facts.filesByReview.get(row.id) ?? [],
      }),
      sourceStatus: 'ok',
      workTitle: read.work.title,
    })
  }
  return { author, reviews: { entries: entries.slice(0, query.pageSize), page: query.page, hasMore: entries.length > query.pageSize } }
}
