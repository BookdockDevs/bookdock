import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { ReviewAuthor, ReviewComment, ReviewDiscussion } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookReviewCommentLikes, bookReviewComments, bookReviewLikes, users } from '../../db/schema'
import { createId } from '../../lib/id'
import { findCommentReceipt, recordInteractionNotification, saveCommentReceipt } from '../../lib/interaction-notifications'
import { AppError } from '../../middleware/error'
import { projectReview, readableReview } from './review-access'

export async function getReviewDiscussion(userId: string | null, reviewId: string): Promise<ReviewDiscussion> {
  const { row, manager } = await readableReview(userId, reviewId)
  const db = getDb()
  const rows = db
    .select()
    .from(bookReviewComments)
    .where(eq(bookReviewComments.reviewId, row.id))
    .orderBy(asc(bookReviewComments.createdAt), asc(sql`rowid`))
    .all()

  const commentIds = rows.map((comment) => comment.id)
  const likesByComment = new Map<string, Array<{ userId: string }>>()
  if (commentIds.length > 0) {
    const allLikes = db
      .select({ commentId: bookReviewCommentLikes.commentId, userId: bookReviewCommentLikes.userId })
      .from(bookReviewCommentLikes)
      .where(inArray(bookReviewCommentLikes.commentId, commentIds))
      .all()
    for (const like of allLikes) {
      const list = likesByComment.get(like.commentId) ?? []
      list.push(like)
      likesByComment.set(like.commentId, list)
    }
  }

  const reviewLikes = db
    .select()
    .from(bookReviewLikes)
    .where(eq(bookReviewLikes.reviewId, row.id))
    .orderBy(asc(bookReviewLikes.createdAt), asc(bookReviewLikes.userId))
    .all()

  const userIds = new Set<string>()
  for (const comment of rows) {
    if (comment.userId) userIds.add(comment.userId)
    if (comment.replyToId) {
      const replyTo = rows.find((candidate) => candidate.id === comment.replyToId)
      if (replyTo?.userId) userIds.add(replyTo.userId)
    }
  }
  for (const like of reviewLikes) {
    if (like.userId) userIds.add(like.userId)
  }

  const authorsById = new Map<string, ReviewAuthor>()
  if (userIds.size > 0) {
    const userRows = db
      .select({ id: users.id, name: users.username, avatarKey: users.avatarKey })
      .from(users)
      .where(inArray(users.id, [...userIds]))
      .all()
    for (const u of userRows) {
      authorsById.set(u.id, u)
    }
  }
  const resolveAuthor = (authorId: string | null): ReviewAuthor => {
    if (!authorId) return { id: '', name: 'Deleted user', avatarKey: null }
    return authorsById.get(authorId) ?? { id: authorId, name: 'Deleted user', avatarKey: null }
  }

  const comments: ReviewComment[] = rows.map((comment) => {
    const likes = likesByComment.get(comment.id) ?? []
    const replyTo = rows.find((candidate) => candidate.id === comment.replyToId)
    const projected: ReviewComment = {
      id: comment.id,
      parentId: comment.parentId,
      replyToId: comment.replyToId,
      replyToName: replyTo ? resolveAuthor(replyTo.userId).name : null,
      author: resolveAuthor(comment.userId),
      body: comment.deletedAt ? null : comment.body,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt,
      deletedAt: comment.deletedAt,
      own: userId === comment.userId,
      canDelete: userId === comment.userId || (manager && comment.userId !== userId),
      liked: likes.some((like) => like.userId === userId),
      likeCount: likes.length,
    }
    return projected
  })

  const likers = reviewLikes.map((like) => resolveAuthor(like.userId))
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
  const likes = db
    .select()
    .from(bookReviewCommentLikes)
    .where(eq(bookReviewCommentLikes.commentId, commentId))
    .orderBy(asc(bookReviewCommentLikes.createdAt), asc(bookReviewCommentLikes.userId))
    .all()
  if (likes.length === 0) return []
  const userIds = [...new Set(likes.map((l) => l.userId))]
  const usersById = new Map<string, ReviewAuthor>()
  for (const u of db
    .select({ id: users.id, name: users.username, avatarKey: users.avatarKey })
    .from(users)
    .where(inArray(users.id, userIds))
    .all()) {
    usersById.set(u.id, u)
  }
  return likes.map((like) => usersById.get(like.userId) ?? { id: like.userId, name: 'Deleted user', avatarKey: null })
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
