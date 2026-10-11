import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import type { ReviewComment, ReviewDiscussion } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookReviewCommentLikes, bookReviewComments, bookReviewLikes } from '../../db/schema'
import { createId } from '../../lib/id'
import { findCommentReceipt, recordInteractionNotification, saveCommentReceipt } from '../../lib/interaction-notifications'
import { AppError } from '../../middleware/error'
import { projectReview, readableReview, reviewAuthor } from './review-access'

function discussionComment(
  userId: string | null,
  rows: Array<typeof bookReviewComments.$inferSelect>,
  comment: typeof bookReviewComments.$inferSelect,
): ReviewComment {
  const db = getDb()
  const likes = db.select().from(bookReviewCommentLikes).where(eq(bookReviewCommentLikes.commentId, comment.id)).all()
  const replyTo = rows.find((candidate) => candidate.id === comment.replyToId)
  return {
    id: comment.id,
    parentId: comment.parentId,
    replyToId: comment.replyToId,
    replyToName: replyTo ? reviewAuthor(replyTo.userId).name : null,
    author: reviewAuthor(comment.userId),
    body: comment.deletedAt ? null : comment.body,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    deletedAt: comment.deletedAt,
    own: userId === comment.userId,
    canDelete: userId === comment.userId,
    liked: likes.some((like) => like.userId === userId),
    likeCount: likes.length,
  }
}

export async function getReviewDiscussion(userId: string | null, reviewId: string): Promise<ReviewDiscussion> {
  const { row, manager } = await readableReview(userId, reviewId)
  const db = getDb()
  const rows = db
    .select()
    .from(bookReviewComments)
    .where(eq(bookReviewComments.reviewId, row.id))
    .orderBy(asc(bookReviewComments.createdAt), asc(sql`rowid`))
    .all()
  // Manager deletes mirror the idea-discussion rule: the author or a current
  // source manager deletes; private rows are author-only through readableReview.
  const comments: ReviewComment[] = rows.map((comment) => {
    const projected = discussionComment(userId, rows, comment)
    if (manager && comment.userId !== userId) projected.canDelete = true
    return projected
  })
  const likers = db
    .select()
    .from(bookReviewLikes)
    .where(eq(bookReviewLikes.reviewId, row.id))
    .orderBy(asc(bookReviewLikes.createdAt), asc(bookReviewLikes.userId))
    .all()
    .map((like) => reviewAuthor(like.userId))
  return { review: await projectReview(userId, row, manager), comments, likers }
}

export async function reviewCommentLikers(userId: string | null, reviewId: string, commentId: string) {
  await readableReview(userId, reviewId)
  const db = getDb()
  const comment = db
    .select()
    .from(bookReviewComments)
    .where(and(eq(bookReviewComments.id, commentId), eq(bookReviewComments.reviewId, reviewId), isNull(bookReviewComments.deletedAt)))
    .get()
  if (!comment) throw new AppError('REVIEW_NOT_FOUND')
  return db
    .select()
    .from(bookReviewCommentLikes)
    .where(eq(bookReviewCommentLikes.commentId, commentId))
    .orderBy(asc(bookReviewCommentLikes.createdAt), asc(bookReviewCommentLikes.userId))
    .all()
    .map((like) => reviewAuthor(like.userId))
}

export async function createReviewComment(userId: string, reviewId: string, input: { requestId?: string; body: string; replyToId?: string }) {
  const { row } = await readableReview(userId, reviewId)
  const db = getDb()
  return db.transaction((tx) => {
    const receipt = findCommentReceipt(tx, userId, 'review', reviewId, input)
    if (receipt) return receipt
    const replyTo = input.replyToId
      ? db
          .select()
          .from(bookReviewComments)
          .where(and(eq(bookReviewComments.id, input.replyToId), eq(bookReviewComments.reviewId, reviewId), isNull(bookReviewComments.deletedAt)))
          .get()
      : null
    if (input.replyToId && !replyTo) throw new AppError('REVIEW_NOT_FOUND')
    // Two levels: a reply nests under its target's top-level parent and
    // addresses the target, exactly like idea discussion.
    const comment = {
      id: createId('rc'),
      reviewId,
      userId,
      parentId: replyTo ? replyTo.parentId ?? replyTo.id : null,
      replyToId: replyTo?.id ?? null,
      body: input.body,
      createdAt: Date.now(),
    }
    tx.insert(bookReviewComments).values(comment).run()
    saveCommentReceipt(tx, userId, 'review', reviewId, input, comment.id)
    recordInteractionNotification(tx, {
      userId: replyTo ? replyTo.userId : row.userId, actorId: userId, domain: 'review',
      event: replyTo ? 'reply' : 'comment', targetId: reviewId, interactionId: comment.id, commentId: comment.id,
    })
    return comment.id
  })
}

export async function updateReviewComment(userId: string, reviewId: string, commentId: string, body: string) {
  await readableReview(userId, reviewId)
  const db = getDb()
  const comment = db
    .select()
    .from(bookReviewComments)
    .where(
      and(
        eq(bookReviewComments.id, commentId),
        eq(bookReviewComments.reviewId, reviewId),
        eq(bookReviewComments.userId, userId),
        isNull(bookReviewComments.deletedAt),
      ),
    )
    .get()
  if (!comment) throw new AppError('REVIEW_NOT_FOUND')
  if (comment.body !== body) {
    db.update(bookReviewComments).set({ body, editedAt: Date.now() }).where(eq(bookReviewComments.id, commentId)).run()
  }
}

export async function deleteReviewComment(userId: string, reviewId: string, commentId: string) {
  const { manager } = await readableReview(userId, reviewId)
  const db = getDb()
  const comment = db
    .select()
    .from(bookReviewComments)
    .where(and(eq(bookReviewComments.id, commentId), eq(bookReviewComments.reviewId, reviewId), isNull(bookReviewComments.deletedAt)))
    .get()
  if (!comment || (comment.userId !== userId && !manager)) throw new AppError('REVIEW_NOT_FOUND')
  db.transaction((tx) => {
    tx.delete(bookReviewCommentLikes).where(eq(bookReviewCommentLikes.commentId, commentId)).run()
    // No tombstones: surviving replies are promoted to top level so the thread
    // stays readable with no "deleted" scar. replyTo references null out via
    // FK, and children are updated before the delete to avoid the cascade.
    tx.update(bookReviewComments).set({ parentId: null }).where(eq(bookReviewComments.parentId, commentId)).run()
    tx.delete(bookReviewComments).where(eq(bookReviewComments.id, commentId)).run()
  })
}

export async function setReviewLike(userId: string, reviewId: string, liked: boolean, commentId?: string) {
  const { row } = await readableReview(userId, reviewId)
  const db = getDb()
  db.transaction((tx) => {
    if (commentId) {
      const comment = db
        .select()
        .from(bookReviewComments)
        .where(and(eq(bookReviewComments.id, commentId), eq(bookReviewComments.reviewId, reviewId), isNull(bookReviewComments.deletedAt)))
        .get()
      if (!comment) throw new AppError('REVIEW_NOT_FOUND')
      if (liked) {
        const result = tx.insert(bookReviewCommentLikes).values({ commentId, userId, createdAt: Date.now() }).onConflictDoNothing().run()
        if (result.changes) recordInteractionNotification(tx, { userId: comment.userId, actorId: userId, domain: 'review', event: 'like', targetId: reviewId, interactionId: commentId, commentId })
      } else {
        db.delete(bookReviewCommentLikes).where(and(eq(bookReviewCommentLikes.commentId, commentId), eq(bookReviewCommentLikes.userId, userId))).run()
      }
    } else if (liked) {
      const result = tx.insert(bookReviewLikes).values({ reviewId, userId, createdAt: Date.now() }).onConflictDoNothing().run()
      if (result.changes) recordInteractionNotification(tx, { userId: row.userId, actorId: userId, domain: 'review', event: 'like', targetId: reviewId, interactionId: reviewId })
    } else {
      db.delete(bookReviewLikes).where(and(eq(bookReviewLikes.reviewId, reviewId), eq(bookReviewLikes.userId, userId))).run()
    }
  })
}
